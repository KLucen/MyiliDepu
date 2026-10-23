// 反馈打分（2026-10-23 主人要求：「我可以通过私信告诉她我感不感兴趣，反馈到评分上」）
//
// 数据还是同一本 `~/.bili-ai/feedback.json`：
//   · 主人点赞她的评论 → `quota react` 写 `kind:'like'` 事件（2026-10-20 就有）
//   · 主人私信说喜欢/不喜欢 → `bili feedback like|dislike` 写事件（本次新增）
// 这里把两种事件统一成「加权词 / 避雷词 / 拉黑的 BV」，feed 选题时用同一份口径算分 ✓
//
// 为什么把 learnTokens 从 feed.mjs 搬到这里：feed 是脚本（跑一次就退），没法单测 ✗
//   抽成纯函数后 tests/feedback.test.mjs 能直接验词表和加减分 ✓
import fs from 'node:fs'

// 抽主题词时的噪音词：中文 3-4 字 n-gram 会切出「我为/添加」这种，手工列出来别学 ✓
export const STOP_WORDS = new Set(['我为', '添加', '开屏', '广告', '这个', '那个', '什么', '自己', '可以', '就是', '一个'])

/**
 * 从一段文本抽主题词：拉丁词（≥2 字符）+ 中文 3-4 字 n-gram。
 * @param {string} text
 * @param {string} ownerName 主人昵称 —— 她说话总带「@主人」，不剔掉会学到一个没用的词
 */
export function learnTokens(text, ownerName = '') {
  const out = new Set()
  const src = String(text ?? '')
  // ⚠️ ownerName 为空时 new RegExp('') 会在每个字之间插空格 → 必须先判断 ✗（实测踩过）
  // ⚠️ 昵称里可能有 . + ( ) 这类正则元字符（实测主人昵称就带过）→ 先转义再拼 ✓
  const esc = ownerName ? String(ownerName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : ''
  const base = esc ? src.replace(new RegExp(esc, 'g'), ' ') : src
  const t = base.replace(/@\S+/g, ' ')
  for (const m of t.matchAll(/[A-Za-z][A-Za-z0-9]{1,}/g)) if (m[0].length >= 2) out.add(m[0].toLowerCase())
  for (const m of t.matchAll(/[\u4e00-\u9fa5]{2,}/g)) {
    const run = m[0]
    for (const n of [3, 4]) for (let i = 0; i + n <= run.length; i += 1) {
      const g = run.slice(i, i + n)
      if (!STOP_WORDS.has(g)) out.add(g)
    }
  }
  return [...out]
}

/** 读 feedback.json —— 读不到/坏了都当"还没有反馈"，绝不抛 */
export function readFeedback(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return j && typeof j === 'object' ? j : { events: [] }
  } catch { return { events: [] } }
}

/**
 * 把 events 分成「喜欢」「不喜欢」两拨。
 * 兼容 2026-10-20 的老事件：那时没有 kind，只在 note 里写了 BV。
 */
export function splitFeedback(fb) {
  const events = Array.isArray(fb?.events) ? fb.events.filter(Boolean) : []
  const liked = events.filter((e) => e.kind === 'like' || (!e.kind && typeof e.note === 'string' && /BV[0-9A-Za-z]{10}/.test(e.note)))
  const disliked = events.filter((e) => e.kind === 'dislike')
  const bvs = (list) => new Set(list.map((e) => e.bv).filter((b) => typeof b === 'string' && b))
  return { events, liked, disliked, likedBVs: bvs(liked), dislikedBVs: bvs(disliked) }
}

/** 喜欢的词 / 避雷的词 —— 只对"带得动主题词"的事件有效（没标题的老事件学不到东西） */
export function tokenSets(fb, ownerName = '') {
  const { liked, disliked } = splitFeedback(fb)
  const of = (list) => [...new Set(list.flatMap((e) => learnTokens(String(e.videoTitle ?? '') + ' ' + String(e.comment ?? e.note ?? ''), ownerName)))]
  return { likedTokens: of(liked), dislikedTokens: of(disliked) }
}

const hitsOf = (title, tokens) => tokens.filter((tok) => String(title).toLowerCase().includes(tok)).length

/** 喜欢的加权：每条命中 +per，封顶 cap（不压过偏好命中的主权重 ✓） */
export function boostOf(title, likedTokens, { cap = 7.5, per = 2.5 } = {}) {
  return Math.min(cap, hitsOf(title, likedTokens) * per)
}

/**
 * 不喜欢的降权：同样每条 −per、封顶 −cap。
 * 为什么封顶和加权一样：一条被讨厌的视频不该让**所有**候选沉底
 *   —— 那会变成"主人一句话把选题池清空"，她会没东西可看 ✗
 */
export function penaltyOf(title, dislikedTokens, { cap = 7.5, per = 2.5 } = {}) {
  return Math.min(cap, hitsOf(title, dislikedTokens) * per)
}

/** 给提示词用：主人最近的私信反馈（让她打分时保持一致，别今天说好明天说坏） */
export function recentDmLines(fb, limit = 3) {
  const list = (Array.isArray(fb?.events) ? fb.events : [])
    .filter((e) => e && e.source === 'dm' && (e.kind === 'like' || e.kind === 'dislike'))
    .slice(-limit)
  return list.map((e) => {
    const what = String(e.videoTitle ?? '').trim() || String(e.comment ?? e.note ?? '').trim() || '(没说哪条)'
    return `${e.kind === 'like' ? '喜欢' : '不喜欢'}「${what.slice(0, 40)}」`
  })
}

/** 输出用的中文摘要 */
export function describeFeedback(s) {
  const bits = [`喜欢 ${s.liked.length} 条`, `不喜欢 ${s.disliked.length} 条`, `加权 ${s.likedTokens.length} 词`]
  if (s.dislikedTokens.length) bits.push(`避雷 ${s.dislikedTokens.length} 词`)
  if (s.dislikedBVs.size) bits.push(`拉黑 ${s.dislikedBVs.size} 个视频`)
  return bits.join(' · ')
}
