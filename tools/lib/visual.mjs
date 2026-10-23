// 抽帧看图（ffmpeg）—— 2026-10-23 P3「轻」版
//
// 为什么是「轻」：**不下载整片**。
//   ffmpeg 的 `-ss` 放在 `-i` 之前是 input seek，走 HTTP Range 只取需要的那一段。
//   实测（本机 2026-10-23）：
//     · 182s / 24.78 MB 的片子，抽 3 帧各花 553 / 576 / 749 ms，单帧 70–160 KB
//     · 对照 bili-watch 的老路（先整片落盘再抽）得先把那 24.78 MB 下完
//   于是 AGENTS.md 里「抽帧是成本最高的一步」这条约束，现在真的轻了。
//
// ⚠️ 必须带 Referer：不带的话 B 站 CDN 直接 403。
//   实测原话：`Error opening input: Server returned 403 Forbidden (access denied)`
//   —— 而同一条直链用 fetch 带 Referer 是 206。所以 ffmpeg 这边要显式给
//   `-user_agent` 和 `-headers "Referer: ..."`（这是本模块存在的第二个理由）。
//
// 与 humanism 的差别（有意为之）：humanism 那套走 Python 抽帧 + 每页 4 帧分页下发，
//   这里换成 ffmpeg + 一张九宫格拼图。理由：合并版已经证明「一张 SHEET 交给
//   read_image」这条路能用（tools/commands/bili-watch.mjs），且不引入 Python 依赖。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from './capture.mjs'
import { apiGet } from './bili-api.mjs'
import { dataPath } from './paths.mjs'

export const BILI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
export const BILI_REFERER = 'https://www.bilibili.com/'

/** 抓帧时给 ffmpeg 的鉴权参数（顺序要紧：-user_agent / -headers 必须在 -i 之前） */
export function biliFfmpegArgs(ua = BILI_UA, referer = BILI_REFERER) {
  return ['-user_agent', ua, '-headers', `Referer: ${referer}\r\nOrigin: ${referer}\r\n`]
}

/** 从凭据对象拼 B 站 cookie 头（字段名两种写法都认，缺哪个就少哪个） */
export function biliCookie(cred = {}) {
  const parts = []
  const sess = cred.sessdata ?? cred.SESSDATA
  const jct = cred.bili_jct ?? cred.biliJct ?? cred.BILI_JCT
  const buvid = cred.buvid3 ?? cred.buvid ?? cred.BUVID3
  if (sess) parts.push(`SESSDATA=${sess}`)
  if (jct) parts.push(`bili_jct=${jct}`)
  if (buvid) parts.push(`buvid3=${buvid}`)
  return parts.join('; ')
}

export function biliHeaders(cred = {}) {
  return { 'user-agent': BILI_UA, referer: BILI_REFERER, cookie: biliCookie(cred) }
}

/** '3x3' / '3X3' / '1x9' → {cols, rows}；不合法就抛（带人话） */
export function parseGrid(text, fallback = '3x3') {
  const raw = String(text ?? fallback).trim().toLowerCase()
  const m = /^(\d{1,2})x(\d{1,2})$/.exec(raw)
  const cols = m ? Number(m[1]) : 0
  const rows = m ? Number(m[2]) : 0
  if (!cols || !rows || cols * rows > 36) {
    const e = new Error(`格子格式应是 3x3 这样（列x行，最多 36 格）：收到「${text}」`)
    e.code = 'INVALID_GRID'
    throw e
  }
  return { cols, rows }
}

/** 只给了 --n 没给 --grid 时，按张数挑一个刚好装得下的格子（避免一堆黑格） */
export function gridForN(n) {
  const count = Math.max(1, Math.min(36, Math.floor(Number(n) || 9)))
  const cols = Math.ceil(Math.sqrt(count))
  const rows = Math.ceil(count / cols)
  return `${cols}x${rows}`
}

/** '83' / '1:23' / '01:23.5' → 秒（负数与脏值都抛） */
export function parseClock(text) {
  const s = String(text ?? '').trim()
  const m = /^(?:(\d{1,3}):)?(\d{1,3}(?:\.\d+)?)$/.exec(s)
  if (!m) {
    const e = new Error(`时间点应是 83 或 1:23 这样：收到「${text}」`)
    e.code = 'INVALID_TIME'
    throw e
  }
  const sec = Number(m[1] ?? 0) * 60 + Number(m[2])
  if (!Number.isFinite(sec) || sec < 0) {
    const e = new Error(`时间点不合法：收到「${text}」`)
    e.code = 'INVALID_TIME'
    throw e
  }
  return sec
}

export const fmtClock = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * 均匀取 N 个时间点，避开首尾各 edge 比例。
 * 为什么不从 0 开始：片头基本是 logo / 黑场 / 免责声明，抽到等于浪费一格。
 * 为什么不做“吸附画面变化点”：那要先解码整片（bili-watch 能做是因为它已经下载了），
 *   轻量版的价值就在不下载 —— 所以这里只做均匀骨架，要更准就多抽几帧。
 */
export function pickTimes(duration, n, { edge = 0.06 } = {}) {
  const count = Math.max(1, Math.floor(Number(n) || 1))
  const dur = Number(duration)
  if (!Number.isFinite(dur) || dur <= 0) return Array.from({ length: count }, (_, i) => i)
  const lo = dur * Math.min(0.4, Math.max(0, edge))
  const hi = dur - lo
  if (hi <= lo) return [dur / 2]
  return Array.from({ length: count }, (_, i) =>
    count === 1 ? Number(((lo + hi) / 2).toFixed(2)) : Number((lo + ((hi - lo) * i) / (count - 1)).toFixed(2)),
  )
}

/** 抽一帧：`-ss` 在 `-i` 之前＝input seek（Range 请求，不下整片） */
export function grabFrame({ run = execFileSync, ffmpeg, url, at, dst, ua, referer, timeoutMs = 60_000 }) {
  const args = [
    '-y', '-loglevel', 'error',
    ...biliFfmpegArgs(ua, referer),
    '-ss', Number(at).toFixed(2),
    '-i', url,
    '-frames:v', '1', '-q:v', '3',
    dst,
  ]
  run(ffmpeg, args, { timeout: timeoutMs })
  if (!fs.existsSync(dst)) {
    const e = new Error(`ffmpeg 说成功但没写出文件：t=${at}s`)
    e.code = 'FRAME_MISSING'
    throw e
  }
  return { path: dst, bytes: fs.statSync(dst).size }
}

/** 把抽好的帧拼成一张图（同一批帧共用，跟 bili-watch 的 SHEET 一个路子） */
export function montageSheet({ run = execFileSync, ffmpeg, frames, cols, rows, sheet, cellWidth = 480, timeoutMs = 120_000 }) {
  const args = [
    '-y', '-loglevel', 'error',
    '-i', path.join(path.dirname(frames[0]), 'f%02d.jpg'),
    '-vf', `scale=${cellWidth}:-1,tile=${cols}x${rows}`,
    '-frames:v', '1', sheet,
  ]
  run(ffmpeg, args, { timeout: timeoutMs })
  if (!fs.existsSync(sheet)) {
    const e = new Error('九宫格没生成')
    e.code = 'SHEET_MISSING'
    throw e
  }
  return { path: sheet, bytes: fs.statSync(sheet).size }
}

/**
 * 抽帧 + 拼图。返回 { sheet, frames:[{i, at, atText, path, bytes}] }。
 * 单帧失败**不算整体失败**（网络抖一下不该让整次抽帧白跑），但会记在 failed 里，
 * 且失败数 ≥ 全部时才算失败 —— 报错时把 ffmpeg 的原话带上，别让人猜。
 */
export function extractFrames({
  run = execFileSync,
  ffmpeg,
  url,
  times,
  outDir,
  cols,
  rows,
  ua,
  referer,
  timeoutMs = 60_000,
  log = () => {},
}) {
  fs.mkdirSync(outDir, { recursive: true })
  const frames = []
  const failed = []
  times.forEach((at, i) => {
    const dst = path.join(outDir, `f${String(i).padStart(2, '0')}.jpg`)
    try {
      const got = grabFrame({ run, ffmpeg, url, at, dst, ua, referer, timeoutMs })
      frames.push({ i, at, atText: fmtClock(at), path: dst, bytes: got.bytes })
      log(`  ✓ ${fmtClock(at)}  ${(got.bytes / 1024).toFixed(0)} KB`)
    } catch (error) {
      failed.push({ at, message: String(error.message).slice(0, 200) })
      log(`  ✗ ${fmtClock(at)}  ${String(error.message).slice(0, 120)}`)
    }
  })
  if (!frames.length) {
    const e = new Error(`一帧都没抽到（${failed.length} 个时间点全失败）。第一个错误：${failed[0]?.message ?? '未知'}`)
    e.code = 'NO_FRAMES'
    e.failed = failed
    throw e
  }
  const sheet = path.join(outDir, `sheet-${cols}x${rows}.jpg`)
  const made = montageSheet({ run, ffmpeg, frames: frames.map((f) => f.path), cols, rows, sheet })
  return { sheet: made.path, sheetBytes: made.bytes, frames, failed, cols, rows }
}

/** 取元数据 + 直链（与 bili-watch 同参数：platform=pc + qn=80 才不是 360p） */
export async function resolveVideo({ bvid, headers, get = apiGet }) {
  const view = await get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, headers)
  if (view.code !== 0) {
    const e = new Error(`view 失败 code=${view.code} ${view.message}`)
    e.code = 'VIEW_FAILED'
    throw e
  }
  const { cid, title, duration } = view.data
  const play = await get(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=1&platform=pc&high_quality=1`,
    headers,
  )
  const url = play.data?.durl?.[0]?.url
  if (!url) {
    const e = new Error(`没拿到直链（code=${play.code} ${play.message ?? ''}）——有些视频要登录，或只有 dash 流`)
    e.code = 'NO_PLAYURL'
    throw e
  }
  return { bvid, cid, title, duration, url, quality: play.data.quality, size: play.data.durl?.[0]?.size }
}

const QUALITY = { 16: '360P', 32: '480P', 64: '720P', 80: '1080P', 112: '1080P+', 120: '4K' }
export const qualityName = (qn) => QUALITY[qn] ?? String(qn ?? '-')

/**
 * 一条龙：BV → 直链 → 抽帧 → 拼图。给 frames.mjs 与 `read --frames` 共用。
 * 失败一律返回 { ok:false, code, message }（**不抛**）—— 抽帧是可选的第三条腿，
 * 不能让读原文那两条腿跟着一起失败。
 */
export async function visualForBv({
  bvid,
  n = 9,
  at,
  grid = '3x3',
  outDir,
  cred,
  ffmpeg,
  run = execFileSync,
  get = apiGet,
  timeoutMs = 60_000,
  log = () => {},
  stamp = new Date().toISOString().replace(/[:.]/g, '-'),
}) {
  const started = Date.now()
  let cols, rows
  try {
    ({ cols, rows } = parseGrid(grid))
  } catch (error) {
    return { ok: false, code: 'INVALID_GRID', message: error.message }
  }
  if (!ffmpeg) return { ok: false, code: 'FFMPEG_MISSING', message: '找不到 ffmpeg（抽帧看画面需要它）' }

  let video
  try {
    video = await resolveVideo({ bvid, headers: biliHeaders(cred), get })
  } catch (error) {
    return { ok: false, code: error.code ?? 'RESOLVE_FAILED', message: error.message }
  }

  let times
  if (at && at.length) {
    try {
      times = at.map((t) => (typeof t === 'number' ? t : parseClock(t)))
    } catch (error) {
      return { ok: false, code: 'INVALID_TIME', message: error.message }
    }
  } else {
    times = pickTimes(video.duration, Math.max(1, Math.min(cols * rows, Number(n) || cols * rows)))
  }

  const dir = outDir ?? dataPath('shots', 'frames', `${bvid}-${stamp}`)
  try {
    const out = extractFrames({ run, ffmpeg, url: video.url, times, outDir: dir, cols, rows, timeoutMs, log })
    return {
      ok: true,
      ...out,
      bvid,
      title: video.title,
      duration: video.duration,
      quality: qualityName(video.quality),
      times,
      elapsedMs: Date.now() - started,
      outDir: dir,
    }
  } catch (error) {
    return { ok: false, code: error.code ?? 'EXTRACT_FAILED', message: error.message, outDir: dir }
  }
}
