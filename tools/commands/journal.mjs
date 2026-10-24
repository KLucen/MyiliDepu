// bili journal —— 见闻账本（只读查看 / 追加一条见闻草稿）
//
// 为什么上限要写死在代码里：见闻是"理解人"的记录，不是打卡任务。
// 一天最多 2 条（Asia/Shanghai），由 SQLite 事务内的 journal-policy 强制 ——
// 第 3 条必须失败，且失败要能被脚本识别（退出码 3 + stderr 含 JOURNAL_DAILY_LIMIT），
// 这样调度流才能"满了就跳过"，而不是把失败当成作业没跑完。
//
// 用法:
//   node journal.mjs show [--date YYYY-MM-DD] [--json]
//   node journal.mjs add --reading <id> --file <json路径>
//
// add 的 --file 里是见闻正文（JSON 对象）：encounter / missing 必填，
// facts / author_view 等其余字段可选，evidence 最多 20 条（带 at 秒）。
import fs from 'node:fs'
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
const USAGE = 'journal show [--date YYYY-MM-DD] [--json] | journal add --reading <id> --file <json路径>'
// 账本按 Asia/Shanghai 记"天"——和 journal-policy / 人格札记同一天的定义。
const dayOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const timeOf = (iso) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))

const sub = positional[0]

if (sub === 'show') {
  let date = opt.date
  if (date !== undefined) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('INVALID_DATE', '--date 格式是 YYYY-MM-DD', 2)
  }
  const outcome = await runCommand((service) => {
    let rows
    let paginated = false
    try {
      rows = service.inbox()
    } catch (e) {
      // 条数多到 readInbox 主动要求分卷时，人读模式退一步直接读账本；
      // 完整导出走 `inbox` 命令（分卷 + 索引 + 哈希校验）。
      if (e.code !== 'INBOX_PAGINATION_REQUIRED') throw e
      rows = service.store.inbox()
      paginated = true
    }
    return {
      paginated,
      entries: rows.map((e) => {
        const reading = service.store.reading(e.reading_id)
        return {
          id: e.id,
          readingId: e.reading_id,
          created: e.created,
          title: reading.title,
          url: reading.url,
          body: e.body,
        }
      }),
    }
  })
  closeService()
  if (!outcome.ok) fail(outcome.code, outcome.message)
  const entries = date ? outcome.value.entries.filter((e) => dayOf(e.created) === date) : outcome.value.entries
  const payload = { ok: true, date: date ?? null, count: entries.length, paginated: outcome.value.paginated, entries }
  if (opt.json) {
    console.log(JSON.stringify(payload, null, 2))
    process.exit(0)
  }
  console.log(`见闻账本${date ? ` · ${date}` : '（全部）'}：${entries.length} 条`)
  if (outcome.value.paginated) console.log('（账本较大，这里只列账本内的记录；完整导出请跑 node tools/bili.mjs inbox）')
  for (const e of entries) {
    console.log(`\n· ${dayOf(e.created)} ${timeOf(e.created)}  ${e.title}`)
    console.log(`  ${e.body?.encounter ? String(e.body.encounter).slice(0, 120) : '（无 encounter）'}`)
    console.log(`  仍不确定：${e.body?.missing ? String(e.body.missing).slice(0, 80) : '（未写）'} · 手账 ${e.id}`)
  }
  if (!entries.length) console.log('（还没有见闻。允许没有新发现，也允许只看一部喜欢的作品。）')
  process.exit(0)
} else if (sub === 'add') {
  const readingId = typeof opt.reading === 'string' ? opt.reading : null
  const file = typeof opt.file === 'string' ? opt.file : null
  if (!readingId || !file) fail('USAGE', USAGE, 2)
  // 2026-10-25：额度改成"跟着配置走"——learning.dailyNotes 现在**就是上限本身**
  //   （>0 = 每天最多几条；**0 = 不限**，取消了原来写死的 ≤2 条），由 Service →
  //   journal-policy 在同一个 SQLite 事务里强制，这里不再自己拦一道。
  //   这里只挡"只读不记"（learning.recordNotes=false）；同样用退出码 3 让调度流
  //   按"跳过"处理，而不是当系统故障重试。
  if (config().learning?.recordNotes === false)
    fail('JOURNAL_RECORDING_OFF', '设置里 learning.recordNotes=false：今天只读不记（这是设置，不是故障）。', 3)
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    fail('INVALID_FILE', `读不到或解析不了 --file（${file}）：${String(e.message || e).slice(0, 200)}`, 2)
  }
  const outcome = await runCommand((service) => service.journal(readingId, raw))
  closeService()
  if (!outcome.ok) {
    // 每日上限是"合法结果"而不是系统故障：用 3 区分，stderr 保留机器可读的代号。
    if (outcome.code === 'JOURNAL_DAILY_LIMIT') fail(outcome.code, outcome.message, 3)
    fail(outcome.code, outcome.message)
  }
  const result = outcome.value
  if (opt.json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    process.exit(0)
  }
  console.log(`已记一条见闻：${result.id}${result.deduplicated ? '（内容相同的已有记录，未重复写入）' : ''}`)
  console.log(`手账：${result.readingId} · 状态：${result.status}`)
  console.log(`落盘：${result.path}`)
  console.log('（这是本地可审阅草稿；见闻不是对外发布。）')
  process.exit(0)
} else {
  fail('USAGE', USAGE, 2)
}
