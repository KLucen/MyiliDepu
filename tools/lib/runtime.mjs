import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Verify execution using a file: an Electron process can exit zero without running JS.
export function probeRuntime(file, env) {
  let dir
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-node-'))
    const proof = path.join(dir, 'proof')
    const r = spawnSync(file, ['-e', 'require("fs").writeFileSync(process.argv[1],process.versions.node)', proof],
      { env, stdio: 'ignore', windowsHide: true, timeout: 10000 })
    return !r.error && r.status === 0 && /^\d+\./.test(fs.readFileSync(proof, 'utf8'))
  } catch { return false }
  finally { if (dir) fs.rmSync(dir, { recursive: true, force: true }) }
}
export function resolveRuntime(dshHome, options = {}) {
  const env = options.env ?? process.env, platform = options.platform ?? process.platform
  const home = options.home ?? (env.USERPROFILE || env.HOME || os.homedir())
  const electron = options.electron ?? Boolean(process.versions.electron)
  const current = options.execPath ?? process.execPath
  const probe = options.probe ?? probeRuntime
  const bin = platform === 'win32' ? 'node.exe' : 'node'
  const cands = [env.DSH_NODE, env.DSH_DESKTOP_NODE_EXECUTABLE]
  for (const root of new Set([path.join(dshHome, 'dsh-runtimes'), path.join(home, '.dsh', 'dsh-runtimes')])) {
    try { for (const d of fs.readdirSync(root)) cands.push(path.join(root, d, 'dependencies', 'node', 'bin', bin)) } catch {}
  }
  const sep = platform === 'win32' ? ';' : ':'
  for (const dir of String(env.PATH ?? '').split(sep)) if (dir) cands.push(path.join(dir.replace(/^"|"$/g, ''), bin))
  if (platform === 'darwin') cands.push('/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node', '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node')
  if (platform === 'win32' && env.ProgramFiles) cands.push(path.join(env.ProgramFiles, 'nodejs', bin))
  if (options.allowCurrent && !electron) cands.push(current)
  const tried = []
  for (const file of new Set(cands.filter(Boolean))) {
    tried.push(file)
    try { if (fs.statSync(file).isFile() && probe(file, env)) return { file, env: { ...env }, kind: 'node' } } catch {}
  }
  if (electron) {
    const nodeEnv = { ...env, ELECTRON_RUN_AS_NODE: '1' }
    if (probe(current, nodeEnv)) return { file: current, env: nodeEnv, kind: 'electron' }
  }
  // 2026-10-23（P1）：报错里带上「试过哪些地方」——
  //   以前只说"找不到"，使用者不知道该往哪儿看；现在一眼能看出是 PATH 没配、还是 DSH_NODE 指错了。
  throw Error(
    '[myilidepu] 找不到可执行脚本的 node 运行时（已试 ' + tried.length + ' 个候选：'
    + 'DSH_NODE / DSH_DESKTOP_NODE_EXECUTABLE / <dshHome>/dsh-runtimes/*/dependencies/node/bin / PATH / Program Files\\nodejs）。'
    + '请把 DSH_NODE 设成真实 node 的绝对路径（Windows 常见 C:\\Program Files\\nodejs\\node.exe），然后完全退出并重启 DSH。'
  )
}
