// bili inbox —— 见闻收件箱导出（给主人看全套的本地文件）
//
// 为什么要有"全套导出"：单条见闻看 journal，但"我到底都遇见了谁"需要一份
// 完整的、可核对的文件。导出是本地渲染，不触网不写平台；索引带快照哈希与
// 逐卷哈希，文件被手改过能查出来。所以这个命令只读账本 + 刷新本地导出文件。
//
// 用法:
//   node inbox.mjs [--json]
import path from 'node:path'
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

const outcome = await runCommand((service) => {
  const read = () => service.inbox({ action: 'index' })
  let exported = false
  let index
  try {
    index = read()
  } catch (e) {
    // 导出文件缺失或与账本不一致时自动重建一次（导出是派生物，不是手写文件）。
    if (!(typeof e.code === 'string' && e.code.startsWith('INBOX_'))) throw e
    service.exportInbox()
    exported = true
    index = read()
  }
  const root = service.store.root
  const recent = service.store
    .inbox()
    .slice(0, 3)
    .map((e) => {
      const reading = service.store.reading(e.reading_id)
      return { id: e.id, created: e.created, title: reading.title, url: reading.url }
    })
  return {
    total: index.total,
    volumeCount: index.volumeCount,
    snapshot: index.snapshot,
    checks: index.checks,
    nextVolume: index.nextVolume,
    exported,
    paths: {
      inbox: path.join(root, 'inbox.md'),
      html: path.join(root, 'inbox.html'),
      index: path.join(root, 'inbox-index.json'),
      parts: path.join(root, 'inbox-parts'),
    },
    recent,
  }
})
closeService()
if (!outcome.ok) fail(outcome.code, outcome.message)

const result = outcome.value
const payload = { ok: true, ...result }
if (opt.json) {
  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}
console.log(`见闻收件箱：${result.total} 条 · ${result.volumeCount} 卷${result.exported ? '（导出文件已按账本重建）' : ''}`)
console.log(`快照：${String(result.snapshot).slice(0, 16)}…（全文/分卷哈希见索引）`)
console.log(`主文件：${result.paths.inbox}`)
console.log(`网页版：${result.paths.html}`)
console.log(`索引：${result.paths.index}`)
console.log(`分卷：${result.paths.parts}`)
if (result.total) {
  console.log('\n最近遇见的：')
  for (const e of result.recent) console.log(`  · ${e.title}（手账 ${e.id}）`)
} else {
  console.log('\n（收件箱暂时为空。允许没有新发现，也允许只看一部喜欢的作品。）')
}
process.exit(0)
