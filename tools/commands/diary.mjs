// 「她的两本日记」—— 私人日记（只有主人能看）与公开日记（默认关，开了才发到 B 站）。
//
// 2026-10-22 合并 dsh-bili-humanism 后补（humanism 的约定：她写两本日记）：
//   私人日记永远写，是她连贯的前提；公开日记是"留下足迹"，不是私人日记的复制品。
//   前者只在本地、后者要过平台闸门 —— 两条路的风险不一样，所以开关也必须分开 ✗
//   不能用一个 diary.enabled 同时管两本（总开关只影响旧的可见性流水 show/log/tail）。
//
// 用法:
//   node diary.mjs show [--days 1]                 人读摘要：看过 / 想说 / 对外发言 / 最近事件
//   node diary.mjs log <kind> [--target X] [--note "…"]   记一条结构化事件（不外发）
//   node diary.mjs tail [--n 20]                   最近的结构化事件
//   node diary.mjs private append --text "…" [--dry]      私人日记（本地，只有主人能看）
//   node diary.mjs private show [--days 3]                私人日记原文（最近 N 天）
//   node diary.mjs public log --text "…" [--via dynamic|comment] --dry|--go [--bvid BV] [--oid id]
//                                                        公开日记（对外；默认关，必须显式 --dry/--go）
//   node diary.mjs public show [--days 3]                 公开日记的本机留痕（含每条 dry/go 与结果）
//   node diary.mjs status [--json]                        两本日记的开关 / 路径 / 条数（纯本地，不发请求）
//
// 数据源（各司其职；路径统一到 $DSH_HOME/myilidepu/，见 lib/paths.mjs 的 dataPath）：
//   diary.md              叙事（她自己的话：看过的、想法池、谁回过她）—— 给人读
//   log.jsonl             事件流（看/想/发/被回… 结构化）—— 给程序与其他端用
//   diary-private.md      私人日记：## YYYY-MM-DD 分节，只有主人能看
//   diary-public.md       公开日记的本机留痕：**dry 也记、失败也记** ——
//                         这是"她对外说过什么"的审计面（真的发没发出去看"结果"一行）✓
//   ~/.bili-ai/quota.json 发言账（给限额闸与审计用）—— 与凭据同级、按 OS 用户共享，**不在数据目录，别搬**
//
// 旧路径兜底（2026-10-22 数据目录统一时加）：合并前写在 $DSH_HOME/whale-diary.md /
//   $DSH_HOME/whale-log.jsonl 的数据不能装作没看见 —— **读**的时候回退到旧文件，写一律写新路径。
//
// 关键约定（写进 AGENTS.md）：**自主发言之后必须主动通知主人**（notify_wechat），
// 因为"她自己决定的对外动作"必须让主人事后可见 —— 这是 B 档能成立的前提。
//
// 对外发布的硬边界（本文件里也强制一遍）：
//   · 公开日记默认关（config.diary.public 必须 === true），绝不隐式打开
//   · 必须显式 --dry 或 --go；--go 前必须过 tools/lib/quota-gate.mjs 的 gate()，被拒就停手、不绕过
//   · 真正的发布走 `node bili.mjs dynamic post` / `node bili.mjs comment`（复用已有 CLI，
//     不在日记里再抄一份 WBI 签名/凭据代码 —— 两份实现迟早漂移 ✗）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../lib/config.mjs'
import { dshPath, dataPath, homePath } from '../lib/paths.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BILI_MJS = path.join(HERE, '..', 'bili.mjs')

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
for (let i = 1; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i] ?? true
  else if (!opt._a) opt._a = argv[i]
}
/** 子命令（private/public 的第二个词）；旧命令 show/log/tail 不用它 */
const sub = typeof opt._a === 'string' ? opt._a : ''

const today = () => new Date().toLocaleDateString('sv-SE')            // 本地日期 YYYY-MM-DD
const hhmm = (iso) => String(iso).slice(11, 16)
const clock = () => new Date().toLocaleTimeString('sv-SE')            // 本地时间 HH:MM:SS（审计带秒）

// ── 路径（写新目录；旧目录只读兜底）────────────────────────────────────────
const DIARY = dataPath('diary.md')
const LOG = dataPath('log.jsonl')
const PRIVATE = dataPath('diary-private.md')
const PUBLIC = dataPath('diary-public.md')
const LEGACY_DIARY = dshPath('whale-diary.md')
const LEGACY_LOG = dshPath('whale-log.jsonl')
// 发言账保持原位置：它跟凭据同目录、按 OS 用户共享，不跟着 DSH_HOME 走 ✓
const QUOTA = homePath('.bili-ai', 'quota.json')

const USAGE = [
  '用法:',
  '  node diary.mjs show [--days 1]                 人读摘要（看过/想说/对外发言/最近事件）',
  '  node diary.mjs log <kind> [--target X] [--note "…"]   记一条结构化事件（不外发）',
  '  node diary.mjs tail [--n 20]                   最近的结构化事件',
  '  node diary.mjs private append --text "…" [--dry]      私人日记（只有主人能看）',
  '  node diary.mjs private show [--days 3]                私人日记原文（最近 N 天）',
  '  node diary.mjs public log --text "…" --via dynamic|comment --dry|--go [--bvid BV] [--oid id]',
  '  node diary.mjs public show [--days 3]                 公开日记的本机留痕（含 dry/go 与结果）',
  '  node diary.mjs status [--json]                        两本日记的开关/路径/条数（纯本地）',
  '（公开日记默认关；--go 会过限额闸，被拒就停手 —— 不要绕过）',
].join('\n')

// ── 小工具 ─────────────────────────────────────────────────────────────────
/** 按给定顺序找第一个能读到的文件（新路径 → 旧路径兜底）；都读不到返回 text:null。 */
function readFirst(files) {
  for (const f of files) {
    try { return { text: fs.readFileSync(f, 'utf8'), file: f } } catch {}
  }
  return { text: null, file: files[0] }
}
function fileText(file) {
  try { return fs.readFileSync(file, 'utf8') } catch { return null }
}
function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}
/** 把文本拆成 [{ heading, lines }]（h2 分节；没有 h2 的头部内容丢弃）。 */
function splitSections(text) {
  const out = []
  let cur = null
  for (const line of String(text).split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*$/)
    if (h) { cur = { heading: h[1], lines: [] }; out.push(cur); continue }
    if (cur) cur.lines.push(line)
  }
  return out
}
/** 文件里是否已有 `<date>` 这一节（避免同一天写两个「## 日期」✗）。 */
function hasDateSection(text, date) {
  return new RegExp(`^##\\s+${date}(?:\\s|$)`, 'm').test(String(text))
}
/**
 * 往「按日期分节」的 md 里追加一块内容：
 * 首次出现该日期就创建 `## YYYY-MM-DD` 标题，否则只追加内容（不重复建节）✓
 */
function appendDated(file, lines, date) {
  ensureDir(file)
  const old = fileText(file) ?? ''
  const parts = old.trim() ? [''] : []
  if (!hasDateSection(old, date)) parts.push(`## ${date}`, '')
  parts.push(...lines)
  fs.appendFileSync(file, parts.join('\n') + '\n')
}
/** --dry 时预览「将会追加的内容」，不落盘。 */
function previewDated(file, lines, date) {
  const old = fileText(file) ?? ''
  const parts = []
  if (!hasDateSection(old, date)) parts.push(`## ${date}`, '')
  parts.push(...lines)
  return parts.join('\n') + '\n'
}
/** 最近 N 天的窗口（N=1 就是今天）；非法值退回默认值。 */
function dayWindow(value, fallback) {
  const n = Number(value ?? fallback)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}
function sinceDate(n) {
  return new Date(Date.now() - (n - 1) * 86400000).toLocaleDateString('sv-SE')
}
/** 统计条数：私人日记按「有内容的日期节」算，公开日记按「### 留痕条数」算。 */
function countDateSections(file) {
  const text = fileText(file)
  return text ? (text.match(/^##\s+\d{4}-\d{2}-\d{2}\s*$/gm) ?? []).length : 0
}
function countPublicEntries(file) {
  const text = fileText(file)
  return text ? (text.match(/^###\s+\d{2}:\d{2}/gm) ?? []).length : 0
}
/** 公开日记默认 via：配置里的 publicVia，非法就退回 dynamic。 */
function defaultVia() {
  return config().diary?.publicVia === 'comment' ? 'comment' : 'dynamic'
}
function configPrivateEnabled() {
  return config().diary?.private !== false
}
function configPublicEnabled() {
  return config().diary?.public === true
}

// ── 旧的可见性三件套（show / log / tail，行为保持不变）────────────────────
// 2026-10-22 修：以前总开关在这里一挡，**任何**子命令都直接退出（新加的 private/public 也被挡）✗
//   总开关（diary.enabled=false）只该管这三条旧流水；私人/公开日记各按 diary.private / diary.public 判断 ✓
if (config().diary?.enabled === false && (!cmd || cmd === 'show' || cmd === 'log' || cmd === 'tail')) {
  console.log('（日记总开关关着 —— 这次不记）')
  process.exit(0)
}

if (cmd === 'log') {
  const kind = opt._a ?? 'event'
  ensureDir(LOG)
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), kind, target: opt.target ?? null, note: opt.note ?? null }) + '\n')
  console.log(`已记：${kind}${opt.target ? ' → ' + opt.target : ''}`)
  process.exit(0)
}

if (cmd === 'tail') {
  const n = Number(opt.n ?? 20)
  const { text } = readFirst([LOG, LEGACY_LOG])
  const lines = text ? text.trim().split(/\r?\n/).filter(Boolean) : []
  if (!lines.length) { console.log('（还没有事件记录）'); process.exit(0) }
  for (const l of lines.slice(-n)) {
    try { const e = JSON.parse(l); console.log(`  ${String(e.at).slice(0, 16).replace('T', ' ')}  ${e.kind}  ${e.target ?? ''}  ${e.note ?? ''}`) }
    catch { console.log('  ' + l) }
  }
  process.exit(0)
}

if (cmd === 'show' || !cmd) {
  const days = Number(opt.days ?? 1)
  const since = new Date(Date.now() - (days - 1) * 86400000).toLocaleDateString('sv-SE')
  const title = config().persona?.diaryTitle ?? '今日摘要'
  console.log(`════════ ${title}（${since} ~ ${today()}）════════\n`)

  // ① 叙事部分：解析日记（新路径优先，旧文件兜底 —— 合并前写的内容还读得到 ✓）
  const read = readFirst([DIARY, LEGACY_DIARY])
  const text = read.text ?? ''
  if (!read.text) console.log(`（读不到日记 ${DIARY}）`)
  if (text) {
    const sections = {}
    let cur = null
    for (const line of text.split(/\r?\n/)) {
      const h = line.match(/^##\s+(.+)$/)
      if (h) { cur = h[1].trim(); sections[cur] = []; continue }
      if (cur) sections[cur].push(line)
    }
    // 看过的：表格里日期匹配的
    const seenKey = Object.keys(sections).find((k) => k.includes('看过')) ?? ''
    const rows = (sections[seenKey] ?? []).filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l) && !l.includes('| 时间 |'))
    const hit = rows.filter((r) => r.includes(since) || r.includes(today()))
    console.log(`【看过 ${hit.length} 条】`)
    for (const r of hit) {
      const c = r.split('|').map((s) => s.trim()).filter(Boolean)
      console.log(`  · ${c[2] ?? c[0]}  ${String(c[3] ?? '').slice(0, 46)}`)
      if (c[4]) console.log(`      她的想法：${String(c[4]).slice(0, 120)}`)
    }
    // 想法池
    const wantKey = Object.keys(sections).find((k) => k.includes('想说')) ?? ''
    const wants = (sections[wantKey] ?? []).filter((l) => l.trim().startsWith('-') && !/^-\s*（空/.test(l.trim()))
    console.log(`\n【想说但还没说 ${wants.length} 条】`)
    for (const w of wants) console.log('  ' + w.trim().replace(/^-\s*/, '  · ').slice(0, 150))
  }

  // ② 发言账（她真的对外说了什么）
  console.log('\n【对外发言（今天）】')
  try {
    const q = JSON.parse(fs.readFileSync(QUOTA, 'utf8'))
    // 2026-10-21 修（外部审计 #8）：账本里的 at 是 UTC ISO 串，直接 startsWith(本地日期)
    //   会把凌晨 0–8 点的发言算到"昨天"✗（quota.mjs 早就修过同一个坑，这里漏了）
    //   统一先把时间戳转成本地日期再比 ✓
    const dayOf = (at) => new Date(at).toLocaleDateString('sv-SE')
    const todayLog = (q.log ?? []).filter((x) => dayOf(x.at) === today())
    const auto = todayLog.filter((x) => x.auto).length
    // q.daily 早就不写盘了（save() 只持久化 {log}）→ 显示 undefined 会误导 ✗
    const dailyCap = Number(q.daily ?? q.shareDaily ?? 0)
    console.log(`  共 ${todayLog.length} 条（自主 ${auto}${dailyCap ? '/' + dailyCap : ''}，主人授权 ${todayLog.length - auto}）` + (dailyCap ? '' : ' · 自主发言不设条数上限 ✓'))
    for (const x of todayLog) console.log(`  · ${hhmm(x.at)}  ${x.type}${x.auto ? '（自主）' : ''}  ${x.target ?? ''}  ${x.note ?? ''}`)
    if (!todayLog.length) console.log('  （今天一条都没发）✓')
  } catch { console.log('  （还没有发言记录 —— 发第一条时 `quota record` 会自动建 quota.json）✓') }

  // ③ 事件流（旧文件兜底只读）
  console.log('\n【最近事件】')
  const events = readFirst([LOG, LEGACY_LOG]).text
  const lines = events ? events.trim().split(/\r?\n/).filter(Boolean) : []
  if (!lines.length) console.log('  （还没有事件记录 —— `diary log` 会往这里写）')
  for (const l of lines.slice(-6)) {
    try { const e = JSON.parse(l); console.log(`  · ${String(e.at).slice(5, 16).replace('T', ' ')}  ${e.kind}  ${e.target ?? ''}  ${e.note ?? ''}`) } catch {}
  }
  console.log('\n（她是主动来找你的：自主发言后必须 notify_wechat —— 见 AGENTS.md「日子」一节）')
  process.exit(0)
}

// ── 私人日记（本地；只有主人能看，永远写）────────────────────────────────
if (cmd === 'private') {
  if (sub === 'append') {
    if (!configPrivateEnabled()) {
      console.error('✗ 私人日记关着（设置 → 日记 → 私人日记 —— config.diary.private=false）—— 这一条没有落盘')
      process.exit(3)
    }
    const text = typeof opt.text === 'string' ? opt.text : null
    if (text === null || !text.trim()) {
      console.error('✗ 私人日记 append 需要 --text "<正文>"（空文本不记 —— 私人日记要写真的东西）')
      process.exit(2)
    }
    const chars = [...text].length
    if (chars > 4000) {
      console.error(`✗ 私人日记一条最多 4000 字（这条 ${chars} 字）—— 拆成两条写，别把一天糊成一块`)
      process.exit(2)
    }
    const date = today()
    if (opt.dry) {
      // --dry 只打印「将要写入什么 + 目标路径」，绝不落盘（一条也不能假装写了）
      console.log(`[dry] 私人日记不写盘 —— 目标：${PRIVATE}`)
      console.log('将要追加：')
      console.log(previewDated(PRIVATE, [text], date).replace(/\n$/, ''))
      process.exit(0)
    }
    appendDated(PRIVATE, [text], date)
    console.log(`✓ 已记进私人日记（${date} · ${PRIVATE}）`)
    process.exit(0)
  }

  if (sub === 'show') {
    const text = fileText(PRIVATE)
    if (text === null) {
      console.log('（还没有私人日记 —— 用 `node bili.mjs diary private append --text "…"` 写第一条）')
      process.exit(0)
    }
    const days = dayWindow(opt.days, 3)
    const since = sinceDate(days)
    if (!configPrivateEnabled()) console.log('（私人日记现在关着；下面是已经写下的内容，只读）')
    const picked = splitSections(text).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.heading) && s.heading >= since)
    console.log(`════════ 私人日记（最近 ${days} 天 · 只有主人能看）════════`)
    if (!picked.length) { console.log(`\n（最近 ${days} 天没有私人日记）`); process.exit(0) }
    for (const s of picked) {
      console.log(`\n## ${s.heading}`)
      const body = s.lines.join('\n').trim()
      if (body) console.log(body)
    }
    process.exit(0)
  }

  console.error('用法:\n  node diary.mjs private append --text "…" [--dry]\n  node diary.mjs private show [--days 3]')
  process.exit(2)
}

// ── 公开日记（对外；默认关，必须显式 --dry / --go）────────────────────────
if (cmd === 'public') {
  if (sub === 'log') {
    const code = await publicLog()
    process.exit(code)
  }
  if (sub === 'show') process.exit(publicShow())
  console.error('用法:\n  node diary.mjs public log --text "…" --via dynamic|comment --dry|--go [--bvid BV] [--oid id]\n  node diary.mjs public show [--days 3]')
  process.exit(2)
}

// ── 两本日记的状态（纯本地；给设置页 / 测试用）────────────────────────────
if (cmd === 'status') {
  const status = {
    private: { enabled: configPrivateEnabled(), path: PRIVATE, entries: countDateSections(PRIVATE) },
    public: { enabled: configPublicEnabled(), via: defaultVia(), path: PUBLIC, entries: countPublicEntries(PUBLIC) },
    logPath: LOG,
  }
  if (opt.json) { console.log(JSON.stringify(status)); process.exit(0) }
  console.log(`私人日记：${status.private.enabled ? '✓ 开着' : '✗ 关着'}  ${status.private.path}  （${status.private.entries} 天）`)
  console.log(`公开日记：${status.public.enabled ? '✓ 开着' : '✗ 关着'}  ${status.public.path}  （${status.public.entries} 条留痕）  默认 via=${status.public.via}`)
  console.log(`事件流：  ${status.logPath}`)
  process.exit(0)
}

console.log(USAGE)

// ─────────────────────────────────────────────────────────────────────────────
// 公开日记的发布：无论 dry 还是 go 都先在本机留痕（审计面），go 才真的碰网络。
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 追加一条公开日记留痕到 diary-public.md。
 * result 里带「发布中…」时返回可回填的 pending 行（spawn 子命令后把结果换掉），
 * 这样万一进程在发布中途被杀，文件里也如实写着"发布中"，不会假装成功 ✓
 */
function appendPublicEntry({ via, target, text, result }) {
  const date = today()
  const pending = result.startsWith('发布中')
  const nonce = pending ? `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 6)}` : ''
  const marker = pending ? `<!-- pending:${nonce} -->` : ''
  const entry = [
    `### ${clock()} · via=${via} · 目标=${target}`,
    ...String(text).split(/\r?\n/).map((line) => `> ${line}`),
    `- 结果：${result}${marker ? ' ' + marker : ''}`,
  ]
  appendDated(PUBLIC, entry, date)
  return marker ? { pendingLine: `- 结果：${result} ${marker}` } : null
}

/** 把「发布中…」那行换成最终结果（只改这一行；写失败就留着 pending，宁可丑也不撒谎）。 */
function finishPublicEntry(pendingEntry, finalResult) {
  if (!pendingEntry) return
  const old = fileText(PUBLIC)
  if (old === null) return
  const next = old.replace(pendingEntry.pendingLine, () => `- 结果：${finalResult}`)
  if (next === old) return
  try { fs.writeFileSync(PUBLIC, next) } catch {}
}

/** 跑已有的 CLI（bili.mjs 子命令）：用文件句柄捕获输出，避开 Windows 沙箱禁管道的问题。 */
async function runBili(args) {
  const { execFileSync } = await import('../lib/capture.mjs')
  const { NODE_EXE } = await import('../lib/nodebin.mjs')   // Electron 里 process.execPath 是主程序 ✗
  try {
    const stdout = execFileSync(NODE_EXE, [BILI_MJS, ...args], { encoding: 'utf8' })
    return { ok: true, status: 0, stdout: String(stdout ?? ''), stderr: '' }
  } catch (e) {
    return { ok: false, status: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message ?? '') }
  }
}

/** 从子命令输出里判断"真的发出去了吗"（dynamic 的 CLI 在接口拒绝时也退出 0，只看退出码会误判 ✗）。 */
function publishConfirmed(r) {
  return r.ok && /✅ 已发布/.test(String(r.stdout))
}
function failureReason(r) {
  if (!r.ok) {
    const line = String(r.stderr || r.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? '子命令失败'
    return `子命令退出码 ${r.status}：${line.slice(0, 120)}`
  }
  const m = String(r.stdout).match(/code=(-?\d+)[^\n]*message=([^\n]*)/)
  if (m) return `接口返回 code=${m[1]}${m[2]?.trim() ? ' ' + m[2].trim().slice(0, 80) : ''}`
  return '子命令没有确认发布成功'
}

/**
 * --via comment 只给了 --bvid 时，comment.mjs 还需要 oid（aid）才能写接口。
 * 这一步**只在 --go 才发生**（--dry 绝不联网 ✓）；读 view 接口不需要 cookie。
 */
async function resolveAid(bvid) {
  try {
    const r = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, {
      headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/' },
    })
    const j = await r.json()
    if (j?.code === 0 && j?.data?.aid) return String(j.data.aid)
    console.error(`✗ 取不到 ${bvid} 的 aid（code=${j?.code} ${j?.message ?? ''}）`)
    return ''
  } catch (e) {
    console.error(`✗ 取不到 ${bvid} 的 aid：${String(e?.message ?? e).slice(0, 120)}`)
    return ''
  }
}

async function publicLog() {
  // 默认关：config.diary.public 必须显式 === true（DEFAULTS 是 false，绝不隐式打开）
  if (!configPublicEnabled()) {
    console.error('✗ 公开日记关着，先到设置页打开（设置 → 日记 → 公开日记 / config.diary.public=true）—— 这条没有发，也没有留痕')
    return 3
  }
  const dry = opt.dry === true
  const go = opt.go === true
  if (dry && go) { console.error('✗ --dry 和 --go 只能选一个（--dry 只预演，--go 才真的发）'); return 2 }
  if (!dry && !go) {
    // 话术照 dynamic.mjs：它是"对外说过的话"，不能靠默认值替她决定
    console.error('✗ 必须显式 --dry 或 --go（--dry = 只预演，--go = 真的发到 B 站）')
    return 2
  }
  const text = typeof opt.text === 'string' ? opt.text : null
  if (text === null || !text.trim()) { console.error('✗ 公开日记 log 需要 --text "<正文>"（空文本不记也不发）'); return 2 }
  let via = typeof opt.via === 'string' ? opt.via : defaultVia()
  if (via !== 'dynamic' && via !== 'comment') { console.error(`✗ --via 只支持 dynamic | comment（收到 ${String(via)}）`); return 2 }
  const bvid = typeof opt.bvid === 'string' ? opt.bvid : ''
  const oidArg = typeof opt.oid === 'string' || typeof opt.oid === 'number' ? String(opt.oid) : ''
  if (via === 'comment' && !bvid && !oidArg) {
    console.error('✗ --via comment 需要 --bvid <BV…> 或 --oid <id>（要发到哪条视频下面）')
    return 2
  }
  /** 留痕里的目标描述（dynamic 就是动态；comment 记视频坐标） */
  const target = via === 'dynamic' ? 'dynamic' : bvid ? `BV:${bvid}` : `oid:${oidArg}`

  if (dry) {
    // 只预演：留痕 + 打印要发的内容；不 gate、不 spawn、不联网（--dry 必须零副作用 ✓）
    appendPublicEntry({ via, target, text, result: 'dry（预演，未发布；没有发网络请求）' })
    console.log('=== 公开日记预演 ===')
    console.log(`  方式：${via === 'dynamic' ? 'B 站动态（t.bilibili.com）' : `视频 ${bvid || oidArg} 的评论区`}`)
    console.log(`  本机留痕：${PUBLIC}`)
    console.log(`  正文（${[...text].length} 字）：`)
    console.log(String(text).split(/\r?\n/).map((l) => '  ' + l).join('\n'))
    console.log('\n[dry] 未发布。要真的发就换 --go（--go 会先过限额闸，再走 bili.mjs 已有的发布命令）。')
    return 0
  }

  // ── --go：先过限额闸（对外发言的硬边界；被拒就原样把原因打给用户，不绕过）──
  const { gate, record } = await import('../lib/quota-gate.mjs')
  if (!gate({ type: via === 'comment' ? 'comment' : 'dynamic', target, auto: true })) {
    appendPublicEntry({ via, target, text, result: '失败（限额闸拒绝，未发布）' })
    console.error('✗ 公开日记没发出去：限额闸不通过（原因见上面 [限额闸] 的原文）—— 不要绕过额度/风控，明天再来')
    return 4
  }

  // comment 只有 BV 时还得换 aid；这一步发生在闸门之后、发布之前（--dry 不会走到这里 ✓）
  let oid = oidArg
  if (via === 'comment' && !oid) {
    oid = await resolveAid(bvid)
    if (!oid) {
      appendPublicEntry({ via, target, text, result: '失败（取不到这条视频的 aid，未发布）' })
      console.error('✗ 公开日记没发出去：取不到 aid（--oid 可以直接指定）')
      return 6
    }
  }

  // 先留痕（发布中）→ 再发布 → 回填结果：中途被杀也不会留下一句"已发"的假话 ✓
  const pendingEntry = appendPublicEntry({ via, target, text, result: '发布中…（go）' })
  const args = via === 'dynamic'
    ? ['dynamic', 'post', '--text', text, '--go', '--auto']
    : ['comment', '--oid', String(oid), ...(bvid ? ['--bvid', bvid] : ['--referer', 'https://www.bilibili.com/']), '--message', text, '--go', '--auto']
  const r = await runBili(args)
  // 子命令的输出本来就该被用户看见（相当于 stdio:inherit；这里只是延迟一步转贴）
  if (r.stdout) process.stdout.write(String(r.stdout))
  if (r.stderr) process.stderr.write(String(r.stderr))

  if (!publishConfirmed(r)) {
    const reason = failureReason(r)
    finishPublicEntry(pendingEntry, `失败（${reason}）`)
    console.error(`✗ 公开日记没发出去（${reason}）—— 本机留痕已记失败`)
    return 6
  }

  const id = via === 'dynamic'
    ? (String(r.stdout).match(/dyn_id=(\S+)/)?.[1] ?? '')
    : (String(r.stdout).match(/rpid=(\S+)/)?.[1] ?? '')
  finishPublicEntry(pendingEntry, via === 'dynamic' ? `已发（动态 dyn_id=${id || '?'}）` : `已发（评论 rpid=${id || '?'}）`)
  if (via === 'dynamic') {
    // dynamic.mjs 成功时自己**不**记账（只有 comment.mjs 会记）→ 这里补一次，别让发言账缺条 ✓
    record({ type: 'dynamic', target, note: text, auto: true })
  } else {
    console.log('  [记账] 评论子命令成功时已经记过发言账 —— 这里不重复记 ✓')
  }
  console.log(`✓ 公开日记已发布（via=${via}${id ? ' · ' + (via === 'dynamic' ? 'dyn_id' : 'rpid') + '=' + id : ''}）`)
  console.log(`  本机留痕：${PUBLIC}`)
  return 0
}

function publicShow() {
  const text = fileText(PUBLIC)
  if (text === null) {
    console.log('（还没有公开日记留痕 —— 用 `node bili.mjs diary public log --text "…" --dry` 先看效果）')
    return 0
  }
  if (!configPublicEnabled()) console.log('（公开日记现在关着；下面是已经留在本机的记录，只读，不会发出去）')
  const days = dayWindow(opt.days, 3)
  const since = sinceDate(days)
  const out = []
  let curDate = null
  for (const line of text.split(/\r?\n/)) {
    const d = line.match(/^##\s+(\d{4}-\d{2}-\d{2})\s*$/)
    if (d) {
      curDate = d[1]
      if (curDate >= since) out.push(`## ${curDate}`)
      continue
    }
    if (curDate === null || curDate < since) continue
    const e = line.match(/^###\s+(\S+)\s+·\s+via=(\S+)\s+·\s+目标=(\S*)/)
    if (e) { out.push(`  ${e[1]} · via=${e[2]} · 目标=${e[3] || '-'}`); continue }
    const res = line.match(/^- 结果：(.*)$/)
    if (res) { out.push(`    结果：${res[1].replace(/<!--.*?-->/g, '').trim()}`); continue }
    if (line.startsWith('>')) out.push(`    ${line.slice(2)}`)
  }
  console.log(`════════ 公开日记 · 本机留痕（最近 ${days} 天 · ${PUBLIC}）════════`)
  if (!out.length) { console.log(`\n（最近 ${days} 天没有公开日记留痕）`); return 0 }
  console.log(out.join('\n'))
  return 0
}
