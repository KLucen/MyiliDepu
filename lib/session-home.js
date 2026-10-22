// 会话副本去重（2026-10-23）
//
// 背景（真事故）：她的会话 id 是固定的（`myilidepu`），而会话目录按 **cwd** 分桶：
//     ~/.dsh/sessions/--<编码后的工作目录>--/<会话 id>/session.v4.jsonl.zstd
// 数据目录一旦搬家（C:\...\.dsh\myilidepu\work → D:\MyDepu\work），同一个 id 就同时出现在
// 两个 project 目录里。DSH 启动时 dsh-workspace 扫描全部会话，撞见重复 id 直接抛错：
//
//     Error: duplicate JSONL session id "myilidepu" appears in multiple project directories
//     at listArtifacts (dsh-session-persistence-jsonl) → at WorkspaceRegistry.listStoredHeaders
//     → workspaceRegistry 永不激活 → sessionController / workspaceController 全部 pending
//     → 界面上表现成「会话全没了」，而且 **下一次启动才会炸**（重复是上一次运行时造出来的）。
//
// 这个模块只做一件事：把「同名会话有多份」这个状态消掉，而且**只搬不删**。
// 它不需要知道 DSH 怎么给目录命名 —— 会话文件第一帧（zstd 流的首帧）里就写着 `cwd`，
// 拿它跟当前工作目录比对，就知道哪一份是"现在这份"，其余进隔离区（可随时搬回）。
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/** DSH 存放会话的根：$DSH_HOME/sessions */
export function sessionsRoot(dshHome) {
  return path.join(dshHome, 'sessions')
}

/** 会话文件（多帧 zstd 流）的**第一帧**就是 header，里面带 id 和 cwd。 */
export function readSessionHeader(file) {
  try {
    const raw = zlib.zstdDecompressSync(fs.readFileSync(file))
    const line = raw.toString('utf8').split('\n').find((x) => x.trim() !== '')
    if (!line) return null
    const o = JSON.parse(line)
    return o && o.type === 'session' ? o : null
  } catch {
    return null // 空文件 / 压缩块还没落盘 / 格式变了 —— 一律当作"读不出"，不当成错误
  }
}

/** 扫描所有 project 桶，找出叫 sessionId 的会话目录（可能 0/1/多份）。 */
export function scanSessionCopies(sessionId, root) {
  const out = []
  let buckets
  try {
    buckets = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out // 还没有 sessions 目录
  }
  for (const b of buckets) {
    if (!b.isDirectory()) continue
    const dir = path.join(root, b.name, sessionId)
    let st
    try {
      st = fs.statSync(dir)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue
    const file = path.join(dir, 'session.v4.jsonl.zstd')
    let fst = null
    try {
      fst = fs.statSync(file)
    } catch {}
    out.push({
      bucket: b.name,
      dir,
      file: fst ? file : null,
      mtimeMs: fst ? fst.mtimeMs : st.mtimeMs,
      size: fst ? fst.size : 0,
      header: fst ? readSessionHeader(file) : null,
    })
  }
  return out
}

const norm = (p) => String(p ?? '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()

/**
 * 把同名会话收敛成一份。
 * keepCwd：当前工作目录 —— 它的那一份是要留的（DSH 就是按 cwd 找会话）。
 * 找不到 cwd 匹配就留 mtime 最新的那份。
 * 其余**移动**到 quarantineRoot（默认 <dataDir>/.orphan-sessions/<时间戳>/<原桶>/<id>），绝不删除。
 */
export function dedupeSessionCopies({ sessionId, dshHome, keepCwd, quarantineRoot, now = Date.now }) {
  const root = sessionsRoot(dshHome)
  const copies = scanSessionCopies(sessionId, root)
  if (copies.length <= 1) {
    return { total: copies.length, kept: copies[0] ?? null, moved: [], reason: 'singleton' }
  }
  const want = norm(keepCwd)
  let keep = copies.find((c) => c.header && norm(c.header.cwd) === want)
  let reason = 'cwd'
  if (!keep) {
    keep = copies.slice().sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    reason = 'newest'
  }
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-')
  const moved = []
  for (const c of copies) {
    if (c === keep) continue
    const dest = path.join(quarantineRoot, stamp, c.bucket, sessionId)
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.renameSync(c.dir, dest)
      moved.push({ ok: true, bucket: c.bucket, from: c.dir, to: dest, size: c.size })
    } catch (e) {
      moved.push({ ok: false, bucket: c.bucket, from: c.dir, to: null, size: c.size, error: e?.message ?? String(e) })
    }
  }
  return { total: copies.length, kept: keep, moved, reason, quarantineRoot, stamp }
}
