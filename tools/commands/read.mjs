// bili read —— 读一条视频的原文（v1.0 只读：字幕 / 官方总结 / 本地导入复用）
//
// 为什么单独一条命令：调度流「① 学习」要先 candidates 挑片、再 read 拿原文，
// 读懂了才可能记见闻。它只读不写平台，所以不需要 --dry/--go。
//
// 用法:
//   node read.mjs <BV|URL> [--page N] [--route auto|subtitle|conclusion|local] [--json]
//
// 输出:
//   --json  → { ok:true, readingId, title, author, duration, route, coverage, segments, … }
//   默认    → 标题 / UP / 时长 / 用了哪条腿 / 覆盖率 / 原文前 2000 字
//   失败    → stderr 打印 "CODE: 原因"，退出码非 0
import { config } from '../lib/config.mjs'
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
const usage = () => fail('USAGE', 'read <BV|URL> [--page N] [--route auto|subtitle|conclusion|local] [--json]', 2)
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
if (read.route === 'none') {
  console.log('\n（这次没有取到原文。可以：换 --route auto 再试；或把本地原文用 importLocal(route=A3) 导入后重读。）')
} else {
  const text = read.segments.map((s) => s.text).join('\n')
  const preview = text.slice(0, 2000)
  console.log(`\n—— 原文前 2000 字（共 ${text.length} 字，${read.segments.length} 段）——\n`)
  console.log(preview)
  if (preview.length < text.length) console.log('\n……（已截断；要全文用 --json）')
}
process.exit(0)
