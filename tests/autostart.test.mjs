// 开机自启的纯逻辑测试（2026-10-23）
//
// 为什么不用真注册表跑：这个仓库的测试必须在**任何机器**上都能过，而且不该改测试机的
//   登录项。所以这里全部走假 runner —— 只验「参数拼对了没 / 输出解析对了没 / 失败怎么报」，
//   真注册表那一次由 CLI 冒烟（node bili.mjs autostart status）在真机上单独确认。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  parseRegQuery, unquote, status, enable, disable, describe,
  findDshExe, dshExeCandidates, RUN_KEY, VALUE_NAME,
} from '../tools/lib/autostart.mjs'

// 2026-10-23 从本机 `reg query HKCU\...\Run /v QuarkUpdaterTaskUser1.0.0.21` 抄回来的真实格式
const REAL_QUERY = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
  '    QuarkUpdaterTaskUser1.0.0.21    REG_SZ    "C:\\Users\\KLucen\\AppData\\Local\\QuarkUpdater\\QuarkUpdater\\1.0.0.21\\updater.exe" --wake --enable-logging',
  '',
  '',
].join('\r\n')

const EXE = 'C:\\Users\\KLucen\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe'

test('parseRegQuery 能从真实格式里取到值（含路径空格与后面的参数）', () => {
  assert.equal(
    parseRegQuery(REAL_QUERY, 'QuarkUpdaterTaskUser1.0.0.21'),
    '"C:\\Users\\KLucen\\AppData\\Local\\QuarkUpdater\\QuarkUpdater\\1.0.0.21\\updater.exe" --wake --enable-logging',
  )
})

test('parseRegQuery 对「只有键名头、没有该项」返回 null（值不存在是常态，不是错误）', () => {
  const onlyHeader = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n\r\n'
  assert.equal(parseRegQuery(onlyHeader, VALUE_NAME), null)
  assert.equal(parseRegQuery('', VALUE_NAME), null)
  assert.equal(parseRegQuery(null, VALUE_NAME), null)
})

test('parseRegQuery 不会把别的项错认成自己', () => {
  assert.equal(parseRegQuery(REAL_QUERY, VALUE_NAME), null)
})

test('unquote 只剥成对的引号，别的不动', () => {
  assert.equal(unquote('"C:\\a b\\x.exe"'), 'C:\\a b\\x.exe')
  assert.equal(unquote('C:\\a b\\x.exe'), 'C:\\a b\\x.exe')
  assert.equal(unquote('"C:\\half'), '"C:\\half')
  assert.equal(unquote(''), '')
})

test('dshExeCandidates/findDshExe：DSH_EXE 优先，找不到就返回 null', () => {
  const env = { DSH_EXE: 'D:\\custom\\dsh.exe', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }
  const list = dshExeCandidates(env)
  assert.equal(list[0], 'D:\\custom\\dsh.exe')
  assert.ok(list.some((p) => p.endsWith(path.join('Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'))))
  assert.equal(findDshExe({ env, exists: () => false }), null)
  assert.equal(findDshExe({ env, exists: (p) => p === 'D:\\custom\\dsh.exe' }), 'D:\\custom\\dsh.exe')
  // 候选存在但 exists 抛错时不能被当成"找到"
  assert.equal(findDshExe({ env, exists: () => { throw new Error('EACCES') } }), null)
})

test('status：值不存在（reg 退出码非 0）→ installed=false，不是错误', () => {
  const runner = () => { const e = new Error('reg exited 1'); throw e }
  const st = status({ runner, platform: 'win32', env: { LOCALAPPDATA: 'C:\\L' }, exists: (p) => p.includes('DeepSeek Harness') })
  assert.equal(st.supported, true)
  assert.equal(st.installed, false)
  assert.equal(st.command, null)
  assert.ok(st.exe.includes('DeepSeek Harness.exe'))
})

test('status：已设置 → 解析出注册的命令，并与当前 exe 比对', () => {
  const out = `\r\n${RUN_KEY}\r\n    ${VALUE_NAME}    REG_SZ    "${EXE}"\r\n\r\n`
  const env = { LOCALAPPDATA: 'C:\\Users\\KLucen\\AppData\\Local' }
  const exists = (p) => p === EXE
  const st = status({ runner: () => out, platform: 'win32', env, exists })
  assert.equal(st.installed, true)
  assert.equal(st.command, `"${EXE}"`)
  assert.equal(st.registered, EXE)
  assert.equal(st.matches, true)

  // 装到别处（比如换盘/升级）→ 必须报 matches=false，让人知道指向的是旧程序
  const other = `\r\n${RUN_KEY}\r\n    ${VALUE_NAME}    REG_SZ    "D:\\Old\\DeepSeek Harness.exe"\r\n\r\n`
  const st2 = status({ runner: () => other, platform: 'win32', env, exists })
  assert.equal(st2.installed, true)
  assert.equal(st2.matches, false)
  assert.match(describe(st2), /另一个程序/)
})

test('status：非 Windows 明说没实现，不假装支持', () => {
  const st = status({ platform: 'linux', env: {}, exists: () => false })
  assert.equal(st.supported, false)
  assert.match(st.reason, /只实现了 Windows/)
  assert.match(describe(st), /只实现了 Windows/)
})

test('enable：拼出正确的 reg add，并且写入的是带引号的完整路径', () => {
  const calls = []
  const runner = (args) => { calls.push(args); return '' }
  const r = enable({ exe: EXE, runner, platform: 'win32', exists: () => true })
  assert.equal(r.command, `"${EXE}"`)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', `"${EXE}"`, '/f'])
})

test('enable：路径不存在 / 带双引号 / 找不到 exe → 抛带 code 的错，不写注册表', () => {
  const calls = []
  const runner = (args) => { calls.push(args); return '' }

  assert.throws(() => enable({ exe: 'C:\\nope\\x.exe', runner, platform: 'win32', exists: () => false }), (e) => e.code === 'EXE_NOT_FOUND')
  assert.throws(() => enable({ exe: 'C:\\a"b\\x.exe', runner, platform: 'win32', exists: () => true }), (e) => e.code === 'BAD_PATH')
  assert.throws(
    () => enable({ runner, platform: 'win32', env: {}, exists: () => false }),
    (e) => e.code === 'EXE_NOT_FOUND',
  )
  assert.equal(calls.length, 0, '失败时一次注册表都不该写')

  assert.throws(() => enable({ exe: EXE, runner, platform: 'darwin', exists: () => true }), (e) => e.code === 'UNSUPPORTED')
})

test('disable：删成功 → removed；本来就没有 → already，不算失败（幂等）', () => {
  const calls = []
  const ok = disable({ runner: (a) => { calls.push(a); return '' }, platform: 'win32' })
  assert.deepEqual(ok, { removed: true, already: false })
  assert.deepEqual(calls[0], ['delete', RUN_KEY, '/v', VALUE_NAME, '/f'])

  const missing = disable({ runner: () => { throw new Error('错误: 系统找不到指定的注册表项或值。') }, platform: 'win32' })
  assert.equal(missing.removed, false)
  assert.equal(missing.already, true)
  assert.match(missing.message, /找不到/)
})

test('describe：四种状态各说各的（没开 / 开着但指向别处 / 已开 / 不支持）', () => {
  assert.match(describe({ supported: true, installed: false, exe: EXE }), /^没开/)
  assert.match(describe({ supported: true, installed: false, exe: null }), /没找到 DeepSeek Harness\.exe/)
  assert.match(describe({ supported: true, installed: true, matches: true, registered: EXE }), /^已开启/)
  assert.match(describe({ supported: false, reason: 'r' }), /^r$/)
})
