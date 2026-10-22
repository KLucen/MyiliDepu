// bili candidates —— 给出几个「值得了解人类」的视频候选（只读）
//
// 为什么要有它：学习的第一步不是"随便点开一个"，而是先有一小份候选清单，
// 挑一条真的想了解的再 read。默认 3 条、硬上限 3 条 —— 这是"一次一条"的节制，
// 不是能调大的配额（humanism 的候选预算也是 3）。
//
// 用法:
//   node candidates.mjs [--count N] [--json]
import { config } from '../lib/config.mjs'
import { closeService, runCommand } from '../../lib/reading/index.mjs'

const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  const a = String(argv[i])
  if (a.startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || String(v).startsWith('--')) opt[a.slice(2)] = true
    else { opt[a.slice(2)] = v; i += 1 }
  }
}

const fail = (code, message, exitCode = 1) => {
  closeService()
  console.error(`${code}: ${message}`)
  process.exit(exitCode)
}

const HARD_CAP = 3
// 默认条数跟设置页走（learning.candidates，默认 3）；命令行 --count 覆盖它。
// 配置值被手改成 0/NaN 时不让命令失败，回默认 3 —— 设置坏了不该把学习流卡死。
const fromConfig = opt.count === undefined || opt.count === true
let requested = fromConfig ? Number(config().learning?.candidates ?? 3) : Number(opt.count)
if (!Number.isInteger(requested) || requested < 1) requested = fromConfig ? 3 : null
if (requested === null)
  fail('INVALID_CANDIDATES_COUNT', '--count 必须是 1..3 的整数', 2)
// 硬上限：超了不报错，直接按上限取 —— 命令承诺的是"最多 3 条"，不是"想要多少有多少"。
const clamped = requested > HARD_CAP
const count = Math.min(requested, HARD_CAP)

const outcome = await runCommand((service) => service.candidates(count))
closeService()
if (!outcome.ok) fail(outcome.code, outcome.message)

const rows = outcome.value.result
const payload = {
  ok: true,
  taskId: outcome.value.taskId,
  requested,
  clamped,
  count: rows.length,
  candidates: rows,
  usage: outcome.value.usage,
}

if (opt.json) {
  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}
console.log(`候选（${rows.length} 条${clamped ? `，--count ${count} 超过硬上限 ${HARD_CAP} 已按上限取` : ''}）：`)
for (const [i, r] of rows.entries()) {
  const mins = Math.floor((Number(r.duration) || 0) / 60)
  console.log(`  ${i + 1}. ${r.title}`)
  console.log(`     ${r.author || '（未知 UP）'} · ${mins} 分钟 · ${r.url}`)
  console.log(`     了解它的原文：node tools/bili.mjs read ${r.bvid}`)
}
console.log('\n（先挑一条真的想了解的；候选只是入口，不是任务清单。）')
process.exit(0)
