// 统一配置层 —— 一个文件承载所有"属于使用者"的东西。
//
// 为什么要有它（2026-10-14 外部评审指出的最大架构缺口）：
//   在此之前，"个人化的东西"散在四处、形态还不一样 ——
//     ① `~/.bili-ai/quota.json`（额度/白名单，独立文件）
//     ② `~/.dsh/whale-night.config.json`（作息，独立文件）
//     ③ `whale-diary.md` 的叙事段落（偏好被 feed.mjs 解析 Markdown 提取 ✗ 脆弱）
//     ④ 代码里硬编码（历史昵称 SELF_NAMES ✗）
//   使用者的体验是"我得读源码才知道要改哪" ✗ —— 这不是模板，是作者的自用件。
//   现在：**填一个 `myilidepu.config.json` 就完成自定义** ✓，其余全是中性默认值。
//
// 2026-10-22 合并 dsh-bili-humanism 后新增四组配置（学习 / 人格 / 双日记 / 足迹），
// 见文件末尾注释。整套配置只有一个来源，宿主半边（lib/index.js）也直接读这里，
// 不再各留一份 DEFAULTS（以前两边各抄一遍，加一个键要改两处，迟早分叉）。
//
// 查找顺序：$MYILIDEPU_CONFIG → $BILI_WHALE_CONFIG → $DSH_HOME/myilidepu.config.json
//           → $DSH_HOME/bili-whale.config.json（旧版兜底）→ 内置默认值（中性）
import fs from 'node:fs'
import path from 'node:path'
// ⚠️ 2026-10-21：configPath 必须 **import 进来** 才可用 ✗
//   `export { configPath } from './paths.mjs'` 只是再导出，不会创建本地绑定 →
//   下面 config() 里的 fs.readFileSync(configPath) 会拿到 undefined → 抛错 → 被 catch 吞掉
//   → 静默退回默认值（self / owner / quota / preferences 全部失效）✗ 实测踩到
import { dshPath, configPath, legacyConfigPath } from './paths.mjs'


const HOME = process.env.USERPROFILE || process.env.HOME || '.'
export { configPath, legacyConfigPath } from './paths.mjs'

/** 中性默认值：不含任何作者的个人信息，换个人也能跑。 */
export const DEFAULTS = {
  persona: {
    name: '<角色名>',
    ownerTitle: '你',      // 助手怎么称呼使用者
    selfClaim: '我',       // 助手怎么自称
    diaryTitle: '今日摘要', // diary show 的标题（想用自己的口吻就改这里）
  },
  preferences: {
    like: ['AI 工具与插件', '鬼畜与怀旧向剪辑', '猫咪', 'Live2D/模型'],
    dislike: ['带货', '擦边', '标题党', '纯搬运'],
  },
  notify: { type: 'none', url: '', template: 'text', cmd: '' },   // none | desktop | webhook | command（见 commands/notify.mjs）
  aliases: [],                  // 历史昵称（兜底用；当前昵称仍从 nav 动态读）
  // 使用者本人（分享型评论要 @ 的人）：mid 用于白名单/查询，name 用于正文里的 @昵称
  // （acc/info 查询会风控，所以 name 缓存一份；改过就用 thread 的 `@到:` 验一下）
  owner: { mid: '', name: '' },
  quota: { shareDaily: 3 },
  // 「标尺」（2026-10-18 加）：分享前必须打分，不到 share.minScore 就是"今天没有值得发的"（合法结果）
  share: { enabled: true, via: 'comment', minScore: 13, silentAfterDays: 3 },  // 分享型（@主人）开关与评分阈值
  // 倾听（2026-10-18 补默认值，与设置页对齐）：评论区 + 直播间
  listen: { comment: true, commentIntervalSec: 300, scope: 'both', oncePerPerson: false, allDay: false, dm: false, live: false, liveRoom: '', liveScope: 'owner' },
  // 作息：windows[] = 每天允许醒来的时段（每个窗口 = 一次机会）；maxWakesPerDay 缺省 = 窗口数（硬上限 3）
  night: { windows: [{ start: '20:00', end: '24:00', wakes: 1 }], skipChance: 0.3, minGapMin: 10, maxVideos: 5 },

  // ─────────────────────── 合并新增（2026-10-22）───────────────────────
  // 学习：周期性读一条「人类世界」的东西（视频字幕 / 官方总结），理解了再记见闻。
  //   —— 来自 dsh-bili-humanism 的核心能力，现在融进她每天的流程里。
  learning: {
    enabled: true,
    everyWake: true,           // 每次醒来先学习，再去看片（false = 只按 dailyNotes 攒够再学）
    dailyNotes: 2,             // 见闻条数/天（账本内硬性 ≤ 2，与 humanism 的日志上限一致）
    candidates: 3,             // 一次最多给几个候选
    maxChars: 16000,           // 单条原文上限（按字符切页，省 token）
    maxSessionTokens: 600000,  // 一个会话累计 token 闸门（humanism 的 maxSessionTokens）
    route: 'auto',             // auto | subtitle | conclusion | local
  },
  // 人格基质：从见闻里提炼一句「我看世界的方式」，注入每次唤醒的开头。
  //   humanism 的 human-world.md 就是它；这里控制"要不要写进唤醒提示"。
  personality: { enabled: true, inject: true, maxChars: 3000, pickPerDay: 1 },
  // 双日记：私人（本地 md，只有主人可读）+ 公开（B 站动态 / 视频下评论）。
  diary: {
    private: true,             // 私人日记（diary-private.md）
    public: false,             // 公开日记：**对外发布默认关**，开了才会真的发
    publicVia: 'dynamic',      // dynamic | comment
    push: true,                // 写完把「给他的信」推给主人（原 diary.push）
  },
  // 足迹：在世界上留下的痕迹（评论 @主人 / 动态），受 quota.shareDaily 约束。
  footprint: { mentionOwner: true, minChars: 2 },
  // 视频理解：分享前必须真读过原文（2026-10-22 的 understandLines()）。
  understand: { required: true, shareSummary: true, viaHumanism: true },
}

export const merge = (base, over) => {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? merge(base[k] ?? {}, v) : v
  }
  return out
}

/**
 * 读用户配置文件（不做合并、不缓存）。
 *
 * 这里解决 2026-10-22 实测到的两个"静默失效"陷阱：
 *   ① **UTF-8 BOM**：记事本 / PowerShell 5.1 存出来的 JSON 带 BOM，
 *      `JSON.parse` 直接抛错 → 以前整份配置静默作废，用户以为"改了没用" ✗
 *      → 现在先剥 BOM 再解析，并把 hadBom 报出来让设置页能提示。
 *   ② **语法错**：同样静默作废。现在返回 error 文本，设置页能显示"你的配置第几行错了"。
 *   ③ **旧文件名**：新文件不存在时自动读 bili-whale.config.json（从老插件升级过来的人
 *      不用手动搬配置），并把 migratedFrom 报出来。
 */
export function loadUser() {
  const candidates = [configPath]
  if (legacyConfigPath && legacyConfigPath !== configPath) candidates.push(legacyConfigPath)
  for (const p of candidates) {
    let text
    try { text = fs.readFileSync(p, 'utf8') } catch { continue }
    const hadBom = text.charCodeAt(0) === 0xfeff
    const body = hadBom ? text.slice(1) : text
    let obj
    try {
      obj = JSON.parse(body)
    } catch (e) {
      return { user: {}, path: p, hadBom, ok: false, error: String(e?.message ?? e).slice(0, 300), migratedFrom: p === configPath ? null : p }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { user: {}, path: p, hadBom, ok: false, error: '配置文件顶层必须是一个 JSON 对象 { ... }', migratedFrom: p === configPath ? null : p }
    }
    return { user: obj, path: p, hadBom, ok: true, error: null, migratedFrom: p === configPath ? null : p }
  }
  return { user: {}, path: configPath, hadBom: false, ok: false, error: null, migratedFrom: null }
}

let cache = null
/** 读取合并后的配置（带缓存）。 */
export function config() {
  if (cache) return cache
  const loaded = loadUser()
  cache = merge(DEFAULTS, loaded.user)
  cache.__hasUserFile = Object.keys(loaded.user).length > 0
  cache.__configPath = loaded.path
  cache.__configError = loaded.error
  cache.__hadBom = loaded.hadBom
  cache.__migratedFrom = loaded.migratedFrom
  return cache
}

/** 清掉缓存（保存配置后必须调，否则同进程读到旧值）。 */
export function resetConfig() { cache = null }

/** 配置体检：给设置页 / deps 用，把"为什么我的配置没生效"说清楚。 */
export function configStatus() {
  const c = config()
  return {
    // 会写到哪（新名）—— 设置页显示的应该是这个，不然用户会以为自己在改旧文件
    path: configPath,
    // 这次实际读到的是哪一份（从旧插件升级过来时是 bili-whale.config.json）
    readPath: c.__configPath,
    ok: c.__configError === null,
    error: c.__configError,
    hadBom: c.__hadBom,
    migratedFrom: c.__migratedFrom && c.__migratedFrom !== configPath ? c.__migratedFrom : null,
    hasUserFile: c.__hasUserFile,
  }
}

/** 写配置（深度合并到默认值后落盘）。宿主设置页与 CLI 共用这一份实现。 */
export function saveConfig(next) {
  const merged = merge(DEFAULTS, next)
  for (const k of Object.keys(merged)) if (k.startsWith('__')) delete merged[k]
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  // 无 BOM、2 空格缩进、行尾 \n —— 手工编辑也友好
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  resetConfig()
  return config()
}

// ─────────────── 合并新增的配置段落说明（给设置页 / README 复用） ───────────────
// learning.*     学习：醒来先读一条，读懂了记进见闻账本（≤2 条/天）
// personality.*  人格基质：从见闻里提炼一句，注入唤醒提示
// diary.*        双日记：私人（本地）与公开（B 站动态/评论）分开开关
// footprint.*    足迹：评论 @主人 / 发动态，受 quota.shareDaily 约束
// understand.*   理解：分享前必须先读原文（不是先看弹幕热度）
export { HOME, dshPath }
