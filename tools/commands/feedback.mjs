// 反馈记账（2026-10-23 主人要求）——「我用私信告诉她我感不感兴趣，反馈到评分上」
//
// 她在私信里看到主人的表态后，调这里记一笔；
// feed 选题时会读同一本 feedback.json：喜欢的主题加权、不喜欢的主题降权，
// 被明确说不喜欢的那条 BV 直接拉黑（不再出现在候选池里）✓
//
// 用法:
//   node feedback.mjs list [--limit 20] [--json]
//   node feedback.mjs like    --note "主人说这条有意思" [--bv BV1xx…] [--title "视频标题"]
//   node feedback.mjs dislike --note "别再发显卡降价了" [--bv BV1xx…] [--title "视频标题"]
//
// 退出码: 0 成功 / 2 用法或参数不对 / 3 文件坏了
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const opt = {}
const rest = []
for (let i = 0; i < argv.length; i += 1) {
  const a = String(argv[i])
  if (a.startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) opt[a.slice(2)] = true
    else { opt[a.slice(2)] = v; i += 1 }
  } else rest.push(a)
}
const cmd = String(rest[0] ?? 'list')
const JSONOUT = !!opt.json
const LIMIT = Math.max(1, Math.min(200, Number(opt.limit ?? 20) || 20))

const U = process.env.USERPROFILE || process.env.HOME || '.'
const FILE = path.join(U, '.bili-ai', 'feedback.json')

const usage = () => {
  console.error('用法：')
  console.error('  feedback list [--limit 20] [--json]')
  console.error('  feedback like    --note "主人的意思" [--bv BV…] [--title "视频标题"]')
  console.error('  feedback dislike --note "主人的意思" [--bv BV…] [--title "视频标题"]')
  console.error('')
  console.error('她为什么记这个：feed 选题时喜欢的主题加权、不喜欢的降权，点名的 BV 直接拉黑 ✓')
  process.exit(2)
}

const load = () => {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('顶层不是对象')
    return j
  } catch (e) {
    if (e.code === 'ENOENT') return { last: null, events: [] }
    // 坏文件不要静默重建 —— 那会把主人攒的反馈悄悄清空 ✗（宁可当场停下让人看一眼）
    console.error(`✗ ${FILE} 读不了：${e.message}`)
    console.error('  （这份文件存着她的反馈账，坏了要先备份再修，不要直接删）')
    process.exit(3)
  }
}
const save = (fb) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify(fb, null, 2) + '\n')
}

if (cmd === 'list' || cmd === 'show') {
  const fb = load()
  const events = (Array.isArray(fb.events) ? fb.events : []).filter(Boolean)
  const shown = events.slice(-LIMIT)
  if (JSONOUT) {
    console.log(JSON.stringify({ file: FILE, total: events.length, last: fb.last ?? null, events: shown }))
    process.exit(0)
  }
  if (!events.length) { console.log('还没有任何反馈（主人没表态过）。'); process.exit(0) }
  console.log(`反馈账：${FILE}`)
  console.log(`共 ${events.length} 条，最后一条 ${fb.last ?? '（没记时间）'}`)
  console.log('')
  for (const e of shown) {
    const kind = e.kind === 'dislike' ? '✗ 不喜欢' : e.kind === 'like' ? '✓ 喜欢' : '· 表态'
    const t = new Date(e.at ?? 0)
    const when = Number.isFinite(t.getTime()) ? t.toLocaleString('zh-CN', { hour12: false }) : String(e.at ?? '')
    const what = String(e.videoTitle ?? '').trim()
    const bv = String(e.bv ?? '').trim()
    const note = String(e.note ?? e.comment ?? '').slice(0, 70)
    console.log(`${when}  ${kind}  ${bv}${what ? ' ' + what.slice(0, 40) : ''}`)
    if (note) console.log(`    ${note}`)
  }
  process.exit(0)
}

if (cmd !== 'like' && cmd !== 'dislike') usage()

const note = typeof opt.note === 'string' ? opt.note.trim() : ''
if (!note) { console.error('✗ 必须写 --note：主人到底什么意思（一句话）。没有它这条反馈学不到东西 ✗'); usage() }
const bv = typeof opt.bv === 'string' ? opt.bv.trim() : ''
if (bv && !/^BV[0-9A-Za-z]{10}$/.test(bv)) { console.error(`✗ --bv 不像 BV 号：${bv}`); usage() }
const title = typeof opt.title === 'string' ? opt.title.trim() : ''

const fb = load()
const at = new Date().toISOString()
const event = {
  at,
  kind: cmd,
  ...(bv ? { bv } : {}),
  ...(title ? { videoTitle: title } : {}),
  comment: note.slice(0, 200),
  note: `主人私信：${note.slice(0, 120)}`,
  source: 'dm',
}
fb.events = [...(Array.isArray(fb.events) ? fb.events : []), event].slice(-200)
// 主人主动说话 = 表态 → 顺手把「沉默天数」清零（否则她明明刚被反馈过，却因为"7 天没表态"不分享 ✗）
fb.last = at
save(fb)

if (JSONOUT) console.log(JSON.stringify({ ok: true, file: FILE, event, total: fb.events.length }))
else {
  console.log(`${cmd === 'like' ? '✓ 记下：主人喜欢' : '✗ 记下：主人不喜欢'}${bv ? '（' + bv + '）' : ''} — ${note.slice(0, 60)}`)
  console.log('下一轮 feed 选题时：喜欢的主题加权、不喜欢的降权；点名的 BV 直接拉黑 ✓')
}
process.exit(0)
