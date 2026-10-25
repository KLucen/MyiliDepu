// 关注同步：从「每次醒来自动跑」改成「设置页一个按钮」（2026-10-25 主人要求）
//
//   为什么单独一个文件：这条路由跑的是**真子进程**（node <bili.mjs> follows sync --go --json），
//   所以这里放一个假 bili.mjs 替身 —— 验的是「接线对不对」（参数、便条、失败话术），
//   真正去 B 站读关注列表的那部分由 tests/follows.test.mjs 用假 fetch 覆盖 ✓
//
//   守四件事：
//     ① 一定带 `--go`（不带就是 dry-run —— 点了按钮却什么都没写 ✗）
//     ② 有新增 → 写便条 `<数据目录>/follows-note.json`（她下次醒来会看到一句话）
//     ③ 没有新增 / 失败 → **不留便条**（别让她为一次白跑说一句话）
//     ④ 失败时给人话 + hint（未登录 / 风控两条路要指清楚）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Readable} from 'node:stream'

// 子进程要用真 node：宿主里由 runtime.mjs 解析，测试里直接指定（DSH_NODE 是它的第一候选 ✓）
process.env.DSH_NODE = process.execPath

const BOX = fs.mkdtempSync(path.join(os.tmpdir(), 'myilidepu-follows-'))
process.env.DSH_HOME = path.join(BOX, 'dsh')
process.env.MYILIDEPU_DATA_DIR = path.join(BOX, 'data')
fs.mkdirSync(process.env.DSH_HOME, {recursive: true})
fs.mkdirSync(process.env.MYILIDEPU_DATA_DIR, {recursive: true})

const RESULT_FILE = path.join(BOX, 'result.json')
const NOTE_FILE = path.join(process.env.MYILIDEPU_DATA_DIR, 'follows-note.json')
const FAKE = path.join(BOX, 'fake-bili.mjs')

// 假 bili.mjs：把 argv 写边上（好断言参数），结果从 RESULT_FILE 读（每个用例自己写 ✓）
const ARGV_FILE = path.join(BOX, 'argv.json')
fs.writeFileSync(FAKE, [
  "import fs from 'node:fs'",
  `const p = ${JSON.stringify(RESULT_FILE)}`,
  `fs.writeFileSync(${JSON.stringify(ARGV_FILE)}, JSON.stringify(process.argv.slice(2)))`,
  'let r = {ok:true,total:0,added:[],skipped:[],removed:[],wroteConfig:false,watchups:[]}',
  "try { r = JSON.parse(fs.readFileSync(p,'utf8')) } catch {}",
  'process.stdout.write(JSON.stringify(r))',
  '',
].join('\n'), 'utf8')

// toolsPath → resolveBiliMjs() 就会用这个替身 ✓（必须在 import lib/index.js 之前写好）
fs.writeFileSync(path.join(process.env.DSH_HOME, 'myilidepu.config.json'),
  JSON.stringify({toolsPath: FAKE, watchups: []}, null, 2), 'utf8')

const realSetTimeout = globalThis.setTimeout   // 下面会把 setTimeout 打桩，先留一个真的给"等响应"用
const realClearTimeout = globalThis.clearTimeout
const fakeHandle = () => ({unref() {}, ref() {}})
globalThis.setInterval = fakeHandle
globalThis.setTimeout = fakeHandle
globalThis.clearInterval = () => {}
globalThis.clearTimeout = () => {}

const {default: plugin} = await import('../lib/index.js')
const routes = new Map()
plugin.apply({
  // 信任栅栏：真实宿主里由 connection 服务提供，缺失时插件 fail-closed 一律 503 ✗
  get: (name) => (name === 'connection' ? {requestRejection: () => null} : null),
  webServer: {register(r) { routes.set(r.path, r.handler); return () => {} }},
  effect: () => {},
})

async function call(p, {method = 'GET', body = {}} = {}) {
  const handler = routes.get(p.split('?')[0])
  assert.ok(handler, `路由没注册：${p}`)
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = method
  req.headers = {host: '127.0.0.1:1234'}
  req.url = p
  const out = {status: 200, text: ''}
  let done
  const finished = new Promise((r) => { done = r })
  const res = {
    statusCode: 200,
    writeHead(code) { this.statusCode = code },
    end(text) { out.status = this.statusCode; out.text = text == null ? '' : String(text); done() },
  }
  await handler(req, res)
  // 这条路由把结果放到 execFile 的回调里 —— handler 先返回，响应后到 ✓
  let timer = null
  await Promise.race([finished, new Promise((r) => { timer = realSetTimeout(r, 20000) })])
  if (timer) realClearTimeout(timer)   // 别让这个保险丝把测试进程多挂 20 秒 ✓
  let data = null
  try { data = JSON.parse(out.text) } catch {}
  return {status: out.status, data, text: out.text}
}

const setResult = (r) => fs.writeFileSync(RESULT_FILE, JSON.stringify(r), 'utf8')
const rmNote = () => { try { fs.rmSync(NOTE_FILE, {force: true}) } catch {} }

test('POST /follows/sync：有新增 → 带 --go、写便条、回报新增了谁', async () => {
  rmNote()
  setResult({ok: true, total: 3, wroteConfig: true,
    added: [{name: '黑鸦Heya', mid: '3706929260006322'}, {name: '新UP', mid: '123'}],
    skipped: [], removed: [], watchups: [{name: '黑鸦Heya'}, {name: '新UP'}]})
  const r = await call('/dsh-bili/api/follows/sync', {method: 'POST', body: {topics: ['DeepSeek']}})
  assert.equal(r.status, 200)
  assert.equal(r.data.ok, true)
  assert.equal(r.data.total, 3)
  assert.deepEqual(r.data.added.map((x) => x.name), ['黑鸦Heya', '新UP'])
  const note = JSON.parse(fs.readFileSync(NOTE_FILE, 'utf8'))
  assert.deepEqual(note.added.map((x) => x.mid), ['3706929260006322', '123'])
  assert.ok(note.at, '便条要有时间戳')
})

test('参数契约：一定是 follows sync --go --json（少 --go 就变成 dry-run ✗）', async () => {
  rmNote()
  try { fs.rmSync(ARGV_FILE, {force: true}) } catch {}
  setResult({ok: true, total: 1, added: [{name: 'A', mid: '1'}], skipped: [], removed: [], wroteConfig: true, watchups: []})
  await call('/dsh-bili/api/follows/sync', {method: 'POST', body: {}})
  assert.deepEqual(JSON.parse(fs.readFileSync(ARGV_FILE, 'utf8')), ['follows', 'sync', '--go', '--json'])
})

test('没有新关注 → 不动便条（别把上一条还没被读走的便条擦掉 ✗）', async () => {
  const sentinel = {at: '2026-10-25T00:00:00.000Z', added: [{name: '上一个新增', mid: '999'}]}
  fs.writeFileSync(NOTE_FILE, JSON.stringify(sentinel), 'utf8')
  setResult({ok: true, total: 2, added: [], skipped: [], removed: [{name: '走了'}], wroteConfig: false, watchups: []})
  const r = await call('/dsh-bili/api/follows/sync', {method: 'POST', body: {}})
  assert.equal(r.data.ok, true)
  assert.deepEqual(r.data.added, [])
  assert.deepEqual(JSON.parse(fs.readFileSync(NOTE_FILE, 'utf8')), sentinel, '没新增就别碰便条')
  rmNote()
})

test('未登录 → ok:false + 指路「重新存 cookie」，且不留便条', async () => {
  rmNote()
  setResult({ok: false, code: 'NO_LOGIN', message: '读不到她的账号 mid'})
  const r = await call('/dsh-bili/api/follows/sync', {method: 'POST', body: {}})
  assert.equal(r.status, 200)
  assert.equal(r.data.ok, false)
  assert.equal(r.data.code, 'NO_LOGIN')
  assert.match(r.data.hint ?? '', /cookie/)
  assert.equal(fs.existsSync(NOTE_FILE), false)
})

test('风控（apiCode）→ hint 说清是风控、隔几分钟再点', async () => {
  rmNote()
  setResult({ok: false, code: 'API', apiCode: -412, message: '请求被拦截'})
  const r = await call('/dsh-bili/api/follows/sync', {method: 'POST', body: {}})
  assert.equal(r.data.ok, false)
  assert.match(r.data.hint ?? '', /风控|-412/)
})

test('GET 这个路由 → 405（只接受 POST，别拿地址栏点）', async () => {
  const r = await call('/dsh-bili/api/follows/sync')
  assert.equal(r.status, 405)
})

test('源码契约：生物钟里彻底没有自动同步了（它曾让她一整天发不出消息）', () => {
  const sched = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'scheduler.js'), 'utf8')
  assert.equal(/kickFollowsSync|syncFollowsOnWake|FOLLOWS_SYNC_MS/.test(sched), false, '自动同步的机器应该拆干净')
  assert.equal(/syncFollows\s*\(/.test(sched), false, 'scheduler 不该再自己发关注请求')
  assert.match(sched, /follows-note\.json/, '改成读按钮写下的便条')
})

test('源码契约：设置页那一块是按钮，不是"自动同步"开关', () => {
  const cli = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8')
  assert.match(cli, /立即同步关注名单/)
  assert.match(cli, /\/follows\/sync/)
  assert.equal(/自动同步她的关注/.test(cli), false, '旧开关的文案应该没了')
})
