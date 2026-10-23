// 开机自启（2026-10-23 加，对应「已知限制」里的 P2）
//
// 为什么需要它：生物钟只有在 DSH 开着的时候才会走。以前 DSH 不开 = 那一晚的窗口
//   整个错过，事后再开也不会补（这正是 P2 的另一半「catch-up」要解决的问题）。
//   用户选了「用开机自启解决」这一条 —— 保证登录后 DSH 自己在，窗口就有人守。
//
// 做法：只写当前用户注册表 HKCU\...\Run 里的一个值。
//   · HKCU = 不需要管理员，撤销也不留痕
//   · 不写启动文件夹、不建计划任务、不碰 HKLM / 服务
//   · 撤销：`node bili.mjs autostart off`，或任务管理器 → 启动应用 里禁用
//
// 诚实边界（别让这份代码假装管用）：
//   · 只在 **Windows 登录后** 触发；电脑关机/睡眠期间错过的窗口它补不回来（那是 catch-up 的事）
//   · macOS / Linux 没实现 —— status 会明说「没做」，enable 直接抛错，不假装支持
//   · 它只负责「把 DSH 拉起来」；DSH 起来之后插件能不能跑，取决于 profile / 权限（见 docs/SMOKE.md）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
export const VALUE_NAME = 'DeepSeekHarness'
export const EXE_NAME = 'DeepSeek Harness.exe'

/** 默认执行器：reg.exe（Windows 自带，不依赖 PowerShell 执行策略）
 *
 *  显式给 stdio：Node 的 execFileSync 默认会把子进程 stderr 直接透到父进程 ——
 *  于是「这一项还没设置」这种**正常情况**也会在终端上打出 reg 的本地化报错
 *  （实测：`错误: 系统找不到指定的注册表项或值。`，还是乱码），看着像出故障了 ✗
 *  这里把 stderr 收进管道：真出错时错误对象上照样拿得到，平时不吓人。 */
export function runReg(args) {
  return execFileSync('reg.exe', args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/** 可能装 DSH 的位置（先看 DSH_EXE 覆盖，再看常见的三个 Program Files 变体） */
export function dshExeCandidates(env = process.env) {
  const out = []
  if (env.DSH_EXE) out.push(env.DSH_EXE)
  if (env.LOCALAPPDATA) out.push(path.join(env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', EXE_NAME))
  if (env.ProgramFiles) out.push(path.join(env.ProgramFiles, 'DeepSeek Harness', EXE_NAME))
  if (env['ProgramFiles(x86)']) out.push(path.join(env['ProgramFiles(x86)'], 'DeepSeek Harness', EXE_NAME))
  if (env.ProgramW6432) out.push(path.join(env.ProgramW6432, 'DeepSeek Harness', EXE_NAME))
  return [...new Set(out)]
}

export function findDshExe({ env = process.env, exists = fs.existsSync } = {}) {
  for (const p of dshExeCandidates(env)) {
    try { if (exists(p)) return p } catch { /* 探不动就跳过这个候选，不静默当成"没有" */ }
  }
  return null
}

// 真机 `reg query "<key>" /v DeepSeekHarness` 的输出（2026-10-23 实测）：
//
//   HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run
//       DeepSeekHarness    REG_SZ    "C:\Users\…\DeepSeek Harness.exe"
//
// 头一行是键名（没有 REG_ 类型），数据行是「4 空格 + 名字 + 4 空格 + 类型 + 4 空格 + 值」。
export function parseRegQuery(text, valueName = VALUE_NAME) {
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const m = raw.match(/^\s+(\S.*?)\s{2,}(REG_[A-Z_]+)\s{2,}(.*)$/)
    if (!m) continue
    if (m[1].trim().toLowerCase() !== String(valueName).toLowerCase()) continue
    return m[3].trim()
  }
  return null
}

/** 注册表里存的是带引号的命令行（路径有空格时必须带），展示前剥掉 */
export function unquote(s) {
  const t = String(s ?? '').trim()
  return t.startsWith('"') && t.endsWith('"') && t.length >= 2 ? t.slice(1, -1) : t
}

const same = (a, b) => {
  if (!a || !b) return null
  try { return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase() } catch { return a === b }
}

/**
 * 现状。值不存在时 reg.exe 退出码 1 —— 那是「没设置」，不是错误，所以这里吞掉。
 * 返回 { supported, platform, exe, installed, command, registered, matches, reason? }
 */
export function status({ runner = runReg, env = process.env, exists = fs.existsSync, platform = process.platform } = {}) {
  const exe = findDshExe({ env, exists })
  const base = {
    supported: platform === 'win32',
    platform,
    valueName: VALUE_NAME,
    key: RUN_KEY,
    exe,
    installed: false,
    command: null,
    registered: null,
    matches: null,
  }
  if (platform !== 'win32') {
    return { ...base, reason: '开机自启目前只实现了 Windows。macOS / Linux 还没做 —— 这里如实说没做，不假装支持。' }
  }
  let out = ''
  try { out = runner(['query', RUN_KEY, '/v', VALUE_NAME]) } catch { return base }
  const command = parseRegQuery(out)
  if (!command) return base
  const registered = unquote(command)
  return { ...base, installed: true, command, registered, matches: same(registered, exe) }
}

/** 开启。exe 可显式给；不给就自己找。失败一律抛带 code 的错，让 CLI 决定退出码。 */
export function enable({ exe, runner = runReg, platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (platform !== 'win32') {
    const e = new Error('开机自启目前只实现了 Windows'); e.code = 'UNSUPPORTED'; throw e
  }
  const target = exe ? String(exe) : findDshExe({ env, exists })
  if (!target) { const e = new Error('找不到 DeepSeek Harness.exe：用 --exe 指定完整路径'); e.code = 'EXE_NOT_FOUND'; throw e }
  let there = false
  try { there = exists(target) } catch { there = false }
  if (!there) { const e = new Error(`这个路径不存在：${target}`); e.code = 'EXE_NOT_FOUND'; throw e }
  if (target.includes('"')) { const e = new Error('路径里不能有英文双引号'); e.code = 'BAD_PATH'; throw e }
  const command = `"${target}"`
  runner(['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', command, '/f'])
  return { exe: target, command }
}

/** 关闭。本来就没设置时不算失败（幂等）—— 重复点「关闭」不该报错。 */
export function disable({ runner = runReg, platform = process.platform } = {}) {
  if (platform !== 'win32') {
    const e = new Error('开机自启目前只实现了 Windows'); e.code = 'UNSUPPORTED'; throw e
  }
  try {
    runner(['delete', RUN_KEY, '/v', VALUE_NAME, '/f'])
    return { removed: true, already: false }
  } catch (e) {
    return { removed: false, already: true, message: String(e?.message ?? e).split(/\r?\n/)[0].slice(0, 160) }
  }
}

/** 一句话现状（CLI 和设置页都用它，避免两处各写一套措辞） */
export function describe(st) {
  if (!st.supported) return st.reason
  if (!st.installed) {
    return st.exe
      ? `没开。开了的话登录后会自动启动：${st.exe}`
      : '没开；而且没找到 DeepSeek Harness.exe —— 用 --exe 指定完整路径'
  }
  if (st.matches === false) {
    return `开着，但指向的是另一个程序（${st.registered}）—— 现在这个装法在 ${st.exe ?? '没找到的路径'}，建议重开一次`
  }
  return `已开启：登录 Windows 后会自己启动 ${st.registered}`
}
