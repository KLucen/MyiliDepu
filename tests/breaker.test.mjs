// -412 退避的「爆炸半径」测试（2026-10-25 事故的回归护栏）
//
// 事故原形：关注同步每 5 分钟打一次 relation/followings，撞到 412 就把**全机**熔断 5 分钟；
//   而它 5 分钟后又要打 → 退避窗口首尾相接 → 一整天她的评论/私信都被挡在闸门外 ✗
//
// 这个文件锁住三件事：
//   ① 监控类端点的 412 **不动全局闸门**（只看别人更新，没资格拖住她发文）
//   ② 真正的写/读端点 412 仍然熔断全机（该保护的保护住）
//   ③ 退避计数会随时间衰减，不会一路棘轮到永远 30 分钟
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// HOME 是在模块加载时读的 → 必须在 import 之前换掉
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'breaker-'))
process.env.USERPROFILE = TMP
process.env.HOME = TMP
delete process.env.BILI_NO_CACHE

const dataDir = path.join(TMP, '.bili-ai')
const GLOBAL = path.join(dataDir, 'api-ban.json')
const MONITOR = path.join(dataDir, 'api-ban-monitor.json')
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }

const { apiGet, apiBanState, clearApiBan } = await import('../tools/lib/bili-api.mjs')

const reply412 = () => new Response('', { status: 412 })
const ok = (data = {}) => new Response(JSON.stringify({ code: 0, data }), { status: 200, headers: { 'content-type': 'application/json' } })

test('监控端点的 412 不碰全局闸门', async (t) => {
  fs.rmSync(GLOBAL, { force: true }); fs.rmSync(MONITOR, { force: true })
  t.mock.method(globalThis, 'fetch', async () => reply412())
  const r = await apiGet('https://api.bilibili.com/x/relation/followings?vmid=1')
  assert.equal(r.code, -412)
  assert.equal(read(GLOBAL), null, '全局闸门必须原封不动')
  const m = read(MONITOR)
  assert.ok(m && m.until > Date.now(), '监控自己的闸门要落下')
  assert.equal(m.endpoint, '/x/relation/followings')
  assert.ok(r.message.includes('不影响她发评论/私信'), r.message)
})

test('监控端点退避期间，写接口照常打得出去', async (t) => {
  fs.rmSync(GLOBAL, { force: true })
  let called = 0
  t.mock.method(globalThis, 'fetch', async () => { called++; return ok({ reply: { rpid: 1 } }) })
  const r = await apiGet('https://api.bilibili.com/x/v2/reply/add', {}, { noCache: true })
  assert.equal(r.code, 0)
  assert.equal(called, 1, '写接口必须真的打到网络，不能被监控的退避挡住')
})

test('核心端点的 412 仍然熔断全机（并且说明怎么解封）', async (t) => {
  fs.rmSync(GLOBAL, { force: true }); fs.rmSync(MONITOR, { force: true })
  t.mock.method(globalThis, 'fetch', async () => reply412())
  const r = await apiGet('https://api.bilibili.com/x/v2/reply/add', {}, { noCache: true })
  assert.equal(r.code, -412)
  const g = read(GLOBAL)
  assert.ok(g && g.until > Date.now(), '核心端点必须落全局闸门')
  assert.ok(r.message.includes('bili unban'), r.message)
  // 熔断期间：下一个请求连网络都不该打
  let hit = 0
  t.mock.method(globalThis, 'fetch', async () => { hit++; return ok() })
  const blocked = await apiGet('https://api.bilibili.com/x/web-interface/view?bvid=BV1')
  assert.equal(blocked.code, -412)
  assert.equal(hit, 0, '熔断中不许再打网络')
})

test('clearApiBan 一把清掉两个闸门', async (t) => {
  fs.writeFileSync(GLOBAL, JSON.stringify({ until: Date.now() + 600000, why: 'HTTP 412' }))
  fs.writeFileSync(MONITOR, JSON.stringify({ until: Date.now() + 600000, why: 'code=-412' }))
  const before = clearApiBan()
  assert.equal(before.global.banned, true)
  assert.equal(before.monitor.banned, true)
  assert.equal(read(GLOBAL), null)
  assert.equal(read(MONITOR), null)
  assert.equal(apiBanState().global.banned, false)
  // 清完之后请求要能真的出去
  let called = 0
  t.mock.method(globalThis, 'fetch', async () => { called++; return ok() })
  await apiGet('https://api.bilibili.com/x/web-interface/view?bvid=BV1')
  assert.equal(called, 1)
})

test('退避计数超过 30 分钟没再犯就重新从 5 分钟起算', async (t) => {
  const stale = Date.now() - 31 * 60 * 1000
  fs.writeFileSync(GLOBAL, JSON.stringify({ until: 0, streak: 4, endpoint: '/x/v2/reply', at: new Date(stale).toISOString() }))
  t.mock.method(globalThis, 'fetch', async () => reply412())
  const now = Date.now()
  const r = await apiGet('https://api.bilibili.com/x/v2/reply/add', {}, { noCache: true })
  assert.equal(r.code, -412)
  const g = read(GLOBAL)
  assert.equal(g.streak, 1, '陈旧计数要衰减掉，不能棘轮到 30 分钟')
  assert.ok(g.until - now <= 5 * 60000 + 2000, '重新从 5 分钟起')
})

test('监控端点的投稿列表进缓存：同一份列表 6 小时内不再打网络', async (t) => {
  fs.rmSync(GLOBAL, { force: true }); fs.rmSync(MONITOR, { force: true })
  fs.rmSync(path.join(dataDir, 'api-cache.json'), { force: true })
  let called = 0
  t.mock.method(globalThis, 'fetch', async () => { called++; return ok({ list: { vlist: [{ bvid: 'BV1x' }] } }) })
  const url = 'https://api.bilibili.com/x/space/wbi/arc/search?mid=1&ps=5&pn=1'
  const a = await apiGet(url)
  const b = await apiGet(url)
  assert.equal(a.code, 0)
  assert.equal(b._cached, true, '第二次必须命中缓存')
  assert.equal(called, 1, '同一份投稿列表不该打两次网络')
})

// 2026-10-25 事故的另一半：风控期间她照常醒、照常把额度用光，结果一天什么都没发出去。
//   现在闸门关着就先不醒 —— 额度一分不烧，等松开再叫她。
test('风控期间不消耗醒来额度（wakeGateReason）', async () => {
  const { wakeGateReason } = await import('../lib/scheduler.js')
  assert.equal(wakeGateReason({ banned: false, minutesLeft: 0, why: null }), '', '没风控就该照常醒')
  assert.equal(wakeGateReason({}), '', '状态缺失（读不到文件）不该变成"永远不醒"')
  const reason = wakeGateReason({ banned: true, minutesLeft: 7, why: 'HTTP 412' })
  assert.ok(reason.includes('7 分钟'), reason)
  assert.ok(reason.includes('HTTP 412'), reason)
})
