// 发布日期的统一判断（2026-10-23 主人要求「只看 2026 年 9 月之后发布的视频」）。
//
// 为什么单独一个模块：这条规则要同时管两条通路 ——
//   ① `tools/commands/feed.mjs` 的候选池（「今天可以看这几条」）
//   ② `lib/reading/reader.mjs` 的学习候选（candidates → read → journal）
// 两边的数据源不同（搜索 / 热门 / 排行 / 关注 / popular API），字段名也乱
// （pubdate / pubtime / pub_ts / created / ctime），所以解析与筛选必须同源 ——
// 否则「设了，但某一条通路没生效」这种静默不一致会再出现一次 ✗
//
// 语义（故意保守，宁可少看也不错看）：
//   · 没配置（'' / null / 未填）→ 全部放行，行为与以前**完全一致** ✓
//   · 配了日期 → 只放行「能确认发布时间 ≥ 该日」的条目；
//     **拿不到日期的条目算「不确定」，丢掉**，但条数会被报出来（不静默）✓
//   · 日期字符串不合法 → 抛 INVALID_DAY（fail-closed：宁可当场报错，
//     也不要让人以为「设上了」其实一个都没过滤 ✗）
//
// ⚠️ 时间口径：pubdate 是 unix 秒；判断用的是**本地时区的自然日**
//   （主人说「9 月之后」指的是日历上的 9 月 1 日 00:00，不是 UTC）。

/** 支持的字段名（越靠前越优先）：B 站各接口用的是不同的名字 */
const DATE_KEYS = ['pubdate', 'pubtime', 'pub_ts', 'created', 'ctime', 'date']

/** 2001-09-09 之后的秒级时间戳下限；用来把「毫秒」和「秒」分开（B 站全是秒） */
const MS_FLOOR = 1e11

export class PubdateError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PubdateError'
    this.code = code
  }
}

/** 'YYYY-MM-DD' / 'YYYY-M-D' / 'YYYY/MM/DD' → { y, m, d, day, from }；空值 → null */
export function parseDay(value) {
  if (value === undefined || value === null) return null
  const raw = String(value).trim()
  if (!raw) return null
  const m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (!m) {
    throw new PubdateError(
      'INVALID_DAY',
      `发布日期的写法看不懂：${JSON.stringify(raw)}（要形如 2026-09-01）`,
    )
  }
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const from = new Date(y, mo - 1, d, 0, 0, 0, 0)
  if (from.getFullYear() !== y || from.getMonth() !== mo - 1 || from.getDate() !== d) {
    throw new PubdateError('INVALID_DAY', `这个日期不存在：${raw}`)
  }
  return { y, m: mo, d, from, day: `${y}-${pad(mo)}-${pad(d)}`, raw }
}

const pad = (n) => String(n).padStart(2, '0')

/** unix 秒（或毫秒）→ 'YYYY-MM-DD'（本地时区）；非法 → null */
export function dayText(ts) {
  const sec = toSeconds(ts)
  if (sec === null) return null
  const dt = new Date(sec * 1000)
  if (Number.isNaN(dt.getTime())) return null
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

/** 'YYYY-MM-DD HH:MM:SS' / 秒 / 毫秒 / 数字串 → unix 秒；拿不到 → null */
export function toSeconds(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return null
    return value > MS_FLOOR ? Math.floor(value / 1000) : Math.floor(value)
  }
  const s = String(value).trim()
  if (/^\d{9,13}$/.test(s)) return toSeconds(Number(s))
  // '2026-09-01 12:30:00' / '2026-09-01T12:30:00+08:00' / '2026-09-01'
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const dt = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), 0,
  )
  if (Number.isNaN(dt.getTime())) return null
  return Math.floor(dt.getTime() / 1000)
}

/** 从任意条目里取发布时间（unix 秒）；拿不到 → null */
export function pubdateOf(item) {
  if (!item || typeof item !== 'object') return null
  for (const k of DATE_KEYS) {
    const sec = toSeconds(item[k])
    if (sec !== null) return sec
  }
  // 关注动态：发布时间在同级 module_author.pub_ts 里
  const pub = toSeconds(item?.modules?.module_author?.pub_ts)
  return pub
}

/** 条目是否「能确认 ≥ after」；after 为 null 时恒 true，日期取不到时 false */
export function isAfter(item, after) {
  if (!after) return true
  const sec = pubdateOf(item)
  if (sec === null) return false
  return sec >= Math.floor(after.from.getTime() / 1000)
}

/**
 * 按日期切一刀。
 * @param {Array} items 任意条目数组
 * @param {string|object|null} after 原始日期串（'' / null = 不限）或 parseDay 的结果
 * @returns {{kept:Array, droppedOld:number, droppedUnknown:number, scanned:number, day:string|null, from:Date|null}}
 */
export function splitByDay(items, after) {
  const limit = typeof after === 'object' && after !== null ? after : parseDay(after)
  const list = Array.isArray(items) ? items : []
  if (!limit) {
    return { kept: list, droppedOld: 0, droppedUnknown: 0, scanned: list.length, day: null, from: null }
  }
  const floor = Math.floor(limit.from.getTime() / 1000)
  const kept = []
  let droppedOld = 0
  let droppedUnknown = 0
  for (const it of list) {
    const sec = pubdateOf(it)
    if (sec === null) droppedUnknown += 1
    else if (sec < floor) droppedOld += 1
    else kept.push(it)
  }
  return { kept, droppedOld, droppedUnknown, scanned: list.length, day: limit.day, from: limit.from }
}

/** 给输出用的一句话（设了才非空）：『只看 2026-09-01 之后发布的』 */
export function describeDay(after) {
  const limit = typeof after === 'object' && after !== null ? after : safeParse(after)
  return limit ? `只看 ${limit.day} 之后发布的` : ''
}

function safeParse(value) {
  try { return parseDay(value) } catch { return null }
}

/** 给输出用的一句话（不静默）：丢掉了几条、其中几条是因为没日期 */
export function describeFilter(stats) {
  if (!stats || !stats.day) return ''
  // kept 既可能是数组，也可能是已经切好的条数（reader 那边挂在数组上的 filterStats）✓
  const kept = Number.isFinite(stats.kept) ? stats.kept : (stats.kept?.length ?? 0)
  const parts = [`日期过滤「${stats.day} 之后」：${stats.scanned} 条里留下 ${kept} 条`]
  if (stats.droppedOld) parts.push(`更早丢掉 ${stats.droppedOld} 条`)
  if (stats.droppedUnknown) parts.push(`没有发布日期的丢掉 ${stats.droppedUnknown} 条`)
  return parts.join('，')
}
