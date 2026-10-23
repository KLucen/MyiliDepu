// bili read —— 读一条视频的原文（v1.0 只读：字幕 / 官方总结 / 本地导入复用）
//
// 为什么单独一条命令：调度流「① 学习」要先 candidates 挑片、再 read 拿原文，
// 读懂了才可能记见闻。它只读不写平台，所以不需要 --dry/--go。
//
// 用法:
//   node read.mjs <BV|URL> [--page N] [--route auto|subtitle|conclusion|local] [--frames [N]] [--grid CxR] [--json]
//
// --frames（2026-10-23 加，P3 抽帧·轻量版）:
//   读不到文字、或者想看看「画面长什么样」时加它：用 ffmpeg 从直链 seek 抽 N 帧
//   （**不下载整片**），拼成一张九宫格 SHEET 交给 read_image。
//   它是**可选的第三条腿**：抽帧失败不会让读原文失败（只多打一段原因）。
//
// 输出:
//   --json  → { ok:true, readingId, title, author, duration, route, coverage, segments, visual?, … }
//   默认    → 标题 / UP / 时长 / 用了哪条腿 / 覆盖率 / 画面（加了 --frames）/ 原文前 2000 字
//   失败    → stderr 打印 "CODE: 原因"，退出码非 0
import { config } from '../lib/config.mjs'
import { loadCred } from '../lib/cred.mjs'
import { requireFfmpeg } from '../lib/ffmpeg.mjs'
import { visualForBv, gridForN } from '../lib/visual.mjs'
import { closeService, runCommand } from '../../lib/reading/index.mjs'

const argv = process.argv.slice(2)
const opt = {}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  const a = String(argv[i])
  if (a.startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || String(v).startsWith('--')) opt[a.slice(2)] = true
    else { opt[a.slice(2)] = v; i += 1 }
  } else positional.push(a)
}

const fail = (code, message, exitCode = 1) => {
  closeService()
  console.error(`${code}: ${message}`)
  process.exit(exitCode)
}
const usage = () => fail('USAGE', 'read <BV|URL> [--page N] [--route auto|subtitle|conclusion|local] [--frames [N]] [--grid CxR] [--json]', 2)
const clock = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
const percent = (fraction) => `${(Math.round(Number(fraction || 0) * 1000) / 10).toFixed(1)}%`

const input = positional[0]
if (!input) usage()

let page
if (opt.page !== undefined) {
  page = Number(opt.page)
  // --page 后面没跟值（裸 --page）时解析器会得到 true，这里要当成用法错误。
  if (opt.page === true || !Number.isInteger(page) || page < 1)
    fail('INVALID_PAGE', '--page 必须是正整数（从 1 开始）', 2)
}
const ROUTES = ['auto', 'subtitle', 'conclusion', 'local']
// 默认腿跟着设置页走（learning.route），命令行 --route 显式覆盖。
const route = opt.route === undefined || opt.route === true
  ? (config().learning?.route ?? 'auto')
  : String(opt.route)
if (!ROUTES.includes(route)) fail('INVALID_ROUTE', `--route 只能是 ${ROUTES.join(' | ')}`, 2)

const outcome = await runCommand((service) => service.read(input, page, undefined, route))
closeService()
if (!outcome.ok) fail(outcome.code, outcome.message)

const read = outcome.value.result
// ── 画面（可选第三条腿）：--frames [N] ──
// 放在 JSON 之前、原文预览之前：文字拿不到的时候，这一路就是唯一的内容。
let visual = null
const frameLog = []
if (opt.frames !== undefined) {
  const want = opt.frames === true ? undefined : Number(opt.frames)
  if (opt.frames !== true && (!Number.isInteger(want) || want < 1)) {
    fail('INVALID_FRAMES', '--frames 后面要么不跟值（默认 3x3=9 帧），要么跟一个正整数', 2)
  }
  let ffmpeg = null
  try { ffmpeg = requireFfmpeg() } catch (e) { visual = { ok: false, code: 'FFMPEG_MISSING', message: String(e.message) } }
  if (ffmpeg) {
    let cred = {}
    try { cred = loadCred() } catch (e) { visual = { ok: false, code: 'NO_CREDENTIALS', message: String(e.message) } }
    if (!visual) {
      visual = await visualForBv({
        bvid: read.bvid,
        n: want,
        grid: typeof opt.grid === 'string' ? opt.grid : gridForN(want ?? 9),
        cred,
        ffmpeg,
        log: (line) => frameLog.push(line),
      })
    }
  }
}

const payload = {
  ok: true,
  taskId: outcome.value.taskId,
  readingId: read.id,
  bvid: read.bvid,
  page: read.page,
  title: read.title,
  author: read.author,
  url: read.url,
  duration: read.duration,
  route: read.route,
  coverage: read.coverage,
  attempts: read.attempts,
  segments: read.segments,
  deduplicated: read.deduplicated === true,
  reusedLocalSource: read.reusedLocalSource === true,
  usage: outcome.value.usage,
  ...(visual ? { visual: visual.ok ? {
    sheet: visual.sheet,
    grid: `${visual.cols}x${visual.rows}`,
    quality: visual.quality,
    frames: visual.frames.map((f) => ({ at: f.at, atText: f.atText, path: f.path, bytes: f.bytes })),
    failed: visual.failed,
    elapsedMs: visual.elapsedMs,
  } : { ok: false, code: visual.code, message: visual.message } } : {}),
}

if (opt.json) {
  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}

const legName = { A1: 'A1 字幕', A2: 'A2 官方总结', A3: 'A3 本地导入', none: '（没有取到文字）', frame: '抽帧' }[read.route] ?? read.route
console.log(`标题：${read.title || '（无标题）'}`)
console.log(`UP：${read.author || '（未知）'} · 时长 ${clock(read.duration)}（${read.duration}s） · 第 ${read.page} 页`)
console.log(`原文 ID：${read.id}${read.reusedLocalSource ? '（复用了之前导入的本地原文）' : ''}`)
console.log(`用了哪条腿：${legName}${read.cached ? '（命中 6 小时缓存）' : ''}`)
console.log(`覆盖率：${read.coverage.state} · 有时间轴 ${read.coverage.timed_seconds}s / ${read.coverage.duration_seconds}s（${percent(read.coverage.timed_fraction)}）`)
console.log(`尝试：${read.attempts.map((a) => `${a.route}=${a.state}`).join(' · ')}`)
if (read.coverage.missing) console.log(`限度：${read.coverage.missing}`)

if (visual) {
  console.log('\n—— 画面（抽帧看图）——')
  if (visual.ok) {
    console.log(`SHEET: ${visual.sheet}`)
    console.log(`时间点：${visual.frames.map((f) => `${f.i + 1}=${f.atText}`).join('  ')}`)
    frameLog.forEach((line) => console.log(line))
    if (visual.failed.length) console.log(`（有 ${visual.failed.length} 个时间点没抽到，已跳过）`)
    console.log('（用 read_image 看 SHEET —— 脚本只备素材，不作判断）')
  } else {
    console.log(`（抽帧跳过：${visual.code} ${visual.message}）`)
  }
}

if (read.route === 'none') {
  console.log(visual?.ok
    ? '\n（这次没有取到原文 —— 只能看画面。如实说「我只看到了画面」，不要根据画面猜台词或结论 ✗）'
    : '\n（这次没有取到原文。可以：换 --route auto 再试；或把本地原文用 importLocal(route=A3) 导入后重读。）')
} else {
  const text = read.segments.map((s) => s.text).join('\n')
  const preview = text.slice(0, 2000)
  console.log(`\n—— 原文前 2000 字（共 ${text.length} 字，${read.segments.length} 段）——\n`)
  console.log(preview)
  if (preview.length < text.length) console.log('\n……（已截断；要全文用 --json）')
}
process.exit(0)
