// 选题器：照"她自己的偏好"挑今天该看什么。**只读**，不产生任何对外动作。
//
// 用法: node feed.mjs [--n 6] [--per 2] [--pool 30]
// 数据来源：$DSH_HOME/myilidepu/diary.md 的「爱看」一行（偏好关键词）+「看过的」表格（防重复）
//          + commented-videos.md（已评论过的视频也排除）
//
// 为什么这么做（2026-10-14 主人定的方向）：主人要的是"有日子的鱼"，
// 所以"看什么"不该由别人喂，而该由她自己的偏好决定 —— 偏好写在日记里，这个脚本只负责照它去捞。
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import crypto from 'node:crypto'
import { dshPath, dataPath } from '../lib/paths.mjs'
import { describeFilter, parseDay, splitByDay } from '../lib/pubdate.mjs'
// 2026-10-23：反馈加权/降权抽进 lib（feed 是脚本没法单测 ✗），主人的私信反馈与点赞走同一份口径
import { readFeedback, splitFeedback, tokenSets, learnTokens, boostOf, penaltyOf, describeFeedback } from '../lib/fbscore.mjs'
// 2026-10-23：重点关注某个 UP（主人点名的黑鸦Heya）——"不关注也要看得见"的独立通路
import { normalizeWatchUps, latestVideos, describeWatchUps } from '../lib/watchups.mjs'


const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i] ?? true
}
const N = Number(opt.n ?? 6)
const PER = Number(opt.per ?? 2)
const POOL = Number(opt.pool ?? 30)

const HOME = (process.env.USERPROFILE || process.env.HOME || '/')
const diary = dataPath('diary.md')
// 2026-10-18：审计表挪到 `~/.bili-ai/` ✓（原来写死作者机器路径 ✗ 换机器就写不进去，静默失效 ✗）
const audit = path.join(HOME, '.bili-ai', 'commented-videos.md')

// ── 偏好与"看过"名单：都从日记里读 ──
let prefs = [...(config().preferences?.like ?? [])]   // 偏好来自统一配置（首选）
let dislike = [...(config().preferences?.dislike ?? [])]
let seen = new Set()
try {
  const text = fs.readFileSync(diary, 'utf8')
  const m = text.match(/^-\s*\*\*爱看\*\*：(.+)$/m)
  // 兼容旧写法：日记里若仍写着「爱看」，只在配置没给偏好时兜底（日记应回归纯叙事）
  if (m && !prefs.length) prefs = m[1].split(/[·、,，]/).map((s) => s.trim()).filter(Boolean)
  for (const bv of text.matchAll(/\bBV[0-9A-Za-z]{10}\b/g)) seen.add(bv[0])
} catch { console.log('（读不到日记，用默认偏好）') }
try {
  for (const bv of fs.readFileSync(audit, 'utf8').matchAll(/\bBV[0-9A-Za-z]{10}\b/g)) seen.add(bv[0])
} catch { /* 没有审计表也无妨 */ }

const cred = JSON.parse(fs.readFileSync(path.join(HOME, '.bili-ai', 'credentials.json'), 'utf8'))
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const H = { 'user-agent': UA, referer: 'https://search.bilibili.com/', cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}` }
const MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
const keyOf = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'))
const nav = await (await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: H })).json()
const mixin = MIXIN_TAB.map((i) => (keyOf(nav.data?.wbi_img?.img_url ?? '') + keyOf(nav.data?.wbi_img?.sub_url ?? ''))[i]).join('').slice(0, 32)
const wbi = (p) => {
  const wts = Math.round(Date.now() / 1000)
  const q = Object.keys({ ...p, wts }).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(k === 'wts' ? wts : p[k]).replace(/[!'()*]/g, ''))}`).join('&')
  return `${q}&w_rid=${crypto.createHash('md5').update(q + mixin).digest('hex')}`
}
const secs = (s) => { const p = String(s).split(':').map(Number); return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2] }

const pool = []
for (const kw of prefs.slice(0, 6)) {
  for (const order of ['click', 'pubdate']) {
    try {
      const j = await (await fetch(`https://api.bilibili.com/x/web-interface/wbi/search/type?${wbi({ search_type: 'video', keyword: kw, order, page: 1 })}`, { headers: H })).json()
      for (const it of (j?.data?.result ?? []).slice(0, POOL / prefs.length + 4)) {
        pool.push({
          bv: it.bvid, t: String(it.title).replace(/<[^>]+>/g, ''), d: secs(it.duration),
          dm: Number(it.danmaku ?? 0), play: Number(it.play ?? 0), up: it.author, kw,
          pubdate: it.pubdate,   // 2026-10-23：发布时间要带上，否则没法「只看 X 之后」✗
        })
      }
    } catch { /* 这个词没结果就跳过 */ }
    await new Promise((r) => setTimeout(r, 300))
  }
}

// ── #3 更多来源（2026-10-18 加，Kimi 评审指出：只搜关键词 = 只刷"搜索"，不是刷 B 站）
//   --source search（默认）| popular（热门）| rank（排行榜）| all（三个都要）
const SOURCE_HOT = String((process.argv.find((a) => a.startsWith('--source=')) ?? '').split('=')[1] ?? '')
  || (process.argv.includes('--source') ? String(process.argv[process.argv.indexOf('--source') + 1] ?? 'all') : 'all')
async function fetchPopular() {
  const j = await (await fetch('https://api.bilibili.com/x/web-interface/popular?pn=1&ps=20', { headers: H })).json()
  for (const it of (j?.data?.list ?? [])) {
    pool.push({ bv: it.bvid, t: String(it.title ?? '').replace(/<[^>]+>/g, ''), d: Number(it.duration ?? 0),
      dm: Number(it.stat?.danmaku ?? 0), play: Number(it.stat?.view ?? 0), up: it.owner?.name ?? '', kw: '热门',
      pubdate: it.pubdate })
  }
}
async function fetchRank() {
  const j = await (await fetch('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all', { headers: H })).json()
  for (const it of (j?.data?.list ?? []).slice(0, 20)) {
    pool.push({ bv: it.bvid, t: String(it.title ?? '').replace(/<[^>]+>/g, ''), d: Number(it.duration ?? 0),
      dm: Number(it.stat?.danmaku ?? 0), play: Number(it.stat?.view ?? 0), up: it.owner?.name ?? '', kw: '排行',
      pubdate: it.pubdate })
  }
}
// 关注的人发了什么（2026-10-18 加）：真人才会"刷关注"——只搜关键词等于只刷"搜索"，不像人
async function fetchFollowing() {
  const j = await (await fetch('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=video&page=1', { headers: H })).json()
  if (j?.code !== 0) throw new Error(`code=${j?.code} ${j?.message ?? ''}`)
  for (const it of (j?.data?.items ?? [])) {
    const a = it?.modules?.module_author
    const ar = it?.modules?.module_dynamic?.major?.archive
    if (!ar?.bvid) continue
    const dt = String(ar.duration_text ?? '')          // 形如 "05:23"
    const p = dt.split(':').map(Number)
    const secs = p.length === 2 ? p[0] * 60 + p[1] : p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : 0
    pool.push({ bv: ar.bvid, t: String(ar.title ?? '').replace(/<[^>]+>/g, ''), d: secs,
      dm: 0, play: Number(ar.stat?.play ?? 0), up: a?.name ?? '', kw: '关注',
      pubdate: a?.pub_ts ?? ar.pubdate })   // 动态的发布时间在 module_author.pub_ts ✓
  }
}
try { if (SOURCE_HOT === 'popular' || SOURCE_HOT === 'all') await fetchPopular() } catch { console.error('（热门源取不到，跳过）') }
try { if (SOURCE_HOT === 'rank' || SOURCE_HOT === 'all') await fetchRank() } catch { console.error('（排行源取不到，跳过）') }
try { if (SOURCE_HOT === 'following' || SOURCE_HOT === 'all') await fetchFollowing() } catch (e) { console.error(`（关注源取不到，跳过：${String(e.message).slice(0, 60)}）`) }
console.error(`[来源] ${SOURCE_HOT === 'all' ? '搜索 + 热门 + 排行 + 关注' : SOURCE_HOT === 'popular' ? '热门' : SOURCE_HOT === 'rank' ? '排行' : SOURCE_HOT === 'following' ? '关注' : '搜索'}`)

// ── #4 重点关注的 UP（2026-10-23 主人要求：「我想让她关注黑鸦Heya的投稿视频」）──────
//   为什么不靠上面那个"关注源"：它只回**已关注**的人，而"点关注"是改主人账号状态的
//   动作（prompts/AGENTS.md 第 3 节：不自动关注 ✗）—— 所以这里按 mid 直拉他的投稿：
//   公开接口、不需要关注关系、不产生任何对外动作 ✓
//   汇报重点也写在配置里（watchups[].topics）：主人要的是「他的稿子里主要汇报
//   DeepSeek / 国产大模型 / codex」，不是"他发的每条都值得 at 我"✗ → 命中主题的加权 ✓
const WATCH_UPS = normalizeWatchUps(config().watchups)
if (WATCH_UPS.length) {
  let got = 0
  for (const up of WATCH_UPS) {
    const items = await latestVideos(up, { count: 8 })
    for (const it of items) { it.watchUp = true; pool.push(it) }
    got += items.length
  }
  console.error(`[来源] ${describeWatchUps(WATCH_UPS)} → 拉到投稿 ${got} 条`)
}

// ── 反馈回流（2026-10-20 加 · 2026-10-23 扩成"喜欢 / 不喜欢"两向）─────────────
//   两个来源写同一本 feedback.json：
//     · 主人赞了她的评论 → `quota react` 写 kind:'like'（2026-10-20 就有）
//     · 主人私信说感不感兴趣 → 她当场 `bili feedback like|dislike --note "…"` 记一笔 ✓
//   为什么必须两向：只有加权时，"别再发显卡降价了"这句话落不进任何代码，下一轮照样推 ✗
const FEEDBACK = path.join(HOME, '.bili-ai', 'feedback.json')
const fbRaw = readFeedback(FEEDBACK)
const fbSplit = splitFeedback(fbRaw)
const likedEvents = fbSplit.liked.filter((e) => String(e.videoTitle ?? '').trim())   // 没标题的旧事件学不到东西，跳过 ✓
const dislikedEvents = fbSplit.disliked
const favBVs = new Set()
try {
  const fj = JSON.parse(fs.readFileSync(path.join(HOME, '.bili-ai', 'favorites.json'), 'utf8'))
  for (const x of (fj.items ?? [])) if (x?.bv) favBVs.add(x.bv)
} catch {}
const likedBVs = fbSplit.likedBVs
// 2026-10-23：主人点名「不喜欢」的那条视频直接拉黑 —— 同一个视频不该推第二遍 ✗
const dislikedBVs = fbSplit.dislikedBVs
  // 抽主题词 / 加权 / 降权全在 tools/lib/fbscore.mjs（纯函数，能单测 ✓）
  //   ⚠️ 原来 learnTokens 写在这里，ownerName 直接塞进 new RegExp → 昵称带 . ( ) 就会炸 ✗（lib 里已转义）
  const ownerName = String(config().owner?.name ?? '')
  // 她自己收藏过的（favorites.json）也算"品味信号" ✓ 和"被赞过的"并列
  let favItems = []
  try {
    const fj = JSON.parse(fs.readFileSync(path.join(HOME, '.bili-ai', 'favorites.json'), 'utf8'))
    favItems = (fj.items ?? []).filter((x) => x && x.bv)
  } catch {}
  const favTokens = [...new Set(favItems.flatMap((x) => learnTokens(String(x.title ?? '') + ' ' + String(x.reason ?? ''), ownerName)))]
  const { likedTokens, dislikedTokens } = tokenSets(fbRaw, ownerName)
  const learnedTokens = [...new Set([...likedTokens, ...favTokens])]

// ── 偏好命中与排序（2026-10-20 重写，主人定：不要对高播放量有偏向 ✗）────────────
//   旧：弹幕密度 + log10(播放)×3  → 大 UP 的爆款永远霸榜 ✗
//   新：log10(1+弹幕密度)×3 + 偏好命中×4 + 反馈学习×2.5（封顶 7.5）→ 播放量彻底移出 ✓
//   为什么密度要取 log：不取时"92 秒 15027 弹幕"那条得 163 分，偏好加满也压不过 ✗（实测）
const prefTokens = prefs.map((p) => ({
  label: p,
  tokens: [...new Set([p, ...String(p).split(/[\s·,，、/]+/).filter((t) => t.length >= 2)])],
}))
const hitsOf = (title) => prefTokens.filter((p) => p.tokens.some((tok) => title.includes(tok))).map((p) => p.label)
const densityOf = (x) => Math.log10(1 + x.dm / Math.max(30, x.d))
// 2026-10-20：排除她自己的视频（实测刷到过自己的《大肥鱼成精了》✗ 别让自己看自己）
const selfName = String(config().self?.name ?? "")
const usable = [...new Map(pool.map((x) => [x.bv, x])).values()]
  .filter((x) => !seen.has(x.bv) && !likedBVs.has(x.bv) && !favBVs.has(x.bv) && !dislikedBVs.has(x.bv))
  .filter((x) => !(selfName && String(x.up ?? "").includes(selfName)))

// ── 「只看 X 之后发布的视频」（2026-10-23 主人要求）─────────────────────────
//   配置键 preferences.publishedAfter，'' = 不限（默认，行为与以前完全一致）。
//   与学习侧的 candidates 共用 tools/lib/pubdate.mjs 的同一份判断 —— 两个入口一个口径 ✓
//   拿不到发布日期的条目算「不确定」丢掉，但条数会念出来（不静默）✓
let after = null
try {
  after = parseDay(config().preferences?.publishedAfter)
} catch (e) {
  console.error(`配置里的 preferences.publishedAfter 写错了：${e?.message ?? e}`)
  console.error('（这行配置不生效 = 一条都不会被过滤，所以宁可当场停下 —— 请改成 2026-09-01 这种写法）')
  process.exit(2)
}
const dateStats = splitByDay(usable, after)
const uniq = dateStats.kept
// 2026-10-23：命中"重点关注的人 × 他该汇报的主题"额外 +8 —— 主人点名的那个人、那些主题，
//   应当排在一堆泛搜索结果前面；但 +8 压不过"偏好命中 ×4"，所以话题本身仍然要她爱看 ✓
const scoreOf = (x) => densityOf(x) * 3 + hitsOf(x.t).length * 4 + boostOf(x.t, learnedTokens) - penaltyOf(x.t, dislikedTokens) + (x.topics?.length ? 8 : 0)
uniq.sort((a, b) => scoreOf(b) - scoreOf(a))
for (const x of uniq) { x._hits = hitsOf(x.t); x._score = scoreOf(x) }

// 多样性：同一"命中和类"最多 PER 条；完全没命中的最多 1 条（防凑数 ✗）
const kindUsed = {}
const diversified = []
for (const x of uniq) {
  const key = x._hits.length ? x._hits.join('+') : '__none__'
  kindUsed[key] = kindUsed[key] ?? 0
  if (kindUsed[key] >= (x._hits.length ? PER : 1)) continue
  kindUsed[key] += 1
  diversified.push(x)
}

console.log(`偏好（来自日记）: ${prefs.join(' · ')}`)
console.log(`反馈回流: ${describeFeedback({ liked: likedEvents, disliked: dislikedEvents, likedTokens, dislikedTokens, dislikedBVs })} · 她收藏 ${favItems.length} 条`)
console.log(`已看过/已评论过（已排除）: ${seen.size} 个 BV`)
console.log(`候选池: ${pool.length} 条 → 去重去已看后 ${usable.length} 条`)
const filterLine = describeFilter(dateStats)
if (filterLine) console.log(filterLine)
if (after && !uniq.length) {
  console.log(`⚠️ 「${after.day} 之后发布的」把这一轮全滤掉了 —— 这是日期过滤的结果，不是源坏了。`)
  console.log(`   想放宽：把设置页「只看 X 之后发布的视频」留空或改早一点（配置键 preferences.publishedAfter）。`)
}
console.log('')
console.log(`今天可以看这几条（每词最多 ${PER} 条，共 ${N} 条）：`)
const perKw = {}
let shown = 0
for (const x of diversified) {
  if (shown >= N) break
  perKw[x.kw] = perKw[x.kw] ?? 0
  // 多样性已在上一步做过 → 这里不再二次限流 ✓
  perKw[x.kw] += 1; shown += 1
  // 2026-10-23：重点 UP 的稿子额外打一个 `[重点:DeepSeek·codex]` ——
  //   主人一眼能看出"她要汇报的那几个主题"有没有真的命中 ✓（不然这条链路是隐形的）
  const mark = [
    x._hits.length ? `[${x._hits.join("+")}]` : "",
    x.topics?.length ? `[重点:${x.topics.join("·")}]` : "",
  ].filter(Boolean).join(" ")
  console.log(`  ${String(shown).padStart(2)}. ${x.bv}  ${String(x.d).padStart(4)}s  弹幕${String(x.dm).padStart(7)}  播放${String(x.play).padStart(9)}  ${x.t.slice(0, 40)}  @${x.up} ${mark}`)
}
console.log('\n看完跑：node bili.mjs debrief <BV>   → 然后把"想法"写进日记的「想说」区（不发）')
