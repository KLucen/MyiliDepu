// 重点关注某个 UP 的投稿（2026-10-23 主人要求：「不一定会真的在 B 站上关注他」）。
//
// 为什么单开一条通路，而不是"让她去关注"：
//   ① 关注是**改主人账号状态**的动作（见 prompts/AGENTS.md 第 3 节：不自动关注），
//      不能为了"看得见"就去点关注 ✗；
//   ② 关注动态源（x/polymer/web-dynamic/v1/feed/all）只回**已关注**的人 ——
//      没关注就永远刷不到，这正是主人说的那个缺口；
//   ③ 所以这里直接按 mid 拉这个人的投稿列表（x/space/wbi/arc/search），
//      公开接口、不需要关注关系，也不产生任何对外动作 ✓。
//
// 为什么单独一个模块，而不是塞进 feed.mjs：
//   「配置值 → 干净名单」「昵称 → mid」「mid → 投稿」是三件不同的事，
//   跟选题打分混在一起以后，设置页想复用解析就得抄一遍（抄的那份迟早分叉 ✗）。
//
// 硬约定（主人半夜跑生物钟，一个网络错误不该让整轮崩掉）：
//   · 本模块**绝不抛异常**：resolveMid 查不到 → null，latestVideos 拉不到 → []；
//   · 但降级前一定用 console.error 说一句人话（照 feed.mjs「（热门源取不到，跳过）」的口吻）——
//     静默失败最难查：症状只是"她最近没看那个 UP"，没人会收到报错 ✗；
//   · **不在模块顶层发请求**、也不读配置文件：配置由调用方传进来，这里只认入参。
//
// ⚠️ 日志里永远不许出现 cookie：这里只打 code / message / 昵称，绝不打印 headers
//   （prompts/AGENTS.md 第 3 节：凭据不进终端与日志）。
import { apiGet, signWbi } from './bili-api.mjs'
import { loadCred } from './cred.mjs'
import { biliHeaders } from './visual.mjs'
import { pubdateOf } from './pubdate.mjs'

// referer 要跟着接口走：search 是 search.bilibili.com，space 是 space.bilibili.com。
// 2026-10-23 实测：space 接口的 referer 不对时更容易吃 -352（跟 feed.mjs 里 search 用 search 域同理）。
const SEARCH_REFERER = 'https://search.bilibili.com/'
const spaceReferer = (mid) => `https://space.bilibili.com/${mid}/video`

/** 搜索结果里的高亮标签（<em class="keyword">黑鸦</em>Heya）必须剥掉，否则昵称比不相等 ✗ */
const stripTags = (v) => String(v ?? '').replace(/<[^>]+>/g, '')

/** 报错原因压成一行（日志别刷屏；也不含空白换行）—— 照 feed.mjs 的 slice(0, 60) */
const brief = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)

/**
 * 请求头：能读到凭据就带 cookie（不带的话 space 接口经常直接 -352），
 * 读不到**不算错误** —— 只读接口匿名也能用，降级成匿名的头继续走 ✓
 * 用 visual.mjs 里现成的 biliHeaders：它是仓库里唯一一份「凭据 → 请求头」的实现，
 * 不在这里另抄一份（抄的那份会跟 cookie 字段名一起烂掉 ✗）。
 * deps.headers 是留给测试/上层注入用的（给了就不再读凭据文件）。
 */
function headersFor(referer, deps) {
  if (deps?.headers) return deps.headers
  let cred = null
  try { cred = loadCred() } catch { cred = null }   // 没有凭据文件是常态，不打断流程
  const h = biliHeaders(cred ?? {})
  if (!h.cookie) delete h.cookie   // 没凭据时别发一个空的 cookie 头，宁可像匿名浏览器
  h.referer = referer
  return h
}

/** 接口的 length 是 '12:34' / '1:02:03' 这种文本，feed 的 d 要秒数；看不懂的给 0 */
function lengthToSecs(text) {
  if (typeof text === 'number' && Number.isFinite(text)) return Math.max(0, Math.floor(text))
  const parts = String(text ?? '').trim().split(':')
  if (!parts.length || parts.length > 3) return 0
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return 0
  return nums.reduce((acc, n) => acc * 60 + n, 0)
}

/**
 * 配置值 → 干净的名单 `[{ name, mid, topics }]`。
 *
 * 配置是人手写的，脏数据比想象的多（'黑鸦Heya' / ['A','B'] / [{name,mid,topics}] / null /
 * 缺 name / 写重了），所以一次清干净，后面所有代码都不用到处判空 ✓
 *   · undefined / null / '' → []（"没配" = 这个功能整体不生效）
 *   · 字符串、对象都接受（单个或数组都行）
 *   · 没有 name 的一律丢掉：mid 单独存在没用，读出来没人认识它是谁
 *   · topics 不是数组就当 []，**不给默认词** —— 默认值属于上层配置，这里保持中性
 *   · 去重：同 mid 或同名（大小写不敏感）只留第一条（写重复是这类名单最常见的脏数据）
 *   · mid 统一成字符串：配置里可能写成数字 12345，跟接口回来的 '12345' 比会静默不相等 ✗
 *     非数字的 mid 当"没填"（否则会拼出 mid=abc 的请求，白打一次网络）
 */
export function normalizeWatchUps(value) {
  const out = []
  const seen = new Set()
  const add = (raw) => {
    const src = typeof raw === 'string' ? { name: raw } : (raw && typeof raw === 'object' ? raw : null)
    if (!src) return
    // 有人会从评论区抄成 '@黑鸦Heya' —— @ 不是昵称的一部分，先剥掉再查 ✓
    const name = String(src.name ?? '').trim().replace(/^@+/, '').trim()
    if (!name) return
    const midText = String(src.mid ?? '').trim()
    const mid = /^\d+$/.test(midText) ? midText : ''
    const topics = Array.isArray(src.topics)
      ? [...new Set(src.topics.map((t) => String(t ?? '').trim()).filter(Boolean))]
      : []
    const nameKey = `name:${name.toLowerCase()}`
    const midKey = mid ? `mid:${mid}` : ''
    const dup = seen.has(nameKey) || (midKey && seen.has(midKey))
    // 先记下这一条的两个键**再**决定去留：哪怕它是因为 mid 撞了被丢掉的，
    // 它的名字也算"出现过了" —— 否则后面再写一次同名（大小写不同）又会混进来 ✗
    seen.add(nameKey)
    if (midKey) seen.add(midKey)
    if (dup) return
    out.push({ name, mid, topics })
  }
  if (Array.isArray(value)) for (const v of value) add(v)
  else add(value)
  return out
}

/**
 * 按昵称查 mid（search_type=bili_user）。
 * 为什么需要它：主人只会给昵称（'黑鸦Heya'），不会知道 mid 是多少。
 * @returns {Promise<{mid:string, name:string, fans:number}|null>} 查不到 / 网络失败一律 null（**不抛**）
 */
export async function resolveMid(name, deps = {}) {
  const get = deps.get ?? apiGet
  const keyword = String(name ?? '').trim()
  if (!keyword) return null
  const headers = headersFor(SEARCH_REFERER, deps)
  try {
    // 名字里可能有空格/特殊字符（'黑鸦 Heya'），必须 encodeURIComponent ✗ 否则参数被切断
    const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=bili_user&keyword=${encodeURIComponent(keyword)}`
    const j = await get(url, headers)
    if (j?.code !== 0) {
      console.error(`（按昵称「${keyword}」查 mid 失败，跳过：code=${j?.code} ${brief(j?.message)}）`)
      return null
    }
    const raw = Array.isArray(j?.data?.result) ? j.data.result : (Array.isArray(j?.data?.results) ? j.data.results : [])
    const all = raw
      .filter((r) => r && (r.mid ?? '') !== '')
      .map((r) => ({ mid: String(r.mid), name: stripTags(r.uname ?? r.name ?? ''), fans: Number(r.fans ?? 0) }))
    if (!all.length) {
      console.error(`（按昵称「${keyword}」没搜到 UP，跳过）`)
      return null
    }
    // 同名的人可能好几个（小号、搬运号）：优先取昵称**完全一样**的那个，否则拿第一个。
    // 不按 fans 排：粉丝多的是"最出名"的那个，不是主人说的那个 ✗
    return all.find((r) => r.name === keyword) ?? all[0]
  } catch (error) {
    console.error(`（按昵称「${keyword}」查 mid 失败，跳过：${brief(error?.message ?? error)}）`)
    return null
  }
}

/**
 * 拉一个 UP 的最新投稿，产出**能直接塞进 feed.mjs 候选池**的条目。
 *
 * 走 x/space/wbi/arc/search —— ⚠️ 必须带 wbi 签名：apiGet 只自动签
 * /x/web-interface/view 与 /x/player/playurl（见 bili-api.mjs 的 signedPaths），
 * space 系列不在里面，得自己先取 nav 的 wbi_img 再交给现成的 signWbi ✓
 *
 * @param {{name?:string, mid?:string|number, topics?:string[]}} up
 * @param {{get?:Function, count?:number, now?:number, headers?:object}} [deps]
 * @returns {Promise<Array<{bv:string,t:string,d:number,dm:number,play:number,up:string,
 *   kw:string,pubdate:number|undefined,upMid:string,topics:string[]}>>} 任一环节失败 → []（**不抛**）
 */
export async function latestVideos(up, deps = {}) {
  const get = deps.get ?? apiGet
  const name = String(up?.name ?? '').trim()
  const topics = Array.isArray(up?.topics) ? up.topics.map((t) => String(t ?? '')).filter(Boolean) : []
  // ps 上限 50（接口自己的限制）：传 0/负数会被接口当默认值，不如自己夹紧，省得"以为只拿 3 条" ✗
  const count = Math.max(1, Math.min(50, Math.floor(Number(deps.count ?? 10)) || 10))
  try {
    let mid = String(up?.mid ?? '').trim()
    if (!/^\d+$/.test(mid)) {
      const found = await resolveMid(name, deps)   // 没给 mid 就先查；查不到就整段跳过，绝不猜
      if (!found?.mid) {
        console.error(`（重点关注「${name}」的 mid 没解析出来，这一轮先跳过这个人）`)
        return []
      }
      mid = found.mid
    }
    const headers = headersFor(spaceReferer(mid), deps)
    const nav = await get('https://api.bilibili.com/x/web-interface/nav', headers)
    if (nav?.code !== 0 || !nav?.data?.wbi_img) {
      console.error(`（WBI 签名密钥没拿到，重点关注「${name}」的最新投稿跳过：code=${nav?.code} ${brief(nav?.message)}）`)
      return []
    }
    const query = signWbi({ mid, ps: count, pn: 1, order: 'pubdate' }, nav.data.wbi_img, deps.now ?? Date.now())
    const j = await get(`https://api.bilibili.com/x/space/wbi/arc/search?${query}`, headers)
    if (j?.code !== 0) {
      console.error(`（「${name}」的最新投稿接口失败，跳过：code=${j?.code} ${brief(j?.message)}）`)
      return []
    }
    // 形状：data.list.vlist（现版）；data.vlist（老版）—— 接口改过一次名，两种都认
    const list = j?.data?.list?.vlist ?? j?.data?.vlist ?? []
    if (!Array.isArray(list) || !list.length) {
      console.error(`（「${name}」一条投稿都没拉到，跳过）`)
      return []
    }
    const out = []
    for (const it of list) {
      if (!it?.bvid) continue   // 没有 BV 的条目（充电专属 / 已失效）看不了，丢掉
      const title = stripTags(it.title ?? '')
      // 复用 pubdate.mjs 的同一份字段解析（pubdate / ctime / …）：日期口径只许有一处 ✓
      const pub = pubdateOf(it)
      out.push({
        bv: String(it.bvid),
        t: title,
        d: lengthToSecs(it.length),
        dm: Number(it.video_review ?? 0),
        play: Number(it.play ?? 0),
        up: String(it.author ?? name),
        kw: '关注UP',   // feed.mjs 用它做来源多样性统计与打印，别留空
        pubdate: pub === null ? undefined : pub,
        upMid: mid,
        topics: topicHitsOf(title, topics),
      })
    }
    return out
  } catch (error) {
    console.error(`（重点关注「${name}」的最新投稿取不到，跳过：${brief(error?.message ?? error)}）`)
    return []
  }
}

/**
 * 标题命中了哪些主题词。
 * 大小写不敏感（'Codex' 要能被 'codex' 命中）；中文直接 includes —— **不分词**，
 * 因为分词会把 '国产大模型' 切成 '国产' + '大模型'，反而误命中一堆别的东西 ✗
 * @returns {string[]} 命中的标签（按传入顺序、去重；没命中 → []）
 */
export function topicHitsOf(title, topics) {
  const text = String(title ?? '').toLowerCase()
  if (!text) return []
  const out = []
  const hit = new Set()
  for (const raw of Array.isArray(topics) ? topics : []) {
    const label = String(raw ?? '').trim()
    if (!label) continue   // 空串 includes 恒真，会"命中一切" ✗
    const key = label.toLowerCase()
    if (!text.includes(key) || hit.has(key)) continue
    hit.add(key)   // 同一个词写成 'Codex' / 'codex' 只算命中一次
    out.push(label)
  }
  return out
}

/**
 * 给输出用的一句话（空名单返回 ''，调用方就能直接 console.log 不用判空）：
 *   『重点关注：黑鸦Heya（DeepSeek · 国产大模型 · codex）』
 * 主题词之间用 ' · '（与 feed.mjs 里 prefs.join(' · ') 一个样子）；
 * 多人之间用 '、'。传原始配置值也认（先过 normalizeWatchUps，脏数据漏不到这行输出里）。
 */
export function describeWatchUps(list) {
  const parts = normalizeWatchUps(list)
    .map((u) => (u.topics.length ? `${u.name}（${u.topics.join(' · ')}）` : u.name))
  return parts.length ? `重点关注：${parts.join('、')}` : ''
}
