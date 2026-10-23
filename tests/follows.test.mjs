/**
 * 关注同步的测试（`tools/lib/follows.mjs`）。
 *
 * 这一组测试刻意**不碰网络、不碰真配置**：
 *   · 所有网络都用一个假的 `get` 换成固定响应（含风控/未登录/空列表这些真实会遇到的形态）
 *   · 配置路径与快照路径在 import 之前就被指到临时目录（paths.mjs / config.mjs 在加载时算路径，
 *     所以必须在动态 import 之前设 env —— 这正是这个文件顶部先设 env 再 import 的原因）
 *
 * 为什么要测得这么细：这段代码挂在她的唤醒链路上。它出了错不会响亮地失败，
 * 而是"她今天醒不过来"或"名单悄悄没更新"—— 两种都极难从表面看出来 ✗
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ── 隔离：必须在 import 之前 ────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'follows-'))
process.env.MYILIDEPU_CONFIG = path.join(TMP, 'myilidepu.config.json')
process.env.MYILIDEPU_DATA_DIR = path.join(TMP, 'data')
process.env.USERPROFILE = TMP   // 快照默认落在 $HOME/.bili-ai 下，别写进真用户目录
process.env.HOME = TMP

const { fetchFollowings, readSeen, writeSeen, diffFollows, mergeWatchUps, syncFollows, describeFollows } =
  await import('../tools/lib/follows.mjs')
const { config, resetConfig } = await import('../tools/lib/config.mjs')

const WBI = {
  img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
  sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
}
const json = (body) => async () => body
const navOk = (mid = '3747573946911655') => ({ data: { mid, isLogin: true, wbi_img: WBI } })
/** syncFollows 的默认依赖：假凭据（否则它会去读真用户的 ~/.bili-ai/credentials.json）*/
const sync = (o) => syncFollows({ cred: {}, headers: {}, ...o })

/** 一个假 apiGet：按 URL 里的分页参数发牌，并把每次请求记下来 */
function fakeGet({ total = 2, pages = { 1: [{ mid: 111, uname: '甲', mtime: 1700000000 }] }, fail = null } = {}) {
  const calls = []
  const get = async (url, headers) => {
    calls.push({ url, headers })
    if (url.includes('/x/web-interface/nav')) return navOk()
    if (fail) return fail
    const pn = Number(new URL(url).searchParams.get('pn') ?? 1)
    return { code: 0, message: 'OK', data: { total, list: pages[pn] ?? [] } }
  }
  get.calls = calls
  return get
}

// ── 纯函数：diffFollows ────────────────────────────────────────────────────
test('diffFollows：新增与取关都认得出来', () => {
  const seen = [{ mid: '1', name: '甲' }, { mid: '2', name: '乙' }]
  const now = [{ mid: '2', name: '乙' }, { mid: '3', name: '丙' }]
  const d = diffFollows(seen, now)
  assert.deepEqual(d.added, [{ mid: '3', name: '丙' }])
  assert.deepEqual(d.removed, [{ mid: '1', name: '甲' }])
})

test('diffFollows：mid 统一按字符串比（配置里写数字 12345 不能和 "12345" 静默不相等）', () => {
  assert.deepEqual(diffFollows([{ mid: 111, name: '甲' }], [{ mid: '111', name: '甲' }]), { added: [], removed: [] })
})

// ── 纯函数：mergeWatchUps ──────────────────────────────────────────────────
test('mergeWatchUps：新关注按 {name,mid,topics} 追加，套默认主题词', () => {
  const r = mergeWatchUps([{ name: '黑鸦Heya', mid: '3706929260006322', topics: ['DeepSeek'] }],
    [{ mid: '190973118', name: '析构万理的发条精灵' }],
    { topics: ['DeepSeek', '国产大模型'] })
  assert.equal(r.watchups.length, 2)
  assert.deepEqual(r.watchups[1], { name: '析构万理的发条精灵', mid: '190973118', topics: ['DeepSeek', '国产大模型'] })
  assert.deepEqual(r.skipped, [])
})

test('mergeWatchUps：已在名单里的跳过（同 mid 或同名都算，且不动人家的 topics）', () => {
  const existing = [{ name: '黑鸦Heya', mid: '3706929260006322', topics: ['只要这条'] }, { name: '手写的' }]
  const r = mergeWatchUps(existing, [
    { mid: '3706929260006322', name: '黑鸦Heya' },   // 同 mid
    { mid: '999', name: '手写的' },                   // 同名（主人手写的那条没有 mid）
    { mid: '999', name: '新来的' },                   // 真的新的
  ], { topics: ['x'] })
  assert.equal(r.watchups.length, 3)
  assert.deepEqual(r.watchups[0].topics, ['只要这条'], '已存在条目的 topics 一个字都不许动')
  assert.deepEqual(r.added.map((x) => x.name), ['新来的'])
  assert.deepEqual(r.skipped.map((x) => x.why), ['already', 'already'])
})

test('mergeWatchUps：一次只加 max 个（超出的下次还能补）', () => {
  const added = Array.from({ length: 5 }, (_, i) => ({ mid: String(i + 1), name: `UP${i + 1}` }))
  const r = mergeWatchUps([], added, { max: 2 })
  assert.deepEqual(r.added.map((x) => x.name), ['UP1', 'UP2'])
  assert.equal(r.skipped.filter((x) => x.why === 'over-limit').length, 3)
})

test('mergeWatchUps：接口把 <em> 标签带回昵称时剥掉；没昵称的丢掉', () => {
  const r = mergeWatchUps([], [{ mid: '5', name: '<em class="keyword">黑鸦</em>Heya' }, { mid: '6', name: '  ' }], {})
  assert.deepEqual(r.added.map((x) => x.name), ['黑鸦Heya'])
  assert.deepEqual(r.skipped.map((x) => x.why), ['no-name'])
})

// ── 快照读写 ───────────────────────────────────────────────────────────────
test('writeSeen/readSeen 往返；坏文件与缺失都当"没见过"而不是炸', () => {
  const f = path.join(TMP, 'seen.json')
  assert.deepEqual(readSeen(f), { at: null, list: [] })
  writeSeen([{ mid: 7, name: '甲' }], { file: f, at: '2026-10-23T00:00:00.000Z' })
  const back = readSeen(f)
  assert.equal(back.at, '2026-10-23T00:00:00.000Z')
  assert.deepEqual(back.list, [{ mid: '7', name: '甲' }])
  fs.writeFileSync(f, '{ 坏掉的 json', 'utf8')
  assert.deepEqual(readSeen(f), { at: null, list: [] })
  // 更早的形态 { mids: [...] } 也要认得（升级上来的用户不能"全员变新关注"）
  fs.writeFileSync(f, JSON.stringify({ mids: [1, 2] }), 'utf8')
  assert.deepEqual(readSeen(f).list.map((x) => x.mid), ['1', '2'])
})

// ── fetchFollowings ────────────────────────────────────────────────────────
test('fetchFollowings：走 WBI 签名 + 关注页 Referer，分页到"没满一页"就停', async () => {
  const get = fakeGet({ total: 2, pages: { 1: [{ mid: 1, uname: '甲', mtime: 1700000000 }, { mid: 2, uname: '乙', mtime: 0 }] } })
  const r = await fetchFollowings({ get, headers: { cookie: 'x' }, vmid: '9', pageSize: 50 })
  assert.equal(r.total, 2)
  assert.equal(r.complete, true)
  assert.deepEqual(r.list.map((x) => x.name), ['甲', '乙'])
  const u = new URL(get.calls.at(-1).url)
  assert.ok(u.searchParams.get('w_rid'), '必须带 w_rid（不签名会被风控当成未登录）')
  assert.ok(u.searchParams.get('wts'), '必须带 wts')
  assert.equal(u.searchParams.get('vmid'), '9')
})

test('fetchFollowings：一页装满就翻下一页，直到 total 够', async () => {
  const pages = { 1: Array.from({ length: 50 }, (_, i) => ({ mid: i + 1, uname: 'U' + (i + 1) })), 2: [{ mid: 99, uname: '最后一个' }] }
  const get = fakeGet({ total: 51, pages })
  const r = await fetchFollowings({ get, headers: {}, vmid: '9' })
  assert.equal(r.list.length, 51)
  assert.equal(r.pages, 2)
  assert.equal(r.complete, true)
})

test('fetchFollowings：接口报错带着 code 抛出来（调用方才能说清是风控还是没登录）', async () => {
  const get = fakeGet({ fail: { code: -352, message: '风控校验失败' } })
  await assert.rejects(() => fetchFollowings({ get, headers: {}, vmid: '9' }), (e) => {
    assert.equal(e.apiCode, -352)
    assert.match(e.message, /-352/)
    return true
  })
})

test('fetchFollowings：没给 vmid 直接抛 NO_VMID（别去拼一个 mid=undefined 的请求）', async () => {
  await assert.rejects(() => fetchFollowings({ get: fakeGet(), headers: {}, vmid: '' }), (e) => e.code === 'NO_VMID')
})

// ── syncFollows（一条龙）──────────────────────────────────────────────────
test('syncFollows：dry 模式什么都不写', async () => {
  const seenFile = path.join(TMP, 'seen-dry.json')
  const r = await sync({
    get: fakeGet({ total: 1, pages: { 1: [{ mid: 42, uname: '新UP' }] } }),
    headers: {}, seenFile, dry: true, now: 1700000000000,
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.added.map((x) => x.name), ['新UP'])
  assert.equal(r.wroteConfig, false)
  assert.equal(r.wroteSeen, false)
  assert.equal(fs.existsSync(seenFile), false, 'dry 不该写快照')
})

test('syncFollows：--go 时写配置的 watchups + 更新快照；第二次跑不重复加', async () => {
  fs.rmSync(process.env.MYILIDEPU_CONFIG, { force: true })
  resetConfig()
  const seenFile = path.join(TMP, 'seen-go.json')
  const get = fakeGet({ total: 1, pages: { 1: [{ mid: 42, uname: '新UP' }] } })
  const r1 = await sync({ get, headers: {}, seenFile, dry: false, topics: ['DeepSeek'], now: 1700000000000 })
  assert.equal(r1.ok, true)
  assert.equal(r1.wroteConfig, true)
  assert.equal(r1.wroteSeen, true)
  resetConfig()
  assert.deepEqual(config().watchups, [{ name: '新UP', mid: '42', topics: ['DeepSeek'] }])
  assert.deepEqual(readSeen(seenFile).list, [{ mid: '42', name: '新UP' }])

  // 第二次：同一个人不算新关注，也不该再写一次
  const before = fs.readFileSync(process.env.MYILIDEPU_CONFIG, 'utf8')
  const r2 = await sync({ get, headers: {}, seenFile, dry: false, now: 1700000001000 })
  assert.equal(r2.added.length, 0)
  assert.equal(r2.wroteConfig, false)
  assert.equal(fs.readFileSync(process.env.MYILIDEPU_CONFIG, 'utf8'), before, '没有新增就不该动配置')
})

test('syncFollows：取关只报告、绝不从 watchups 里删（主人可能还想让她看那位的稿子）', async () => {
  const seenFile = path.join(TMP, 'seen-rm.json')
  writeSeen([{ mid: '42', name: '新UP' }, { mid: '77', name: '被取关的' }], { file: seenFile })
  const r = await sync({ get: fakeGet({ total: 1, pages: { 1: [{ mid: 42, uname: '新UP' }] } }), headers: {}, seenFile, dry: false })
  assert.deepEqual(r.removed.map((x) => x.name), ['被取关的'])
  assert.deepEqual(r.watchups.map((x) => x.mid), ['42'], 'watchups 里只有已存在的 42，被取关的不参与增删')
})

test('syncFollows：未登录 / 网络炸了都只是 ok:false，绝不抛（它挂在她的唤醒链路上）', async () => {
  const noLogin = await sync({ get: json({ data: {} }), headers: {}, dry: false, seenFile: path.join(TMP, 's1.json') })
  assert.equal(noLogin.ok, false)
  assert.equal(noLogin.code, 'NO_LOGIN')

  const boom = await sync({ get: async () => { throw new Error('ECONNRESET') }, headers: {}, dry: false, seenFile: path.join(TMP, 's2.json') })
  assert.equal(boom.ok, false)
  assert.match(boom.message, /ECONNRESET/)
})

// ── 给人和给提示词看的一句话 ────────────────────────────────────────────────
test('describeFollows：有新关注才有话；失败时不说话', () => {
  assert.equal(describeFollows({ ok: false }), '')
  assert.equal(describeFollows({ ok: true, added: [], removed: [], skipped: [] }), '')
  assert.match(describeFollows({ ok: true, added: [{ name: '甲' }], removed: [{ name: '乙' }], skipped: [{ why: 'over-limit' }] }), /新关注 1 位：甲.*取关 1 位：乙.*1 位超出单次上限/)
})

test('cleanup', () => { fs.rmSync(TMP, { recursive: true, force: true }) })
