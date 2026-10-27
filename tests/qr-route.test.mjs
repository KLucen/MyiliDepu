// 扫码登录路由（v1.5.0）：cookie 过期了，手机扫一下就能换新 ✓
//
//   这两条路由的"手"很短，但每一节都可能悄悄写坏主人唯一的登录态，所以逐条钉住：
//     ① 生成：真的去问 B站 要码、真的把**那条 url** 画成 SVG（不是随便画一个）
//     ② 轮询四态：waiting / scanned / expired / ok，一个都不能混
//     ③ 成功才写凭据，且**只写这三个键**（多写一个 = 往凭据文件里塞垃圾）
//     ④ 凭据永不回显（响应体里不许出现 SESSDATA 的值）
//     ⑤ 失败一律 fail-closed：没拿到 SESSDATA/bili_jct 就**不写文件**（宁可让她再扫一次）
//     ⑥ 客户端不能传 key（否则这路由就成了"拿任意 key 换 cookie"的转发器 ✗）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {Readable} from 'node:stream'

const BOX = fs.mkdtempSync(path.join(os.tmpdir(), 'myilidepu-qr-'))
// HOME 决定 credentialsPath —— 必须指向临时箱，否则会覆盖主人真实的登录态 ✗
process.env.USERPROFILE = BOX
process.env.HOME = BOX
process.env.DSH_HOME = path.join(BOX, 'dsh')
process.env.MYILIDEPU_DATA_DIR = path.join(BOX, 'data')
fs.mkdirSync(process.env.DSH_HOME, {recursive: true})
fs.mkdirSync(process.env.MYILIDEPU_DATA_DIR, {recursive: true})
fs.mkdirSync(path.join(BOX, '.bili-ai'), {recursive: true})

const CRED = path.join(BOX, '.bili-ai', 'credentials.json')
const CONFIG = path.join(process.env.DSH_HOME, 'myilidepu.config.json')
const LOG = path.join(process.env.MYILIDEPU_DATA_DIR, 'log.jsonl')
fs.writeFileSync(CONFIG, JSON.stringify({self: {mid: '', name: ''}}, null, 2), 'utf8')

// 定时器打桩：宿主 apply() 里有调度器，测试里不需要它真的跑 ✓
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const fakeHandle = () => ({unref() {}, ref() {}})
globalThis.setInterval = fakeHandle
globalThis.setTimeout = fakeHandle
globalThis.clearInterval = () => {}
globalThis.clearTimeout = () => {}

// ── 假 fetch：每个用例自己决定 B站 怎么答 ────────────────────────────────────
const calls = []
let responder = () => ({json: {code: 0, data: {}}})
globalThis.fetch = async (url, opts) => {
  calls.push({url: String(url), opts})
  const r = (await responder(String(url), opts)) || {}
  return {
    status: r.status ?? 200,
    headers: {getSetCookie: () => r.setCookies ?? []},
    json: async () => r.json ?? {},
  }
}

const {default: plugin} = await import('../lib/index.js')
const {qrSvg} = await import('../lib/qr.mjs')

const routes = new Map()
plugin.apply({
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
  let timer = null
  await Promise.race([finished, new Promise((r) => { timer = realSetTimeout(r, 20000) })])
  if (timer) realClearTimeout(timer)
  let data = null
  try { data = JSON.parse(out.text) } catch {}
  return {status: out.status, data, text: out.text}
}

const GEN_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate'
const POLL_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll'
const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav'
const SPI_URL = 'https://api.bilibili.com/x/frontend/finger/spi'

const QR_URL = 'https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=' + 'a'.repeat(32)
const QR_KEY = 'a'.repeat(32)
const SESS = 'SESSDATA-VALUE-abcdefghijklmnop'
const JCT = 'b'.repeat(32)

const rmCred = () => { try { fs.rmSync(CRED, {force: true}) } catch {} }
const rmLog = () => { try { fs.rmSync(LOG, {force: true}) } catch {} }
const genOk = (url = QR_URL) => ({json: {code: 0, message: 'OK', data: {url, qrcode_key: QR_KEY}}})
const pollCode = (code) => ({json: {code: 0, data: {code, message: code === 86101 ? '未扫码' : 'x', url: '', timestamp: 0}}})

// 用例之间会串状态（pending 是宿主的模块级变量）→ 需要"无悬挂"时先清一次。
// 用 86038 轮一次：有悬挂就清掉，没悬挂就直接是 expired，两条路都通向 null ✓
async function clearPending() {
  const keep = responder
  responder = () => pollCode(86038)
  await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  responder = keep
  calls.length = 0
}

// ── ① 生成 ───────────────────────────────────────────────────────────────────

test('POST /login/qr：问 B站 要码，并把**那条 url** 画成 SVG', async () => {
  calls.length = 0
  responder = (u) => (u.startsWith(GEN_URL) ? genOk() : {json: {}})
  const r = await call('/dsh-bili/api/login/qr', {method: 'POST'})
  assert.equal(r.status, 200)
  assert.equal(r.data.ok, true)
  assert.equal(r.data.expiresIn, 180)
  assert.equal(r.data.url, QR_URL)
  const svg = r.data.svg
  assert.ok(svg.startsWith('<svg '), '要回一段 SVG')
  assert.ok(/^[\x00-\x7f]*$/.test(svg), 'SVG 必须纯 ASCII（客户端要 btoa）')
  // 关键：画的必须是 B站 给的那条 url —— 用同一个生成器复算一遍比对 ✓
  assert.equal(svg, qrSvg(QR_URL, {ec: 'M', scale: 6, margin: 4}))
  assert.equal(calls.filter((c) => c.url.startsWith(GEN_URL)).length, 1)
})

test('B站 不给码 → 502 + 人话，且不留悬挂状态', async () => {
  await clearPending()          // 上一个用例会留下一个有效 pending，先清掉
  responder = () => ({json: {code: -412, message: '请求被拦截'}})
  const r = await call('/dsh-bili/api/login/qr', {method: 'POST'})
  assert.equal(r.status, 502)
  assert.equal(r.data.ok, false)
  assert.match(r.data.error, /-412/)
  // 没生成成功 → 接着轮询应当是"过期"，而且**不去打 B站**（不留半截状态）
  calls.length = 0
  const p = await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  assert.equal(p.data.status, 'expired')
  assert.equal(calls.length, 0)
})

test('连不上 B站 → 502，不抛异常', async () => {
  responder = () => { throw new Error('fetch failed') }
  const r = await call('/dsh-bili/api/login/qr', {method: 'POST'})
  assert.equal(r.status, 502)
  assert.match(r.data.error, /连不上 B站 登录接口/)
})

// ── ② 轮询四态 ───────────────────────────────────────────────────────────────

test('轮询：未扫码 86101 / 已扫码 86090 / 已失效 86038 三种状态分得清', async () => {
  responder = (u) => {
    if (u.startsWith(GEN_URL)) return genOk()
    if (u.startsWith(POLL_URL)) return pollCode(86101)
    return {json: {}}
  }
  await call('/dsh-bili/api/login/qr', {method: 'POST'})

  let r = await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  assert.equal(r.data.status, 'waiting')

  responder = (u) => (u.startsWith(POLL_URL) ? pollCode(86090) : genOk())
  r = await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  assert.equal(r.data.status, 'scanned')

  responder = (u) => (u.startsWith(POLL_URL) ? pollCode(86038) : genOk())
  r = await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  assert.equal(r.data.status, 'expired')
  assert.match(r.data.message, /重新生成/)

  // 失效后必须清掉 pending：再来一次是 expired，且**不再打 B站** ✓
  calls.length = 0
  r = await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  assert.equal(r.data.status, 'expired')
  assert.equal(calls.length, 0)
})

test('轮询带的 key 是服务端记的那个，客户端塞不进来', async () => {
  responder = (u) => (u.startsWith(GEN_URL) ? genOk() : pollCode(86101))
  await call('/dsh-bili/api/login/qr', {method: 'POST'})
  calls.length = 0
  // 客户端故意传一个 key —— 必须被无视（否则就成了拿任意 key 换 cookie 的转发器 ✗）
  await call('/dsh-bili/api/login/qr/poll', {method: 'POST', body: {key: 'attacker-controlled-key'}})
  const polled = calls.find((c) => c.url.startsWith(POLL_URL))
  assert.ok(polled, '应该真的去轮询了')
  assert.ok(polled.url.includes(QR_KEY), '轮询用的是服务端记下的 key')
  assert.ok(!polled.url.includes('attacker'), '客户端传的 key 不许进 URL')
})

// ── ③ 成功写凭据 ─────────────────────────────────────────────────────────────

test('扫码成功 → 写 credentials.json（只三个键）+ 刷 self + 记账 + 响应里没有凭据', async () => {
  rmCred(); rmLog()
  fs.writeFileSync(CONFIG, JSON.stringify({self: {mid: '', name: ''}}, null, 2), 'utf8')
  responder = (u) => {
    if (u.startsWith(GEN_URL)) return genOk()
    if (u.startsWith(POLL_URL)) {
      return {
        json: {code: 0, data: {code: 0, message: '', url: '', refresh_token: 'rt', timestamp: Date.now()}},
        setCookies: [
          `SESSDATA=${SESS}; Path=/; Domain=bilibili.com; HttpOnly`,
          `bili_jct=${JCT}; Path=/; Domain=bilibili.com`,
          'DedeUserID=3747573946911655; Path=/',
        ],
      }
    }
    if (u.startsWith(NAV_URL)) return {json: {code: 0, data: {isLogin: true, mid: 3747573946911655, uname: '肥鱼嘟嘟可'}}}
    if (u.startsWith(SPI_URL)) return {json: {code: 0, data: {b_3: 'BUV-FROM-SPI', b_4: 'x'}}}
    return {json: {}}
  }
  await call('/dsh-bili/api/login/qr', {method: 'POST'})
  const r = await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  assert.equal(r.status, 200)
  assert.equal(r.data.status, 'ok')
  assert.equal(r.data.self.name, '肥鱼嘟嘟可')
  assert.equal(r.data.self.mid, '3747573946911655')
  assert.equal(r.data.buvid3, 'present')
  assert.match(r.data.detail, /已更新/)

  const cred = JSON.parse(fs.readFileSync(CRED, 'utf8'))
  assert.deepEqual(Object.keys(cred).sort(), ['bili_jct', 'buvid3', 'sessdata'], '只许这三个键')
  assert.equal(cred.sessdata, SESS)
  assert.equal(cred.bili_jct, JCT)
  assert.equal(cred.buvid3, 'BUV-FROM-SPI', '本地没有 buvid3 时要去 spi 拿一个')

  // 凭据永不回显 ✗
  assert.ok(!r.text.includes(SESS), '响应体里不许出现 SESSDATA')
  assert.ok(!r.text.includes(JCT), '响应体里不许出现 bili_jct')

  // self 写回配置（设置页那两格要跟着变 ✓）
  assert.equal(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).self.mid, '3747573946911655')

  // 记一笔流水（她/主人能在日志里看到"什么时候换的 cookie"）
  const line = JSON.parse(fs.readFileSync(LOG, 'utf8').trim().split('\n')[0])
  assert.equal(line.kind, 'login-qr')
  assert.match(line.note, /扫码登录成功/)

  // 用掉之后 pending 清空 → 再轮询是 expired，不再打 B站 ✓
  calls.length = 0
  const again = await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  assert.equal(again.data.status, 'expired')
  assert.equal(calls.length, 0)
})

test('已有 buvid3 → 沿用旧的，不去打 spi', async () => {
  rmCred()
  fs.writeFileSync(CRED, JSON.stringify({sessdata: 'old', bili_jct: 'old', buvid3: 'KEEP-ME'}), 'utf8')
  responder = (u) => {
    if (u.startsWith(GEN_URL)) return genOk()
    if (u.startsWith(POLL_URL)) return {json: {code: 0, data: {code: 0}}, setCookies: [`SESSDATA=${SESS}`, `bili_jct=${JCT}`]}
    if (u.startsWith(NAV_URL)) return {json: {code: 0, data: {isLogin: true, mid: 1, uname: 'X'}}}
    return {json: {}}
  }
  await call('/dsh-bili/api/login/qr', {method: 'POST'})
  const r = await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  assert.equal(r.data.status, 'ok')
  assert.equal(JSON.parse(fs.readFileSync(CRED, 'utf8')).buvid3, 'KEEP-ME')
  assert.equal(calls.filter((c) => c.url.startsWith(SPI_URL)).length, 0)
})

test('Set-Cookie 缺失时，退回解析 crossDomain url 里的查询串（两条来源都要能拿到）', async () => {
  rmCred()
  const cross = `https://passport.biligame.com/crossDomain?DedeUserID=123&DedeUserID__ckMd5=abc&SESSDATA=${SESS}&bili_jct=${JCT}&gourl=https%3A%2F%2Fpassport.bilibili.com`
  responder = (u) => {
    if (u.startsWith(GEN_URL)) return genOk()
    if (u.startsWith(POLL_URL)) return {json: {code: 0, data: {code: 0, url: cross}}, setCookies: []}
    if (u.startsWith(NAV_URL)) return {json: {code: 0, data: {isLogin: true, mid: 9, uname: '兜底'}}}
    if (u.startsWith(SPI_URL)) return {json: {code: 0, data: {b_3: 'B3'}}}
    return {json: {}}
  }
  await call('/dsh-bili/api/login/qr', {method: 'POST'})
  const r = await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  assert.equal(r.data.status, 'ok')
  const cred = JSON.parse(fs.readFileSync(CRED, 'utf8'))
  assert.equal(cred.sessdata, SESS)
  assert.equal(cred.bili_jct, JCT)
})

// ── ④ fail-closed ────────────────────────────────────────────────────────────

test('拿到了成功码但没给全 cookie → 不写文件（宁可让她再扫一次）', async () => {
  rmCred()
  responder = (u) => {
    if (u.startsWith(GEN_URL)) return genOk()
    if (u.startsWith(POLL_URL)) return {json: {code: 0, data: {code: 0}}, setCookies: [`SESSDATA=${SESS}`]}
    return {json: {}}
  }
  await call('/dsh-bili/api/login/qr', {method: 'POST'})
  const r = await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  assert.equal(r.status, 502)
  assert.equal(r.data.ok, false)
  assert.match(r.data.error, /没把 SESSDATA\/bili_jct 一起给全/)
  assert.equal(fs.existsSync(CRED), false, '不许写半截凭据 ✗')
})

test('nav 不认这串 cookie → 凭据照样写（B站 登录确实成功了），但要说清楚', async () => {
  rmCred()
  responder = (u) => {
    if (u.startsWith(GEN_URL)) return genOk()
    if (u.startsWith(POLL_URL)) return {json: {code: 0, data: {code: 0}}, setCookies: [`SESSDATA=${SESS}`, `bili_jct=${JCT}`]}
    if (u.startsWith(NAV_URL)) return {json: {code: -101, message: '账号未登录'}}
    if (u.startsWith(SPI_URL)) return {json: {code: 0, data: {b_3: 'B3'}}}
    return {json: {}}
  }
  await call('/dsh-bili/api/login/qr', {method: 'POST'})
  const r = await call('/dsh-bili/api/login/qr/poll', {method: 'POST'})
  assert.equal(r.data.status, 'ok')
  assert.equal(r.data.self, null)
  assert.match(r.data.detail, /-101/)
  assert.equal(fs.existsSync(CRED), true)
})

// ── ⑤ 门禁 ───────────────────────────────────────────────────────────────────

test('GET → 405；非回环 → 403（两条路由都要）', async () => {
  for (const p of ['/dsh-bili/api/login/qr', '/dsh-bili/api/login/qr/poll']) {
    const g = await call(p, {method: 'GET'})
    assert.equal(g.status, 405, `${p} 的 GET 应当 405`)
  }
  // 非回环：临时把 host 换掉，走 isLoopbackReq 的拒绝分支
  const handler = routes.get('/dsh-bili/api/login/qr')
  const req = Readable.from([Buffer.from('{}')])
  req.method = 'POST'
  req.headers = {host: '10.0.0.9:1234'}
  req.url = '/dsh-bili/api/login/qr'
  let code = 0
  let text = ''
  const res = {writeHead(c) { code = c }, end(t) { text = t == null ? '' : String(t) }}
  await handler(req, res)
  assert.equal(code, 403)
  assert.match(text, /只接受本机回环访问/)
})

test('源码契约：客户端只从服务端拿 key、路由里不出现任何凭据回显字段', () => {
  const cli = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(cli, /扫码登录/, '设置页要有这个入口')
  assert.match(cli, /\/login\/qr/, '要打生成路由')
  assert.match(cli, /\/login\/qr\/poll/, '要打轮询路由')
  assert.match(cli, /data:image\/svg\+xml;base64,/, '二维码走 data URL（不依赖外部图床）')
  assert.ok(!/sessdata\s*:/.test(cli.match(/login\/qr[\s\S]{0,400}/)?.[0] ?? ''), '客户端不许在扫码流程里碰 sessdata 字段')

  const host = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(host, /qrSvg\(url/, '宿主用 lib/qr.mjs 画码')
  assert.match(host, /qrcode_key/, '要按官方接口带 qrcode_key')
  assert.ok(!/json\(res[^)]*sessdata/.test(host), '响应体里不许回显 sessdata')
})
