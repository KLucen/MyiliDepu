/**
 * 关注同步：主人**用她的账号**在 B 站点了关注 → 自动按 `{ name, mid, topics }` 的格式
 * 写进配置的 `watchups`（重点关注名单）。
 *
 * 设计边界（刻意划的，别越界）：
 *   · **只读**。这个文件里没有任何"点关注/取关"的代码 —— 关注是改账号状态的动作，
 *     由主人在 B 站自己做（2026-10-23 主人原话：「以后我会直接用她的账号关注up主，
 *     监测到有新关注就按格式写进配置」）✓
 *   · **只增不减**。已经写进配置的条目永远不会被它删掉：取关只报告、不回收 ——
 *     主人可能只是想让她继续看那位的稿子。
 *   · **不覆盖主人的手写内容**。已存在条目的 `topics` 一个字都不动；新条目才套默认主题词。
 *   · **失败一律不抛**（`syncFollows`）。它挂在她的唤醒链路上，风控/断网/未登录
 *     都不能让"她今天醒不过来" ✗
 *
 * 为什么要存一份"上次看到过的名单"：B 站只告诉我们"现在关注了谁"，不告诉"新增了谁"。
 * 快照落在 `~/.bili-ai/follows-seen.json`（跟账号走，不跟数据目录走 ✓）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { homePath } from './paths.mjs'
import { config, saveConfig } from './config.mjs'
import { apiGet, signWbi } from './bili-api.mjs'
import { loadCred } from './cred.mjs'
import { biliHeaders } from './visual.mjs'
import { normalizeWatchUps } from './watchups.mjs'

/** 关注快照（按账号走，和 credentials.json 同一个目录）。 */
export const SEEN_PATH = homePath('.bili-ai', 'follows-seen.json')

const cleanName = (v) => String(v ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/**
 * 拉她账号的关注列表（`/x/relation/followings`，要 WBI 签名 + 她的 cookie）。
 *
 * 为什么要签名：这个接口 2022 年起就要 w_rid，不签直接 code -403/-352（"请求被拦截"），
 * 而且报错文案和"没登录"长得几乎一样，很容易误判成凭据坏了 ✗
 *
 * @returns {Promise<{total:number, list:Array<{mid:string,name:string,mtime:number}>, pages:number, complete:boolean}>}
 * @throws  网络/接口错误（code !== 0 也抛，带 `.apiCode`，由 syncFollows 兜住）
 */
export async function fetchFollowings({ get = apiGet, headers = {}, vmid, pageSize = 50, maxPages = 4, wbi, now = Date.now() } = {}) {
  const uid = String(vmid ?? '').trim()
  if (!/^\d+$/.test(uid)) {
    const e = new Error('读关注列表需要账号 mid（nav 没给 mid = 没登录）')
    e.code = 'NO_VMID'
    throw e
  }
  let img = wbi
  if (!img) {
    const nav = await get('https://api.bilibili.com/x/web-interface/nav', headers)
    img = nav?.data?.wbi_img
  }
  const out = []
  let total = 0
  let pages = 0
  let complete = false
  for (let pn = 1; pn <= maxPages; pn++) {
    const q = signWbi({ vmid: uid, ps: pageSize, pn, order: 'desc', order_type: 'attention' }, img, now)
    const j = await get(`https://api.bilibili.com/x/relation/followings?${q}`, headers)
    if (j?.code !== 0) {
      const e = new Error(`读关注列表被拒：code ${j?.code} ${j?.message ?? ''}`.trim())
      e.code = `API_${j?.code ?? 'X'}`
      e.apiCode = j?.code
      throw e
    }
    const list = Array.isArray(j?.data?.list) ? j.data.list : []
    total = Number(j?.data?.total ?? total) || total
    for (const it of list) {
      out.push({ mid: String(it?.mid ?? ''), name: cleanName(it?.uname), mtime: Number(it?.mtime ?? 0) || 0 })
    }
    pages = pn
    // 两种"到底了"：本页没满 / 拿够了 total（total 有时偏小，所以两个条件都要）
    if (list.length < pageSize || (total > 0 && out.length >= total)) { complete = true; break }
  }
  return { total, list: out.filter((x) => x.mid), pages, complete }
}

/** 读快照（不存在/坏了都当"没见过任何关注"，不抛）。 */
export function readSeen(file = SEEN_PATH) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    // 兼容两种历史形态：`{ list:[{mid,name}] }` 与更早的 `{ mids:[] }`
    const list = Array.isArray(j?.list) ? j.list : (Array.isArray(j?.mids) ? j.mids.map((m) => ({ mid: String(m), name: '' })) : [])
    return { at: typeof j?.at === 'string' ? j.at : null, list: list.map((x) => ({ mid: String(x?.mid ?? ''), name: cleanName(x?.name) })).filter((x) => x.mid) }
  } catch { return { at: null, list: [] } }
}

/** 写快照（失败静默：快照丢了只影响"新增"的判定，不影响她醒来）。 */
export function writeSeen(list, { file = SEEN_PATH, at = new Date().toISOString() } = {}) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const body = { at, list: (list ?? []).map((x) => ({ mid: String(x?.mid ?? ''), name: cleanName(x?.name) })).filter((x) => x.mid) }
    fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8')
    return true
  } catch { return false }
}

/**
 * 纯函数：这次比上次多了谁、少了谁。
 * @param {Array} seenList 上次的快照
 * @param {Array} nowList  这次拉到的人
 */
export function diffFollows(seenList, nowList) {
  const seen = new Map((seenList ?? []).map((x) => [String(x?.mid ?? ''), cleanName(x?.name)]))
  const now = new Map((nowList ?? []).map((x) => [String(x?.mid ?? ''), cleanName(x?.name)]))
  const added = [...now.entries()].filter(([mid]) => mid && !seen.has(mid)).map(([mid, name]) => ({ mid, name }))
  const removed = [...seen.entries()].filter(([mid]) => mid && !now.has(mid)).map(([mid, name]) => ({ mid, name }))
  return { added, removed }
}

/**
 * 纯函数：把"新增的关注"并进 `watchups`。
 *   · 已在名单里的（同 mid 或同名，大小写不敏感）跳过 —— 包括主人手写的、没有 mid 的条目
 *   · 一次最多加 `max` 个（防止某天关注了几百人把配置撑爆）；超出的报 `over-limit`，下次还能补上
 *   · 已存在条目的 topics 不动；新条目套 `topics`（默认主题词，来自配置的 follows.topics）
 */
export function mergeWatchUps(existing, added, { topics = [], max = 10 } = {}) {
  const kept = normalizeWatchUps(existing)
  const known = new Set()
  for (const u of kept) {
    if (u.mid) known.add(`mid:${u.mid}`)
    if (u.name) known.add(`name:${u.name.toLowerCase()}`)
  }
  const cleanTopics = [...new Set((Array.isArray(topics) ? topics : []).map((t) => String(t ?? '').trim()).filter(Boolean))]
  const limit = Math.max(0, Number(max) || 0)
  const out = [...kept]
  const took = []
  const skipped = []
  for (const f of added ?? []) {
    const mid = String(f?.mid ?? '').trim()
    const name = cleanName(f?.name)
    if (!name) { skipped.push({ mid, name, why: 'no-name' }); continue }
    if ((mid && known.has(`mid:${mid}`)) || known.has(`name:${name.toLowerCase()}`)) { skipped.push({ mid, name, why: 'already' }); continue }
    if (took.length >= limit) { skipped.push({ mid, name, why: 'over-limit' }); continue }
    const entry = { name, mid, topics: [...cleanTopics] }
    out.push(entry)
    took.push(entry)
    if (mid) known.add(`mid:${mid}`)
    known.add(`name:${name.toLowerCase()}`)
  }
  return { watchups: out, added: took, skipped }
}

/** 一行给人和给提示词看的话（没有新增就返回 ''）。 */
export function describeFollows(r) {
  if (!r?.ok) return ''
  const bits = []
  if (r.added?.length) bits.push(`新关注 ${r.added.length} 位：` + r.added.map((x) => x.name || x.mid).join('、'))
  if (r.removed?.length) bits.push(`取关 ${r.removed.length} 位：` + r.removed.map((x) => x.name || x.mid).join('、'))
  if (r.skipped?.length) {
    const over = r.skipped.filter((x) => x.why === 'over-limit').length
    if (over) bits.push(`${over} 位超出单次上限，下一轮再写`)
  }
  return bits.join(' · ')
}

/**
 * 一条龙：拉关注 → 比快照 → 并进 `watchups` →（非 dry 时）落盘配置 + 更新快照。
 *
 * **永远不会抛**：返回 `{ ok:false, code, message }` 交给调用方决定怎么显示。
 * 这是它和别的 lib 最大的不同 —— 它挂在她的唤醒链路上，失败只能"这轮不更新名单"，
 * 不能变成"她今天醒不过来" ✗
 *
 * @returns {Promise<{ok:boolean, code?:string, message?:string, total?:number, complete?:boolean,
 *   added?:Array, removed?:Array, skipped?:Array, watchups?:Array, wroteConfig?:boolean, dry?:boolean}>}
 */
export async function syncFollows(opts = {}) {
  // 总时限：网络卡住时必须能"放弃"，不能把调用方（宿主的一个 tick）永远挂住。
  //   为什么要有这层：her 的 tick 里有 `waking` 标志，await 不返回 = 生物钟从此不再醒来 ✗
  //   定时器 unref()：别让一个还没跑完的看门狗拖住整个进程退出（测试里尤其明显）
  const timeoutMs = Number(opts.timeoutMs ?? 20000) || 0
  const work = syncFollowsInner(opts)
  if (!timeoutMs) return work
  let timer = null
  const guard = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ ok: false, code: 'TIMEOUT', message: `关注同步超过 ${Math.round(timeoutMs / 1000)}s 没返回（网络卡住），这一轮跳过` }),
      timeoutMs,
    )
    if (typeof timer?.unref === 'function') timer.unref()
  })
  try {
    return await Promise.race([work, guard])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** syncFollows 的本体（不带看门狗，便于单测直接驱动）。 */
async function syncFollowsInner(opts = {}) {
  const dry = opts.dry !== false
  try {
    const c = opts.cfg ?? config()
    const fcfg = c?.follows ?? {}
    const max = opts.max ?? (Number(fcfg.maxAdd ?? 10) || 10)
    const topics = opts.topics ?? (Array.isArray(fcfg.topics) ? fcfg.topics : [])
    const seenFile = opts.seenFile ?? SEEN_PATH

    const cred = opts.cred ?? loadCred()
    const headers = opts.headers ?? biliHeaders(cred)
    const get = opts.get ?? apiGet
    const now = opts.now ?? Date.now()

    const nav = await get('https://api.bilibili.com/x/web-interface/nav', headers)
    const uid = String(opts.vmid ?? nav?.data?.mid ?? '').trim()
    if (!uid) return { ok: false, code: 'NO_LOGIN', message: '读不到她的账号 mid（没登录 / cookie 过期）' }
    // Referer 必须是"关注列表"那一页 —— 用视频页的 Referer 会被风控盯上（412/-352）✗
    const fh = { ...headers, referer: `https://space.bilibili.com/${uid}/fans/follow` }
    const got = await fetchFollowings({ get, headers: fh, vmid: uid, now, wbi: nav?.data?.wbi_img })
    const seen = readSeen(seenFile)
    const { added, removed } = diffFollows(seen.list, got.list)
    const merged = mergeWatchUps(c?.watchups, added, { topics, max })

    const result = {
      ok: true, dry, uid, total: got.total, complete: got.complete,
      added: merged.added, removed: got.complete ? removed : [], skipped: merged.skipped,
      watchups: merged.watchups, wroteConfig: false, wroteSeen: false,
    }
    if (dry) return result

    // 快照：完整拉到就整体替换；被截断就"老的 + 新的"求并集（免得把没看到的人误判成取关）
    const nextSeen = got.complete
      ? got.list
      : [...new Map([...seen.list, ...got.list].map((x) => [x.mid, x])).values()]
    result.wroteSeen = writeSeen(nextSeen, { file: seenFile, at: new Date(now).toISOString() })

    if (merged.added.length) {
      const next = { ...c }
      for (const k of Object.keys(next)) if (k.startsWith('__')) delete next[k]
      next.watchups = merged.watchups
      saveConfig(next)
      result.wroteConfig = true
    }
    return result
  } catch (e) {
    return { ok: false, code: e?.code ?? 'FAILED', apiCode: e?.apiCode, message: String(e?.message ?? e).slice(0, 300) }
  }
}
