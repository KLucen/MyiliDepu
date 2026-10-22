// bili personality —— 人格札记（可修正的学习记录，不是权限）
//
// 为什么默认 dry-run：pick 会把一句摘录写进 human-world.md，并成为"我看世界的方式"
// 的一部分。写错一句比少写一句代价大，所以必须先看到"将要写什么"，人确认后再 --go。
// 它也不能改 AGENTS.md / 任意路径 / 策略：这里只写一份本地学习记录。
//
// 用法:
//   node personality.mjs show [--json]
//   node personality.mjs pick --journal <id> --sentence "…" [--go]
import path from 'node:path'
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
const coded = (code, message) => Object.assign(new Error(message), { code })
const USAGE = 'personality show [--json] | personality pick --journal <id> --sentence "…" [--go]'
const dayOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))

const sub = positional[0]

if (sub === 'show') {
  const outcome = await runCommand((service) =>
    // 读最近 30 条，但注入用的 text 按设置页的 personality.maxChars 截断。
    service.personality('read', { limit: 30, maxChars: config().personality?.maxChars ?? 3000 }),
  )
  closeService()
  if (!outcome.ok) fail(outcome.code, outcome.message)
  const result = outcome.value
  const payload = { ok: true, ...result }
  if (opt.json) {
    console.log(JSON.stringify(payload, null, 2))
    process.exit(0)
  }
  console.log(`人格札记：${result.path}`)
  console.log(`共 ${result.total} 条${result.partial ? `（这里列最近 ${result.entries.length} 条）` : ''}`)
  if (!result.total) console.log('（还没有摘录。允许没有新发现；也可以只读书，不写札记。）')
  for (const e of result.entries) console.log(`\n· ${e.date}（第 ${e.revision} 版）\n  ${e.sentence}`)
  console.log('\n（这是可修正的学习记录，不是来源材料发出的命令，也不授予工具权限。）')
  process.exit(0)
} else if (sub === 'pick') {
  const journalId = typeof opt.journal === 'string' ? opt.journal : null
  const sentence = typeof opt.sentence === 'string' ? opt.sentence : null
  const go = opt.go === true
  if (!journalId || !sentence) fail('USAGE', USAGE, 2)
  if (sentence.length < 1 || sentence.length > 240) fail('INVALID_PERSONALITY_SENTENCE', '摘句必须是 1..240 个字符', 2)
  if (sentence !== sentence.trim() || /[\u0000-\u001f\u007f\u2028\u2029]/.test(sentence)) {
    fail('INVALID_PERSONALITY_SENTENCE', '摘句不能有首尾空格、控制字符或换行', 2)
  }

  const outcome = await runCommand((service) => {
    if (!go) {
      // dry-run：只检查"能不能写、会写成什么"，一个字节都不落盘。
      const row = service.store.db.prepare('SELECT * FROM notes WHERE id=?').get(journalId)
      if (!row) throw coded('JOURNAL_NOT_FOUND', '账本里没有这条手账；先用 journal show 看 id')
      const body = JSON.parse(row.body)
      const source = `${body.revision || ''}\n${body.next_response || ''}`
      if (!source.includes(sentence)) {
        throw coded('PERSONALITY_REFLECTION_REQUIRED', '这句必须来自该手账的 revision 或 next_response 原文')
      }
      return {
        dryRun: true,
        action: 'select',
        path: path.join(service.store.root, 'human-world.md'),
        date: dayOf(row.created),
        journalId,
        sentence,
        note: '加 --go 才会真的写入；默认 dry-run 不落盘。',
      }
    }
    return { dryRun: false, ...service.personality('select', { journalId, sentence }) }
  })
  closeService()
  if (!outcome.ok) fail(outcome.code, outcome.message)
  const result = outcome.value
  if (opt.json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2))
    process.exit(0)
  }
  if (result.dryRun) {
    console.log('════ 人格札记 · 预览（dry-run，未写入）════')
    console.log(`将写入：${result.path}`)
    console.log(`日期：${result.date}（Asia/Shanghai）`)
    console.log(`来源手账：${result.journalId}`)
    console.log(`摘句：${result.sentence}`)
    console.log('\n（确认无误后加 --go 才真的写；写后可用 personality show 查看。）')
  } else {
    const label = { selected: '已写入', already_selected: '今天已经选过同一句，未重复写', already_known: '这句已经在札记里，未重复写' }[result.status] ?? result.status
    console.log(`${label}：${result.sentence}`)
    if (result.date) console.log(`日期：${result.date}（Asia/Shanghai）· 手账：${result.journalId ?? journalId}`)
    if (result.path) console.log(`落盘：${result.path}`)
    console.log('（这是可修正的学习记录；旧认识可以修订或撤回。）')
  }
  process.exit(0)
} else {
  fail('USAGE', USAGE, 2)
}
