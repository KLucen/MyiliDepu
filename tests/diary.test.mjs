// 双日记（私人 / 公开）的 CLI 测试。
//
// 为什么用「临时 HOME + spawn 真进程」而不是 import 函数：
//   日记的两条路都是"文件 + 开关"的副作用（落盘 / 不落盘 / 对外发不发），
//   只有从进程外跑一遍，才能同时验证 exit code、stderr 和磁盘上的真实结果 ✓
//   —— 与 tests/integration.test.mjs 的 sandbox() 同一套写法。
//
// 为什么一律注入 tests/helpers/mock-fetch.mjs：
//   **任何测试都不许碰真实 B 站接口或真实凭据**。helper 会把 fetch 换成
//   记录到 $TEST_REQUESTS 的假实现，遇到没 mock 的 URL 直接抛错 →
//   一旦哪条路径偷偷联网，测试立刻失败（而不会真的发出去）。
//   所以 `requests(env) === ''` 本身就是"没发网络请求"的硬断言。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const DIARY = 'tools/commands/diary.mjs'
const MOCK_FETCH = pathToFileURL(path.join(root, 'tests/helpers/mock-fetch.mjs')).href
const today = () => new Date().toLocaleDateString('sv-SE')   // 与 CLI 相同的本地日期口径
const dataDir = (dsh) => path.join(dsh, 'myilidepu')

/**
 * 隔离 sandbox：临时 USERPROFILE + DSH_HOME + 指定配置文件。
 * opts.creds   = 造一份假凭据（默认不造：多数测试要验"没凭据时不会联网"）
 * opts.quota   = 直接写入 quota.json（字符串原样写，用来造"账本损坏"）
 */
function sandbox(t, cfg = {}, opts = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-diary-test-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const dsh = path.join(home, 'dsh-home')
  fs.mkdirSync(dsh, { recursive: true })
  fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
  const configPath = path.join(dsh, 'myilidepu.config.json')
  fs.writeFileSync(configPath, JSON.stringify({ owner: { mid: '222', name: 'Owner' }, ...cfg }))
  if (opts.creds) {
    fs.writeFileSync(path.join(home, '.bili-ai', 'credentials.json'),
      JSON.stringify({ sessdata: 'test-cookie-not-a-real-account', bili_jct: 'a'.repeat(32), buvid3: 'test-buvid' }))
  }
  if (opts.quota !== undefined) {
    fs.writeFileSync(path.join(home, '.bili-ai', 'quota.json'), typeof opts.quota === 'string' ? opts.quota : JSON.stringify(opts.quota))
  }
  const env = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    DSH_HOME: dsh,
    DSH_NODE: process.execPath,
    MYILIDEPU_CONFIG: configPath,
    TEST_REQUESTS: path.join(home, 'requests.jsonl'),
    NODE_OPTIONS: '--import=' + MOCK_FETCH,
  }
  const run = (...args) => runFile(env, DIARY, args)
  return {
    home, dsh, env, run,
    configPath,
    data: dataDir(dsh),
    privatePath: path.join(dataDir(dsh), 'diary-private.md'),
    publicPath: path.join(dataDir(dsh), 'diary-public.md'),
    logPath: path.join(dataDir(dsh), 'log.jsonl'),
    /** mock-fetch 记下的网络请求（空 = 没联网） */
    requests: () => (fs.existsSync(env.TEST_REQUESTS) ? fs.readFileSync(env.TEST_REQUESTS, 'utf8') : ''),
  }
}

function runFile(env, file, args = []) {
  const r = spawnSync(process.execPath, [path.join(root, file), ...args], { env, encoding: 'utf8', timeout: 30000 })
  assert.ifError(r.error)
  return r
}
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null)
const dateHeading = (d = today()) => new RegExp(`^##\\s+${d}\\s*$`, 'm')

// ───────────────────────── 私人日记 ─────────────────────────

test('私人日记 append：落盘、按日期分节、同一天不重复建标题', (t) => {
  const s = sandbox(t)
  let r = s.run('private', 'append', '--text', '今天真正想留下的东西')
  assert.equal(r.status, 0, r.stderr)
  assert.match(read(s.privatePath), dateHeading())
  assert.match(read(s.privatePath), /今天真正想留下的东西/)

  r = s.run('private', 'append', '--text', '第二段：同一页里接着写')
  assert.equal(r.status, 0, r.stderr)
  const text = read(s.privatePath)
  assert.equal((text.match(/^##\s+\d{4}-\d{2}-\d{2}\s*$/gm) ?? []).length, 1, '同一天只能有一个 ## 日期 标题')
  assert.match(text, /第二段：同一页里接着写/)
  assert.equal(s.requests(), '', '私人日记不联网')
})

test('私人日记 append --dry：只打印将要写入的内容 + 目标路径，不写盘', (t) => {
  const s = sandbox(t)
  const r = s.run('private', 'append', '--text', '这句只该出现在预演里', '--dry')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /dry/)
  assert.ok(r.stdout.includes(s.privatePath), 'dry 输出要带目标路径')
  assert.match(r.stdout, /这句只该出现在预演里/)
  assert.equal(fs.existsSync(s.privatePath), false, '--dry 绝不能写盘')
})

test('私人日记 append：空文本 / 超 4000 字 都 exit 2 且不写盘', (t) => {
  const s = sandbox(t)
  let r = s.run('private', 'append', '--text', '')
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /空/)

  r = s.run('private', 'append')
  assert.equal(r.status, 2, '缺 --text 也要拒绝')

  r = s.run('private', 'append', '--text', 'x'.repeat(4001))
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /4000/)

  assert.equal(fs.existsSync(s.privatePath), false)
})

test('私人日记关着（diary.private=false）→ exit 3、说明原因、不写盘', (t) => {
  const s = sandbox(t, { diary: { private: false } })
  const r = s.run('private', 'append', '--text', '关着就不该写')
  assert.equal(r.status, 3, r.stdout + r.stderr)
  assert.match(r.stderr, /私人日记关着/)
  assert.equal(fs.existsSync(s.privatePath), false)
})

test('私人日记 show：按 --days 过滤，没有文件时友好提示 exit 0', (t) => {
  const s = sandbox(t)
  let r = s.run('private', 'show')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /还没有私人日记/)

  // 手写一天很久以前 + 一天今天：--days 1 只能看到今天的
  write(s.privatePath, `## 2020-01-01\n\n很久以前写的\n\n## ${today()}\n\n今天写的\n`)
  r = s.run('private', 'show', '--days', '1')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /今天写的/)
  assert.doesNotMatch(r.stdout, /很久以前写的/)
  assert.equal(s.requests(), '')
})

// ───────────────────────── 公开日记：开关与模式 ─────────────────────────

test('公开日记默认关 → exit 3，不写本地留痕、不发请求（--dry / --go 都一样）', (t) => {
  const s = sandbox(t) // 默认 config.diary.public = false
  let r = s.run('public', 'log', '--text', '这条不该出去', '--dry')
  assert.equal(r.status, 3, r.stdout + r.stderr)
  assert.match(r.stderr, /公开日记关着/)
  assert.equal(fs.existsSync(s.publicPath), false, '关着就不该留痕')

  r = s.run('public', 'log', '--text', '这条也不该出去', '--go')
  assert.equal(r.status, 3, r.stdout + r.stderr)
  assert.equal(fs.existsSync(s.publicPath), false)
  assert.equal(s.requests(), '', '关着时更不能联网')
})

test('公开日记打开后 --dry：写本地留痕，但不发网络请求、不记账', (t) => {
  const s = sandbox(t, { diary: { public: true } })
  const r = s.run('public', 'log', '--text', '今天看到一句话：人味是写出来的。', '--dry')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /未发布/)
  const text = read(s.publicPath)
  assert.match(text, dateHeading())
  assert.match(text, /via=dynamic/)
  assert.match(text, /结果：dry/)
  assert.match(text, /人味是写出来的/)
  assert.equal(s.requests(), '', '--dry 必须零网络请求')
  assert.equal(fs.existsSync(path.join(s.home, '.bili-ai', 'quota.json')), false, '--dry 不该记发言账')
})

test('公开日记 --dry 也可以用 --via comment + --bvid 预演；缺坐标 exit 2', (t) => {
  const s = sandbox(t, { diary: { public: true } })
  let r = s.run('public', 'log', '--text', '评论预演', '--via', 'comment', '--dry')
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.equal(fs.existsSync(s.publicPath), false)

  r = s.run('public', 'log', '--text', '评论预演', '--via', 'comment', '--bvid', 'BV1xx411c7mD', '--dry')
  assert.equal(r.status, 0, r.stderr)
  const text = read(s.publicPath)
  assert.match(text, /via=comment/)
  assert.match(text, /BV:BV1xx411c7mD/)
  assert.equal(s.requests(), '')
})

test('公开日记必须显式 --dry 或 --go（两个都不给 / 同时给都 exit 2）', (t) => {
  const s = sandbox(t, { diary: { public: true } })
  let r = s.run('public', 'log', '--text', '没有模式')
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /必须显式 --dry 或 --go/)

  r = s.run('public', 'log', '--text', '两个都给', '--dry', '--go')
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.equal(fs.existsSync(s.publicPath), false)
})

test('公开日记 --go 被限额闸拒绝 → exit 4，本地留痕记失败、不联网', (t) => {
  // 账本损坏 = 最稳妥的"闸门必拒"：quota check 直接拒绝（状态未知）
  const s = sandbox(t, { diary: { public: true } }, { quota: '{"log": [ broken json' })
  const r = s.run('public', 'log', '--text', '闸门应该拒绝我', '--go')
  assert.equal(r.status, 4, r.stdout + r.stderr)
  assert.match(r.stdout + r.stderr, /额度账本损坏/, '要原样把闸门给的原因打出来')
  const text = read(s.publicPath)
  assert.match(text, /结果：失败（限额闸拒绝/)
  assert.equal(s.requests(), '', '被闸门拒绝时不能联网')
})

test('公开日记 --go 子命令失败（缺凭据）→ exit 6，留痕记失败且不真发', (t) => {
  // 不造假凭据：dynamic post 会在发请求前就因缺凭据 exit 3 → 正好验证"失败也要留痕"
  const s = sandbox(t, { diary: { public: true } })
  const r = s.run('public', 'log', '--text', '没有凭据应该发不出去', '--go')
  assert.equal(r.status, 6, r.stdout + r.stderr)
  const text = read(s.publicPath)
  assert.match(text, /结果：失败/)
  assert.match(text, /缺少凭据/)
  assert.doesNotMatch(text, /已发（动态/, '没发出去就不能写"已发"')
  assert.doesNotMatch(s.requests(), /\/create\/dyn/, 'mock-fetch 下也不该走到发布接口')
})

test('公开日记 public show：显示每条 dry/go 与结果；无留痕时友好提示', (t) => {
  const s = sandbox(t, { diary: { public: true } })
  let r = s.run('public', 'show')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /还没有公开日记留痕/)

  s.run('public', 'log', '--text', '第一条预演', '--dry')
  fs.appendFileSync(s.publicPath, '\n### 12:00:00 · via=dynamic · 目标=dynamic\n> 真的发出去了\n- 结果：已发（动态 dyn_id=123）\n')
  r = s.run('public', 'show', '--days', '1')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /第一条预演/)
  assert.match(r.stdout, /结果：dry/)
  assert.match(r.stdout, /已发（动态 dyn_id=123）/)
  assert.equal(s.requests(), '')
})

// ───────────────────────── status / 旧命令兼容 / 旧路径兜底 ─────────────────────────

test('diary status --json：结构正确、口径本地、随配置与条目变化', (t) => {
  const s = sandbox(t, { diary: { public: true } })
  let r = s.run('status', '--json')
  assert.equal(r.status, 0, r.stderr)
  const st = JSON.parse(r.stdout)
  assert.deepEqual(Object.keys(st).sort(), ['logPath', 'private', 'public'])
  assert.deepEqual(st.private, { enabled: true, path: s.privatePath, entries: 0 })
  assert.deepEqual(st.public, { enabled: true, via: 'dynamic', path: s.publicPath, entries: 0 })
  assert.equal(st.logPath, s.logPath)
  assert.equal(s.requests(), '', 'status 是纯本地查询')

  assert.equal(s.run('private', 'append', '--text', '一条').status, 0)
  assert.equal(s.run('public', 'log', '--text', '一条预演', '--dry').status, 0)
  r = s.run('status', '--json')
  const j = JSON.parse(r.stdout)
  assert.equal(j.private.entries, 1)
  assert.equal(j.public.entries, 1)

  // 开关与默认 via 都要如实反映配置
  const s2 = sandbox(t, { diary: { private: false, public: true, publicVia: 'comment' } })
  const j2 = JSON.parse(s2.run('status', '--json').stdout)
  assert.equal(j2.private.enabled, false)
  assert.equal(j2.public.enabled, true)
  assert.equal(j2.public.via, 'comment')
})

test('旧的 log / tail / show 仍可用（新数据目录）', (t) => {
  const s = sandbox(t)
  let r = s.run('log', 'test-event', '--target', 'BV1xx411c7mD', '--note', 'hello')
  assert.equal(r.status, 0, r.stderr)
  const line = JSON.parse(read(s.logPath).trim())
  assert.equal(line.kind, 'test-event')
  assert.equal(line.target, 'BV1xx411c7mD')

  r = s.run('tail', '--n', '5')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /test-event/)

  r = s.run('show')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /今日摘要|最近事件/)
})

test('旧数据目录兜底：$DSH_HOME/whale-diary.md 与 whale-log.jsonl 仍读得到', (t) => {
  const s = sandbox(t)
  const d = today()
  write(path.join(s.dsh, 'whale-diary.md'), [
    '## 看过', '',
    '| 时间 | BV | 标题 | 她的想法 |', '|---|---|---|---|',
    `| ${d} | BV1xx | 测试视频 | 有意思 |`, '',
    '## 想说', '', '- 想说的事', '',
  ].join('\n'))
  write(path.join(s.dsh, 'whale-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind: 'legacy-event', target: null, note: 'old' }) + '\n')

  const show = s.run('show')
  assert.equal(show.status, 0, show.stderr)
  assert.match(show.stdout, /看过 1 条/)
  assert.match(show.stdout, /想说但还没说 1 条/)
  assert.match(show.stdout, /legacy-event/)

  const tail = s.run('tail')
  assert.equal(tail.status, 0, tail.stderr)
  assert.match(tail.stdout, /legacy-event/)
})

test('日记总开关（diary.enabled=false）只挡旧的 show/log/tail，不影响两本日记', (t) => {
  const s = sandbox(t, { diary: { enabled: false, private: true, public: true } })

  let r = s.run('log', 'x')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /日记总开关关着/)
  assert.equal(fs.existsSync(s.logPath), false, '总开关关着时旧流水不写字')

  r = s.run('private', 'append', '--text', '总开关关了也要能写私人日记')
  assert.equal(r.status, 0, r.stderr)
  assert.match(read(s.privatePath), /总开关关了也要能写私人日记/)

  r = s.run('public', 'log', '--text', '公开日记也能预演', '--dry')
  assert.equal(r.status, 0, r.stderr)
  assert.match(read(s.publicPath), /公开日记也能预演/)
})
