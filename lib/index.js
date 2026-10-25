/**
 * MyiliDepu「我的 B 站分身」—— 宿主侧插件（设置壳）
 *
 * 合并自两个项目（2026-10-22）：
 *   · dsh-bili-whale      —— 身体：生物钟 / 看片 / 分享 / @主人 / 双日记 / 设置页
 *   · dsh-bili-humanism   —— 灵魂：读原文 → 理解 → 记见闻 → 长人格 → 留下足迹
 *
 * 职责只有四件：
 *   1. 设置页：DSH 客户端 section「设置 → 我的分身」（lib/client.js，手写源码无需构建）
 *   2. 配置读写：GET/POST /dsh-bili/api/settings → $DSH_HOME/myilidepu.config.json
 *      （配置的**唯一来源**是 tools/lib/config.mjs，宿主不再自己抄一份 DEFAULTS）
 *   3. 依赖体检：GET /dsh-bili/api/deps → 跑 `node <tools>/bili.mjs deps --json`
 *   4. 心智状态：GET /dsh-bili/api/learn-status → 今日见闻 / 人格札记 / 最近读过的视频
 *
 * 凭据（cookie）**单独写**到 ~/.bili-ai/credentials.json，且**永远不回显**。
 * humanism 的阅读引擎也指向这同一份凭据（不搞两套登录态）。
 *
 * 所有路由都过一遍 connection.requestRejection 的信任栅栏：DSH 的 Web 端口是回环地址，
 * 但浏览器里任何一个网页都能向回环发请求 —— 不加栅栏等于把配置与账号凭据开放给任意页面。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startScheduler } from './scheduler.js'
import { resolveWorkDir } from './work-dir.js'
import { ensureWorkDocs } from './session-docs.js'
import { resolveNodeRuntime, nodeEnv } from './node-runtime.js'
import { HOME, DSH_HOME, configPath, credentialsPath, DATA_DIR as dataRoot, dataDirSource } from '../tools/lib/paths.mjs'
// 2026-10-22 合并：配置层统一到 tools/lib/config.mjs 一处。
//   以前宿主半边自己抄了一份 DEFAULTS（下面那段），加一个键要改两处 ——
//   已经因为漏改出过实实在在的 bug（diary 不在白名单里 → 设置页存不进去）。
//   现在：读走 config()（带缓存，saveConfig 会清缓存）、写走 saveConfig()、
//   体检走 configStatus()（能报出 BOM / 语法错 / 正在读旧版文件）。
import { config, saveConfig, configStatus, resetConfig, merge } from '../tools/lib/config.mjs'

/** 生物钟状态：{ ok, reason, at } —— 设置页/体检用它回答「时钟是不是活的」 */
let SCHED_STATUS = { ok: false, reason: "未初始化", at: null }



/**
 * execFile 的安全包装：NODE_EXE 解析失败时不让 execFile(null, …) 抛 TypeError，
 * 而是把原因通过回调交给调用方（设置页就能显示真因，而不是一个空 stdout）。
 */
function execNode(args, options, cb) {
  if (!NODE_EXE) {
    const msg = globalThis.__biliWhaleNodeError || '未找到可用的 node 运行时'
    cb?.(new Error(msg), '', msg)
    return null
  }
  return execFile(NODE_EXE, args, { ...options, env: { ...nodeEnv(DSH_HOME), ...options?.env } }, cb)
}


// 2026-10-19：真 node 路径（Electron 的 process.execPath 是 Harness.exe ✗ 跑不了 node 脚本）
const NODE_EXE = (() => {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  try {
    return resolveNodeRuntime(dshHome)
  } catch (e) {
    // 不静默回退：process.execPath 在桌面端是 Electron 主程序，跑不了脚本。
    // 这里只记录，具体失败由各调用点按自身语义报出（设置页体检会显示原因）。
    globalThis.__biliWhaleNodeError = String(e?.message ?? e)
    return null
  }
})()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CFG_FILE = configPath
const CRED_FILE = credentialsPath
// 2026-10-21 修 Issue #6：她的会话工作目录必须是**专用小目录**，不能用用户主目录 ✗
//   原因：DSH 的 Windows 沙箱会把会话 cwd 当"工作区"，主目录当工作区会让权限/完整性标签
//   影响到主目录下的其它程序（实测有人 DSH / VS Code 起不来）✗
//   放在 $DSH_HOME/myilidepu/work 里，范围最小，也不会碰任何别的东西 ✓
//   2026-10-22 合并：从 whale-work 迁到 myilidepu/work（数据目录统一在 $DSH_HOME/myilidepu 下）
//   2026-10-23 主人要求：数据目录可搬家（设置页「工具链 → 数据目录」/ $MYILIDEPU_DATA_DIR），
//     搬家后她的会话 cwd 也跟着变成 <新目录>/work —— DSH 的会话目录按 cwd 分桶，所以要重启 ✓
const DATA_DIR = dataRoot
const WORK_DIR = path.join(DATA_DIR, 'work')
const LOG_FILE = path.join(DATA_DIR, 'log.jsonl')
try { fs.mkdirSync(DATA_DIR, { recursive: true }) } catch {}


// ── 配置只有一个来源：tools/lib/config.mjs（2026-10-22 合并时统一）──────────────
//   以前宿主这边抄了一份 DEFAULTS，加一个键要改两处 → 因为漏改出过实实在在的 bug
//   （diary 不在 POST 白名单里 → 设置页「推送日记摘要」保存成功但值没变）。
//   现在 readConfig() 是薄包装，语义不变：返回「默认值 + 用户值」的合并结果，
//   另有 __hasUserFile / __configPath / __configError / __hadBom / __migratedFrom 五个内省字段。
const readConfig = () => config()
const writeConfig = (next) => saveConfig(next)

/** 发给前端的配置必须去掉 __ 开头的内省字段（那些单独走 health 字段）。 */
function publicConfig(cfg) {
  const out = {}
  for (const [k, v] of Object.entries(cfg)) if (!k.startsWith('__')) out[k] = v
  return out
}

/** 工具链里 bili.mjs 的位置：① 设置里的 toolsPath ② 插件自带的 tools/ */
function resolveBiliMjs() {
  const cfg = readConfig()
  // 2026-10-18：去掉"作者机器"回退 ✗（换机器就是静默失效）→ 只有两个候选：设置里的 toolsPath / 插件自带 tools/ ✓
  return cfg.toolsPath || path.join(HERE, '..', 'tools', 'bili.mjs')
}

/** 只回"能不能用"，不回显任何凭据内容 */
function credState() {
  try {
    const c = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'))
    return { present: true, hasSess: !!c.sessdata, hasJct: !!c.bili_jct, hasBuvid: !!c.buvid3 }
  } catch { return { present: false, hasSess: false, hasJct: false, hasBuvid: false } }
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export default {
  name: 'dsh-myilidepu',
  // ⚠️ 2026-10-18 踩的坑：这里以前**写了两个 inject 键** ✗ —— 对象字面量后者覆盖前者 →
  //   `sessionController` 没被注入 → 生物钟每 60 秒静默 `return`（不报错、也不干活 ✗）
  //   一个数组写全 ✓
  inject: ['sessionController', 'webServer', 'connection'],
  apply(ctx) {

/** 写操作只认本机回环（2026-10-17 加，Kimi 评审指出）：DSH 的 Web 端口万一绑到 0.0.0.0，
 *  局域网里任何人都能改 cookie / 换主人 mid —— 那样"@分享"就全 @ 给攻击者了。
 *  这一层是兜底：host 不是回环就直接 403。 */
function isLoopbackReq(req) {
  const host = String(req.headers?.host ?? '').toLowerCase()
  const h = host.split(':')[0]
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1'
}

    // P1-1（Kimi 评审 #8）：这条路以前是 fail-open —— connection 缺失/抛错就**放行** ✗
    // 安全组件的默认值必须是"关"：栅栏不可用 → 拒绝（写操作尤其），只对静态页面留一条活路。
    function rejected(req, res, { strict = true } = {}) {
      if (isLoopbackReq(req) === false) {
        // 连 Host 都不是回环 → 一律拒（防"服务绑到 0.0.0.0"那种情况）
        json(res, 403, { ok: false, error: '只接受本机回环访问' })
        return true
      }
      try {
        const conn = ctx.get('connection') || ctx.connection
        if (!conn || typeof conn.requestRejection !== 'function') {
          if (!rejected.warned) {
            rejected.warned = true
            console.warn('[myilidepu] 信任栅栏不可用：connection 服务缺失 → 按 fail-closed 处理')
          }
          if (strict) { json(res, 503, { ok: false, error: '信任栅栏不可用，拒绝访问（fail-closed）' }); return true }
          return false
        }
        const code = conn.requestRejection(req)
        if (code === undefined || code === null || code === false) return false
        res.statusCode = typeof code === 'number' ? code : 403
        res.end()
        return true
      } catch (e) {
        if (strict) { json(res, 503, { ok: false, error: '信任栅栏异常，拒绝访问（fail-closed）' }); return true }
        return false
      }
    }

    const disposers = []
    function route(kind, pathname, handler) {
      const guarded = async (req, res) => {
        if (rejected(req, res)) return
        try { await handler(req, res) } catch (err) {
          try { json(res, 500, { ok: false, error: String(err?.message ?? err) }) } catch {}
        }
      }
      disposers.push(ctx.webServer.register({ kind, path: pathname, handler: guarded }))
      // 2026-10-22 合并改名：接口路径正式迁到 /dsh-myilidepu/api/*。
      //   老路径 /dsh-bili/api/* 保留为**别名** —— 设置页前端 / 用户自己写的脚本 /
      //   书签里可能还留着它，直接 404 会让人以为"插件坏了" ✗
      if (pathname.includes('/dsh-bili/')) {
        const alias = pathname.replace('/dsh-bili/', '/dsh-myilidepu/')
        disposers.push(ctx.webServer.register({ kind, path: alias, handler: guarded }))
      }
    }

    // 旧的独立设置页已下线（2026-10-18）：DSH 的信任栅栏不认插件路径，这个页面在浏览器里永远 403 ✗
    // 设置页唯一的入口是「设置 → 我的分身」（lib/client.js）。旧的 lib/settings.html 已删除（2026-10-22）✓
    // 需要本地直开时：把该文件拷到桌面双击（它的 API 调用会被栅栏拒，只作静态预览 ✓）

    // 写设置：浅合并，但**只接受已知的顶层字段** ✓（2026-10-18 加白名单，兑现这句注释 ✗ 原来是什么都收）
    // P0-2（Kimi 评审 #2）：读和写**合成一个 handler**（原来同一路径注册两次，
    //   宿主若是"首个匹配即终止"，后注册的 POST 永远收不到请求 ✗）
    route('exact', '/dsh-bili/api/settings', async (req, res) => {
      if (req.method === 'GET') {
        const health = configStatus()
        json(res, 200, {
          ok: true,
          config: publicConfig(readConfig()),
          credentials: credState(),
          configPath: health.path,
          // 2026-10-22 加：把「配置到底有没有被读到」明确告诉前端。
          //   以前配置文件带 BOM / 有语法错时整份静默作废，用户只看到"我改了没用" ✗
          //   health = { path, ok, error, hadBom, migratedFrom, hasUserFile }
          health,
          paths: { dataDir: DATA_DIR, workDir: WORK_DIR, tools: resolveBiliMjs(), dataDirSource: dataDirSource() },
        })
        return
      }
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const body = JSON.parse(await readBody(req) || '{}')
      const cur = readConfig()
      delete cur.__hasUserFile
      // ⚠️ 2026-10-18 修的 bug：客户端发的是**配置本身**，这里却只认 `body.config` ✗
      //   → merge(cur, {}) = 什么都没改 → "保存成功"但值没变（主人实测就是这个 ✗）
      //   现在两种都收：{ config: {...} } 或直接 {...}
      const incoming = (body && typeof body.config === 'object' && body.config) || body || {}
      // 顶层白名单：只合并认识的键（防止被塞任意字段 ✓）
      // 2026-10-21 修（审查 #4）：原来白名单漏了 diary ✗ → 设置页「推送日记摘要」存不进去
      const KNOWN = new Set(['persona', 'preferences', 'notify', 'aliases', 'owner', 'self', 'quota', 'share', 'listen', 'diary', 'night', 'toolsPath', 'home',
        // 2026-10-22 合并新增：学习 / 人格 / 足迹 / 视频理解
        'learning', 'personality', 'footprint', 'understand',
        // 2026-10-22 新增：模型与密钥（密钥只存引用名，值走 DSH 凭据库 ✓）
        'model'])
      const filtered = {}
      for (const [k, v] of Object.entries(incoming)) if (KNOWN.has(k)) filtered[k] = v
      const next = merge(cur, filtered)
      // 基本的范围校验（别让设置页把东西写成负数/离谱值）
      const n = next.night
      if (!Array.isArray(n.windows) || !n.windows.length) { json(res, 400, { ok: false, error: '至少要有一个作息窗口' }); return }
      n.maxWakesPerDay = Math.min(12, Math.max(0, Number(n.maxWakesPerDay ?? 0) || 0))   // 12 = 与 whale-night 的上限一致 ✓
      n.skipChance = Math.min(0.95, Math.max(0, Number(n.skipChance) || 0))
      n.minGapMin = Number.isFinite(Number(n.minGapMin)) ? Math.max(1, Number(n.minGapMin)) : 10
      n.maxVideos = Math.min(20, Math.max(1, Number(n.maxVideos) || 5))
      // P0-3（Kimi 评审 #3）：Number(0) || 3 === 3 → 用户取消勾选"分享"会被强行改回 3 ✗
      const sd = Number(next.quota.shareDaily)
      next.quota.shareDaily = Number.isFinite(sd) ? Math.min(20, Math.max(0, sd)) : 3
      next.share.minScore = Math.min(20, Math.max(0, Number(next.share.minScore) || 0))

      // ── 合并新增的四组配置做范围校验 ──────────────────────────────────────
      // 设置页给的是开关/滑块，但 API 可以被直接调用 —— 边界必须在后端再收一遍。
      const L = next.learning
      // 2026-10-25：取消「见闻 ≤2 条/天」的硬上限 —— 现在这个键**就是额度本身**：
      //   > 0 = 每天最多几条；0 = 不限。缺省（没填/填了非数字）仍退回 2 条。
      //   和 personality.pickPerDay 同一个坑：`|| 2` 会把 0 吃成 2，必须用 Number.isFinite 判。
      const notes = Math.floor(Number(L.dailyNotes))
      L.dailyNotes = Number.isFinite(notes) ? Math.min(99, Math.max(0, notes)) : 2
      L.recordNotes = L.recordNotes !== false   // false = 只读不记（原来靠 dailyNotes=0 表达）
      L.candidates = Math.min(3, Math.max(1, Math.floor(Number(L.candidates) || 3)))
      L.maxChars = Math.min(200_000, Math.max(500, Math.floor(Number(L.maxChars) || 16_000)))
      L.maxSessionTokens = Math.min(10_000_000, Math.max(50_000, Math.floor(Number(L.maxSessionTokens) || 600_000)))
      if (!['auto', 'subtitle', 'conclusion', 'local'].includes(L.route)) L.route = 'auto'
      if (L.dailyNotes > 0 && !L.enabled) L.enabled = true   // 给了条数就说明想学，别留一个自相矛盾的配置
      const P = next.personality
      P.maxChars = Math.min(20_000, Math.max(200, Math.floor(Number(P.maxChars) || 3000)))
      // 2026-10-23：默认改成 0 = **不限条数**（原来是 1 天 1 条，且这个键其实从没被代码读过 ✗）。
      //   注意 `|| 1` 会把 0 吃成 1，必须用 Number.isFinite 判，否则"不限"存不进去。
      const picks = Math.floor(Number(P.pickPerDay))
      P.pickPerDay = Number.isFinite(picks) ? Math.min(20, Math.max(0, picks)) : 0
      const D = next.diary
      if (!['dynamic', 'comment'].includes(D.publicVia)) D.publicVia = 'dynamic'
      // 私人日记是"她自己的东西"，永远不强制关闭；公开日记默认关，这里不替用户打开 ✓
      D.private = D.private !== false
      const F = next.footprint
      F.minChars = Math.min(200, Math.max(1, Math.floor(Number(F.minChars) || 2)))
      // 模型：设置页「保存」走的是这个通用接口 → 模型那组也从这里过一遍校验 ✓
      //   （缺字段/空值能兜住；provider/model 是否真的存在由 /model 路由问 llm 服务验）
      try { next.model = normalizeModel(next.model || {}, readConfig().model) } catch (e) {
        json(res, 400, { ok: false, error: String(e?.message ?? e) })
        return
      }

      writeConfig(next)
      const saved = readConfig()
      // 改完立刻生效 ✓（主人 2026-10-18 要求）：清掉旧计划，让生物钟按新配置重算
      const schedulingChanged = ['windows', 'skipChance', 'maxVideos', 'minGapMin'].some(key => JSON.stringify(cur.night?.[key]) !== JSON.stringify(next.night?.[key]))
      try { sched?.invalidate(schedulingChanged) } catch {}
      const warns = []
      if (next.quota.shareDaily > 3) warns.push('分享条数 >3：看起来会像刷量，平台可能限流/封号')
      if (next.diary.public) warns.push('公开日记已开启：她会真的在 B 站公开发，建议先跑一次 --dry 看效果')
      if (next.diary.public && !next.diary.private) warns.push('公开开着、私人关着：她会对外说很多，对自己什么都不留')
      json(res, 200, { ok: true, config: publicConfig(saved), warn: warns.length ? warns.join('；') : null })
    })

    // 写凭据（只写不读回）
    route('exact', '/dsh-bili/api/cookie', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      // 2026-10-21：自动清洗 —— 用户最常见的三种粘错方式都在这里兜住 ✓
      //   ① 带 "SESSDATA=" 前缀  ② 粘了整条 cookie  ③ 带了引号/分号/换行
      const pick = (raw, key) => {
        let v = String(raw ?? '').trim()
        // 整条 cookie 里抠出这个键
        const m = v.match(new RegExp('(?:^|;)\\s*' + key + '=([^;]+)', 'i'))
        if (m) return m[1].trim()
        // 单个 "key=value" 形式
        v = v.replace(new RegExp('^' + key + '\\s*=', 'i'), '')
        // 去引号 / 尾部分号
        v = v.replace(/^["'\s]+|["';\s]+$/g, '')
        return v
      }
      const sessdata = pick(b.sessdata, 'SESSDATA')
      const bili_jct = pick(b.bili_jct, 'bili_jct')
      const buvid3 = pick(b.buvid3, 'buvid3')
      // 逐字段体检（把"哪里不对"说清楚，而不是一句"写入失败" ✗）
      const problems = []
      if (!sessdata) problems.push('SESSDATA 空着（它是 HttpOnly，document.cookie 读不到 ✗ 必须 F12 → Application → Cookies 手动复制）')
      else if (sessdata.length < 20) problems.push('SESSDATA 太短（长度 ' + sessdata.length + '）—— 大概只复制到一半')
      if (!bili_jct) problems.push('bili_jct 空着')
      else if (!/^[0-9a-fA-F]{32}$/.test(bili_jct)) problems.push('bili_jct 格式不对（长度 ' + bili_jct.length + '，B站 目前是 32 位十六进制）—— 可能复制截断，或粘到了别的字段')
      // 2026-10-22 修（主人实测撞上）：buvid3 的真实格式是
      //   `0BE6296B-F60E-ABAF-24FD-2D4F1619E79785121infoc` —— 结尾带 infoc ✗
      //   原来只允许十六进制+横线 → 合法值被判错 → 连带整次保存都失败 ✗
      //   而且 buvid3 本身是可选的：格式可疑只该【提醒】，不该拦住写入 ✓
      // 真实形状：0BE6296B-F60E-ABAF-24FD-2D4F1619E79785121infoc
      //   = 8 位 + 横线 + 至少 20 位字母数字/横线（结尾常是 infoc）
      //   放太松（{16,}）连随便 16 位字符都会放过去 ✗ 收紧到「有横线 + 够长」✓
      const buvid3LooksOdd = buvid3 && !/^[0-9A-Za-z]{6,}-[0-9A-Za-z-]{18,}$/.test(buvid3)
      if (problems.length) {
        json(res, 400, {
          ok: false,
          error: '凭据有问题，没写入：\n  · ' + problems.join('\n  · ') +
            '\n\n正确做法：浏览器打开 bilibili.com → F12 → Application（应用）→ Cookies → https://www.bilibili.com' +
            '\n逐个双击 Value 复制（SESSDATA 和 bili_jct 两个都要）✓ 别用 document.cookie ✗',
        })
        return
      }
      fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true })
      fs.writeFileSync(CRED_FILE, JSON.stringify({ sessdata, bili_jct, buvid3 }, null, 2) + '\n')
      try { fs.chmodSync(CRED_FILE, 0o600) } catch {}
      // 2026-10-19：写完 cookie 立刻问一次 nav，把 self 刷成新号 ✓
      let whoNow = null
      let navCode = null
      let navMsg = ''
      let navErr = null
      try {
        const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', {
          headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/', cookie: `SESSDATA=${sessdata}; bili_jct=${bili_jct}; buvid3=${buvid3}` },
        })
        const navJson = await navRes.json().catch(() => ({}))
        navCode = navJson?.code ?? null
        navMsg = String(navJson?.message ?? '')
        if (navJson?.data?.isLogin && navJson.data.mid) {
          whoNow = { mid: String(navJson.data.mid), name: String(navJson.data.uname ?? '') }
          const cur = readConfig()
          writeConfig({ ...cur, self: whoNow })
        }
      } catch (e) { navErr = String(e?.message ?? e).slice(0, 120) }
      // 2026-10-21：nav 失败要说清"为什么" —— 只写"没确认成功"用户不知道该改什么 ✗
      json(res, 200, {
        ok: true,
        warn: buvid3LooksOdd ? '⚠️ buvid3 格式有点怪（不影响使用，想要的话重新复制一次）' : null,
        detail: whoNow
          ? `已写入 ✓ 当前登录：${whoNow.name}（mid ${whoNow.mid}）`
          : '已写入，但 B站 不认这个 cookie ✗'
            + (navCode != null ? `（nav 返回 code=${navCode}${navMsg ? ' ' + navMsg : ''}）` : '')
            + (navErr ? `（请求失败：${navErr}）` : '')
            + ' —— 最常见两个原因：\n  · SESSDATA 复制时截断了（它很长，双击 Value 全选再复制）\n  · 复制自别的浏览器 / 无痕窗口，已经失效\n  重新打开 bilibili.com 复制一次【SESSDATA 和 bili_jct 两个都重抄】✓',
        self: whoNow,
      })
    })

    // ── 模型与密钥（2026-10-22 主人要的「能够选择模型和 sk 密钥」）──────────────────
    //   两个能力都是 DSH **原生**的，插件只做接线和界面，不自己发请求、不自己存密钥：
    //     ① 换模型：`ctx.sessionController.selectModel({ sessionId, provider, model, reasoningEffort })`
    //        —— 会话级、热生效、**只影响她自己那个会话**，不动 profile 的全局默认 ✓
    //     ② 写 SK：`ctx.credentials.set(ref, value)` / `unset(ref)` / `describe(ref)`
    //        —— 值进 DSH 自己的凭据库（~/.dsh/.credentials.yaml），写后**永不回显** ✓
    //   为什么密钥值不落插件配置：配置文件常被拷来拷去 / 截图 / 塞进聊天记录，
    //   密钥一旦写进去就洗不干净（本文件到处是注释，用户还会发到 issue 里）✗
    //   所以配置里只存「引用名」（环境变量名，如 TENCENT_API_KEY），值在凭据库里 ✓
    const SESSION_ID = 'myilidepu'
    const CRED_REF_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
    const EFFORTS = ['off', 'low', 'medium', 'high', 'max']
    /** 拿可选服务：宿主版本不同，缺服务时应该"某项灰掉"而不是整页 500 ✓ */
    function svc(name) { try { return ctx.get(name) || ctx[name] } catch { return null } }
    /** provider id → 猜测的凭据引用名（tencent → TENCENT_API_KEY）—— 只是输入框默认值，可改 ✓ */
    function guessRef(providerId) {
      const s = String(providerId || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      return s ? s + '_API_KEY' : ''
    }
    async function modelCatalog() {
      const llm = svc('llm')
      const out = { providers: [], error: null }
      if (!llm || typeof llm.listProviders !== 'function') {
        out.error = 'llm 服务不可用（这个 DSH 版本没有暴露模型目录）'
        return out
      }
      let providers = []
      try { providers = llm.listProviders() || [] } catch (e) { out.error = String(e?.message ?? e).slice(0, 200); return out }
      for (const p of providers) {
        const id = String(p?.id ?? p?.provider ?? '')
        if (!id) continue
        const row = { id, name: String(p?.name ?? id), models: [] }
        try {
          const models = await llm.listModels(id)
          row.models = (models || []).map((m) => ({ id: String(m.id), name: String(m.name ?? m.id) }))
        } catch (e) { row.error = String(e?.message ?? e).slice(0, 160) }
        out.providers.push(row)
      }
      return out
    }
    /** 这个模型支持哪些推理档（拿不到就返回空：前端只显示"默认" ✓） */
    async function effortChoices(provider, model) {
      const llm = svc('llm')
      if (!llm || typeof llm.resolveModelInfo !== 'function' || !provider || !model) return []
      try {
        const info = await llm.resolveModelInfo(provider, model)
        return (info?.reasoning?.efforts ?? []).map((e) => ({ id: String(e.id), name: String(e.name ?? e.id) }))
      } catch { return [] }
    }
    /** 只看"配没配"，绝不取值（值只在用户自己写入的那一刻经过内存）✓ */
    async function keyState(ref) {
      if (!ref) return null
      const cred = svc('credentials')
      if (!cred || typeof cred.describe !== 'function') return { ref, configured: false, error: 'credentials 服务不可用' }
      try {
        const d = await cred.describe(ref)
        return { ref, configured: d?.configured === true, source: d?.source ?? null, writable: d?.writable !== false }
      } catch (e) { return { ref, configured: false, error: String(e?.message ?? e).slice(0, 160) } }
    }
    function applyModelNow(m) {
      const sc = svc('sessionController')
      if (!sc) return Promise.resolve({ applied: false, error: 'sessionController 服务不可用' })
      if (typeof sc.selectModel !== 'function') return Promise.resolve({ applied: false, error: '这个 DSH 版本不支持会话级换模型' })
      if (!m || !m.provider || !m.model) return Promise.resolve({ applied: false, error: '还没选 provider / model' })
      return Promise.resolve(sc.selectModel({
        sessionId: SESSION_ID,
        provider: String(m.provider),
        model: String(m.model),
        ...(m.reasoningEffort ? { reasoningEffort: String(m.reasoningEffort) } : {}),
      })).then((r) => ({ applied: true, selection: r ?? null }))
        .catch((e) => ({ applied: false, error: String(e?.message ?? e).slice(0, 300) }))
    }
    function normalizeModel(input, base) {
      const m = { ...(base || {}) }
      const s = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
      if ('enabled' in input) m.enabled = input.enabled !== false
      if ('applyOnWake' in input) m.applyOnWake = input.applyOnWake !== false
      if ('provider' in input) m.provider = s(input.provider, 64)
      if ('model' in input) m.model = s(input.model, 128)
      if ('reasoningEffort' in input) {
        const e = s(input.reasoningEffort, 16)
        m.reasoningEffort = EFFORTS.includes(e) ? e : ''
      }
      if ('apiKeyEnv' in input) {
        const r = s(input.apiKeyEnv, 64)
        if (r && !CRED_REF_RE.test(r)) throw new Error('密钥引用名只能是字母/数字/下划线，且不能以数字开头（例如 TENCENT_API_KEY）')
        m.apiKeyEnv = r
      }
      if (m.enabled && (!m.provider || !m.model)) throw new Error('选了「用指定模型」就必须给出 provider 和 model')
      return m
    }

    route('exact', '/dsh-bili/api/model', async (req, res) => {
      if (req.method === 'GET') {
        const cur = readConfig().model || {}
        // 设置页换 provider/model 时要**立刻**知道这个模型支持哪些推理档，
        //   所以允许用 ?provider=&model= 查询（没传就查当前已保存的组合 ✓）
        let qp = ''
        let qm = ''
        try {
          const u = new URL(String(req.url || '/'), 'http://localhost')
          qp = String(u.searchParams.get('provider') || '')
          qm = String(u.searchParams.get('model') || '')
        } catch {}
        const catalog = await modelCatalog()
        const suggested = []
        for (const p of catalog.providers) { const g = guessRef(p.id); if (g && !suggested.includes(g)) suggested.push(g) }
        json(res, 200, {
          ok: true,
          model: cur,
          providers: catalog.providers,
          catalogError: catalog.error,
          efforts: await effortChoices(qp || cur.provider, qm || cur.model),
          suggestedRefs: suggested,
          key: await keyState(cur.apiKeyEnv),
          services: { llm: !!svc('llm'), credentials: !!svc('credentials'), sessionController: !!svc('sessionController') },
          sessionId: SESSION_ID,
        })
        return
      }
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const body = JSON.parse(await readBody(req) || '{}')
      const incoming = (body && typeof body.model === 'object' && body.model) || (body && typeof body.config === 'object' && body.config) || body || {}
      let next
      try {
        next = normalizeModel(incoming, readConfig().model)
      } catch (e) { json(res, 400, { ok: false, error: String(e?.message ?? e) }); return }
      const cur = readConfig()
      writeConfig({ ...cur, model: next })
      const saved = readConfig().model
      // 先验一下这个组合在宿主里真的存在（不然 selectModel 会在下一次唤醒时才炸，用户看不到原因 ✗）
      let applied = null
      if (body.apply === true) applied = await applyModelNow(saved)
      else if (saved.enabled) applied = await applyModelNow(saved)   // 存了就顺手应用：省一次点击 ✓
      json(res, 200, {
        ok: true,
        model: saved,
        applied: applied?.applied ?? null,
        applyError: applied?.error ?? null,
        key: await keyState(saved.apiKeyEnv),
        efforts: await effortChoices(saved.provider, saved.model),
      })
    })

    // 写 / 删 SK：值只在这里过一手，写完只回"配没配" ✓（与 B 站 cookie 同一套哲学）
    route('exact', '/dsh-bili/api/model/key', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const ref = String(b.ref ?? '').trim()
      if (!ref) { json(res, 400, { ok: false, error: '缺 ref（凭据引用名，例如 TENCENT_API_KEY）' }); return }
      if (!CRED_REF_RE.test(ref)) { json(res, 400, { ok: false, error: '引用名格式不对：只能字母/数字/下划线，且不能以数字开头' }); return }
      const cred = svc('credentials')
      if (!cred) { json(res, 503, { ok: false, error: 'credentials 服务不可用，这个 DSH 版本写不了密钥' }); return }
      const value = typeof b.value === 'string' ? b.value.trim() : ''
      const action = String(b.action ?? '').trim()
      try {
        let detail
        if (action === 'unset' || value === '') {
          if (typeof cred.unset !== 'function') throw new Error('这个 DSH 版本不支持删除凭据')
          await cred.unset(ref)
          detail = `已删除 ${ref}`
        } else {
          if (typeof cred.set !== 'function') throw new Error('这个 DSH 版本不支持写入凭据')
          if (value.length > 4096) throw new Error('密钥太长了（>4096）')
          await cred.set(ref, value)
          detail = `已写入 ${ref}（不会回显；下一次调用模型时生效）`
        }
        // 顺手把它记进配置（只记名字），这样下次打开设置页还知道该看哪个 ref ✓
        const cur = readConfig()
        writeConfig({ ...cur, model: { ...(cur.model || {}), apiKeyEnv: action === 'unset' ? '' : ref } })
        try { sched?.invalidate?.(false) } catch {}
        json(res, 200, { ok: true, detail, key: await keyState(ref) })
      } catch (e) {
        json(res, 400, { ok: false, error: String(e?.message ?? e).slice(0, 300) })
      }
    })

    // ── 她专属的人设（2026-10-21 主人要的）：只影响她，不影响别的会话 ✓ ──────────
    //   存在 ~/.bili-ai/persona.md → 换机器时连 .bili-ai 一起拷就带着走 ✓
    const PERSONA_FILE = path.join(HOME, '.bili-ai', 'persona.md')
    route('exact', '/dsh-bili/api/persona', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method === 'GET') {
        let text = ''
        try { text = fs.readFileSync(PERSONA_FILE, 'utf8') } catch {}
        let updatedAt = null
        try { updatedAt = fs.statSync(PERSONA_FILE).mtime.toISOString() } catch {}
        json(res, 200, { ok: true, text, bytes: Buffer.byteLength(text, 'utf8'), updatedAt })
        return
      }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const text = String(b.text ?? '')
      if (text.length > 20000) { json(res, 400, { ok: false, error: '太长（上限 20000 字），人设不用写论文 ✗' }); return }
      try {
        fs.mkdirSync(path.dirname(PERSONA_FILE), { recursive: true })
        fs.writeFileSync(PERSONA_FILE, text, 'utf8')
        try { fs.chmodSync(PERSONA_FILE, 0o600) } catch {}
      } catch (e) { json(res, 500, { ok: false, error: '写入失败：' + String(e?.message ?? e).slice(0, 120) }); return }
      const bytes = Buffer.byteLength(text, 'utf8')
      json(res, 200, {
        ok: true,
        bytes,
        detail: text.trim()
          ? '✓ 已注入（' + bytes + ' 字节）—— 从下一次唤醒开始生效 ✓'
          : '✓ 已清空 —— 她回到只有「设置里的人设」那几行 ✓',
      })
    })

    // 依赖体检：跑 bili.mjs deps --json
    route('exact', '/dsh-bili/api/deps', async (req, res) => {
      const cfg = readConfig()
      // 工具位置（2026-10-18 收敛为两个候选 ✗ 去掉"作者机器"路径）：
      //   ① 设置里的 toolsPath  ② <插件根>/tools/bili.mjs（发布版自带 ✓）
      const tools = cfg.toolsPath || path.join(HERE, "..", "tools", "bili.mjs")
      if (!fs.existsSync(tools)) {
        json(res, 200, { ok: false, error: `找不到 bili.mjs：${tools}（在设置里填「工具目录」）`, items: [], scheduler: SCHED_STATUS })
        return
      }
      execNode([tools, 'deps', '--json'], { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
        try {
          const parsed = JSON.parse(String(stdout || '{}'))
          // 2026-10-19：顺手把"她自己是谁"从 cookie 体检里抠出来写回配置 ✓
          //   以前 self.mid / self.name 只有默认值、没人写 → 设置页永远空 ✗
          let selfNow = null
          try {
            const ck = (parsed.items ?? []).find((it) => it.name === 'B站 cookie')
            const m = String(ck?.detail ?? '').match(/已登录：(.+?)（mid (\d+)）/)
            if (m) {
              selfNow = { name: m[1], mid: m[2] }
              const cur = readConfig()
              if (String(cur.self?.mid ?? '') !== selfNow.mid || String(cur.self?.name ?? '') !== selfNow.name) writeConfig({ ...cur, self: selfNow })
            }
          } catch {}
          // 2026-10-20：把"跑没跑过启动测试"一起返回 —— 设置页用它决定要不要显示首次安装横幅
          let selftestPassed = false
          try {
            selftestPassed = fs.existsSync(path.join(HOME, ".bili-ai", "selftest-passed.json"))
          } catch {}
          json(res, 200, { ok: !!parsed.ok, items: parsed.items ?? [], node: parsed.node, self: selfNow, selftestPassed, scheduler: SCHED_STATUS })
        } catch {
          json(res, 200, { ok: false, error: String(stderr || err?.message || 'deps 跑失败').slice(0, 300), items: [] })
        }
      })
    })

    // ── 关注名单同步（2026-10-25 主人要求：改成设置页里的一个按钮）────────────────
    //   以前它挂在生物钟上、每次醒来跑一次 → 一天 288 轮 × 2 个请求把本机打进 412，
    //   而它的 412 会熔断全机，让她一整天发不出消息 ✗
    //   现在请求数由主人的手指决定：点一下 = 跑一次 `follows sync --go` ✓
    //   仍然只读关注列表、只写本地配置（不点关注、不取关 —— 关注是她账号上的状态，主人自己做）
    route('exact', '/dsh-bili/api/follows/sync', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      let b = {}
      try { b = JSON.parse(await readBody(req) || '{}') } catch {}
      const args = [resolveBiliMjs(), 'follows', 'sync', '--go', '--json']
      if (Array.isArray(b.topics) && b.topics.length) args.push('--topics', b.topics.join(','))
      execNode(args, { timeout: 90_000, windowsHide: true }, (err, stdout, stderr) => {
        let r = null
        try { r = JSON.parse(String(stdout ?? '').trim()) } catch {}
        if (!r) {
          json(res, 200, { ok: false, error: String(stderr || err?.message || '同步没返回结果').slice(0, 300) })
          return
        }
        if (!r.ok) {
          const hint = r.code === 'NO_LOGIN' ? '她的账号好像没登录了 —— 去「账号与登录」重新存一次 cookie'
            : (r.apiCode ? '多半是风控（' + r.apiCode + '）—— 过几分钟再点，别连着刷' : '')
          json(res, 200, { ok: false, code: r.code, apiCode: r.apiCode, error: r.message || '同步失败', hint })
          return
        }
        // 便条：她下次醒来时会看到一句话（scheduler 读一次就清掉 ✓）
        try {
          if (Array.isArray(r.added) && r.added.length) {
            fs.writeFileSync(path.join(DATA_DIR, 'follows-note.json'),
              JSON.stringify({ at: new Date().toISOString(), added: r.added.map((x) => ({ name: x.name, mid: x.mid })) }, null, 2), 'utf8')
          }
        } catch {}
        try {
          fs.appendFileSync(LOG_FILE, JSON.stringify({
            at: new Date().toISOString(), kind: 'follows-sync', target: null,
            note: (r.added ?? []).length
              ? `主人点了「同步关注」：新增 ${r.added.map((x) => x.name || x.mid).join('、')}`
              : `主人点了「同步关注」：她关注 ${r.total} 位，没有新关注`,
          }) + '\n')
        } catch {}
        json(res, 200, {
          ok: true, total: r.total, added: r.added ?? [], skipped: r.skipped ?? [],
          removed: r.removed ?? [], wroteConfig: !!r.wroteConfig, watchups: r.watchups ?? [],
        })
      })
    })

    // ── 待审回复（2026-10-18 主人选 B 档：**发前审核**）──────────────────────────
    //   她的回复先进 pending-replies.json → 主人在「设置 → 我的分身 → 待审核」里点发才发 ✓
    const PENDING = path.join(HOME, '.bili-ai', 'pending-replies.json')
    route('exact', '/dsh-bili/api/pending', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      let items = []
      try { items = JSON.parse(fs.readFileSync(PENDING, 'utf8')).items ?? [] } catch {}
      json(res, 200, { ok: true, items })
    })
    route('exact', '/dsh-bili/api/pending/reject', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const id = String(b.id ?? '')
      if (!id) { json(res, 400, { ok: false, error: '需要 id' }); return }
      execNode([resolveBiliMjs(), 'reply-draft', 'drop', id], { timeout: 20000, windowsHide: true }, (err, stdout) => {
        // 否掉也是一种反馈 → 记事件流（她下次能学到"这种不要" ✓）
        // ⚠️ 只有真的删掉了才记 ✗ —— 以前连点几次会重复记三条（2026-10-18 修 ✓）
        if (!err) {
          try {
            fs.appendFileSync(LOG_FILE,
              JSON.stringify({ at: new Date().toISOString(), kind: 'reply-rejected', target: null, note: `主人否掉了草稿 ${id}${b.reason ? '：' + String(b.reason).slice(0, 80) : ''}` }) + '\n')
          } catch {}
        }
        json(res, 200, { ok: !err, out: String(stdout ?? '').slice(0, 300) })
      })
    })
    route('exact', '/dsh-bili/api/pending/approve', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const b = JSON.parse(await readBody(req) || '{}')
      const id = String(b.id ?? '')
      if (!id) { json(res, 400, { ok: false, error: '需要 id' }); return }
      const bili = resolveBiliMjs()
      // 2026-10-21 修（审查 P1-2）：下面回调里用了 cfg.listen，但本作用域【没有 cfg】✗
      //   → ReferenceError，而草稿已被 take 掉 → 静默丢失 ✗
      let cfgNow = {}
      try { cfgNow = readConfig() } catch {}
      // ① 从队列取出（取不到 = 已经发过/删过 ✓）
      execNode([bili, 'reply-draft', 'take', id], { timeout: 20000, windowsHide: true }, (err, stdout) => {
        let item = null
        try { item = JSON.parse(String(stdout ?? '')) } catch {}
        if (!item) { json(res, 400, { ok: false, error: '队列里没有这条（可能已经发过）' }); return }
        // ② 真发（--auto → 自动报备 ✓；--once-per-person → 判重 ✓）
        const args = ['comment', '--oid', item.oid, '--root', item.root, '--parent', item.parent,
          '--message', item.message, '--auto', ...(cfgNow.listen?.oncePerPerson !== false ? ['--once-per-person'] : []), '--go']
        if (item.bvid) args.push('--bvid', item.bvid)
        execNode([bili, ...args], { timeout: 120000, windowsHide: true }, (e2, out2, err2) => {
          const text = String(out2 ?? '')
          const ok = !e2 && /code=0/.test(text)
          const rpid = (text.match(/rpid=(\d+)/) ?? [])[1] ?? null
          try {
            fs.appendFileSync(LOG_FILE,
              JSON.stringify({ at: new Date().toISOString(), kind: ok ? 'reply-sent' : 'reply-failed', target: item.who || item.parent, note: `${ok ? '主人批准并发出' : '发送失败'} · ${String(item.message).slice(0, 60)}` }) + '\n')
          } catch {}
          // 2026-10-21：发送失败 → 草稿放回队列，别悄悄丢掉 ✗
          if (!ok) {
            try {
              const back = ['reply-draft', 'add', '--oid', item.oid, '--message', item.message]
              if (item.bvid) back.push('--bvid', item.bvid)
              if (item.root) back.push('--root', item.root)
              if (item.parent) back.push('--parent', item.parent)
              if (item.who) back.push('--who', item.who)
              if (item.src) back.push('--src', item.src)
              execNode([bili, ...back], { timeout: 20000, windowsHide: true }, () => {})
              console.error('[pending/approve] 发送失败，草稿已放回队列：' + id)
            } catch (e) { console.error('[pending/approve] 放回草稿也失败：' + e.message) }
          }
          json(res, 200, { ok, rpid, out: text.slice(-600), err: String(err2 ?? '').slice(0, 400) })
        })
      })
    })

    // 「发条测试」：真的跑一次 notify.mjs --test，把结果原样返回（配错了当场能看见 ✓）
    // 2026-10-18 主人要求：必须有这个按钮，不然配错了不知道 ✗
    route('exact', '/dsh-bili/api/notify-test', async (req, res) => {
      if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return }
      if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
      const cfg = readConfig()
      const tools = cfg.toolsPath || path.join(HERE, "..", "tools", "bili.mjs")
      const notifyMjs = path.join(path.dirname(tools), 'commands', 'notify.mjs')
      if (!fs.existsSync(notifyMjs)) { json(res, 200, { ok: false, error: `找不到 notify.mjs：${notifyMjs}` }); return }
      execNode([notifyMjs, '--test'], { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
        json(res, 200, {
          ok: !err,
          out: String(stdout ?? '').slice(0, 800),
          err: String(stderr ?? '').slice(0, 800),
          type: cfg.notify?.type ?? 'none',
        })
      })
    })

    // 状态（只读）：今天分享了几条 / 今天的作息计划 / 判重账本里记了几个人
    route('exact', '/dsh-bili/api/status', async (req, res) => {
      const localHome = HOME
      const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
      const quota = readJson(path.join(localHome, '.bili-ai', 'quota.json')) ?? { log: [] }
      const today = new Date().toLocaleDateString('sv-SE')
      const todays = (quota.log ?? []).filter((x) => new Date(x.at).toLocaleDateString('sv-SE') === today)
      const night = readJson(path.join(DSH_HOME, 'whale-night.json'))
      const replied = readJson(path.join(localHome, '.bili-ai', 'replied.json'))
      json(res, 200, {
        ok: true, today,
        shares: todays.filter((x) => x.share).length,
        sharesMax: readConfig().quota?.shareDaily ?? 3,
        commentsToday: todays.length,
        repliedPeople: Object.keys(replied?.byUid ?? {}).length,
        plan: night ? { date: night.date, action: night.action, atText: night.atText ?? null, wakes: Number(night.wakes ?? 0), windows: night.usedWindows ?? [] } : null,
      })
    })

    // 心智状态（只读）：今日见闻 / 人格札记 / 双日记开关。
    //   设置页里只看到一排开关，用户没法知道"它今天到底学了没有" ✗
    //   → 这里把账本里的真实状态读出来（走 CLI 的 --json，和 agent 看到的是同一份数据）
    route('exact', '/dsh-bili/api/learn-status', async (req, res) => {
      const cfg = readConfig()
      const tools = resolveBiliMjs()
      const runCli = (argv, timeout) => new Promise((resolve) => {
        if (!NODE_EXE) { resolve({ ok: false, error: globalThis.__biliWhaleNodeError || '未找到可用的 node 运行时' }); return }
        execNode([tools, ...argv, '--json'], { timeout: timeout ?? 15_000, windowsHide: true }, (err, stdout, stderr) => {
          if (err) { resolve({ ok: false, error: String(err.message ?? err).slice(0, 300), stderr: String(stderr ?? '').slice(0, 300) }); return }
          const text = String(stdout ?? '').trim()
          try { resolve({ ok: true, data: JSON.parse(text || 'null') }) } catch {
            resolve({ ok: false, error: 'CLI 输出不是 JSON：' + text.slice(0, 200) })
          }
        })
      })
      const [journal, personality] = await Promise.all([
        runCli(['journal', 'show']),
        runCli(['personality', 'show']),
      ])
      json(res, 200, {
        ok: true,
        learning: {
          enabled: cfg.learning.enabled,
          everyWake: cfg.learning.everyWake,
          dailyNotes: cfg.learning.dailyNotes,
          route: cfg.learning.route,
        },
        personality: { enabled: cfg.personality.enabled, inject: cfg.personality.inject, ...personality },
        journal,
        diary: { private: cfg.diary.private, public: cfg.diary.public, publicVia: cfg.diary.publicVia },
        understand: cfg.understand,
      })
    })

    // ── 自主生物钟（2026-10-18）：插件自己 tick，到点自己叫醒她（不靠对话框 ✓）────────
    let sched = null
    // 2026-10-21 修（Issue #8-3）：时钟起不来时以前只 console.warn ✗
    //   用户在设置页看不出「它永远不会醒」→ 现在把状态记下来，/deps 带出去 ✓
    // 2026-10-22 合并：先把会话手册投进她的 cwd（唤醒提示里引用了 AGENTS.md）
    let herWorkDir = WORK_DIR
    try {
      herWorkDir = resolveWorkDir(readConfig().home, WORK_DIR)
      ensureWorkDocs(herWorkDir, { log: (m) => { try { console.log(m) } catch {} } })
    } catch (e) {
      try { console.warn('[myilidepu] 会话手册投放失败：' + e.message) } catch {}
    }
    try {
      sched = startScheduler(ctx, {
        dshHome: DSH_HOME,
        biliMjs: resolveBiliMjs(),
        cwd: herWorkDir,
        sessionId: 'myilidepu',
        log: (m) => { try { console.log(m) } catch {} },
      })
      SCHED_STATUS = { ok: true, reason: '已启动（每 60 秒 tick）', at: new Date().toISOString() }
    } catch (e) {
      SCHED_STATUS = { ok: false, reason: String(e?.message ?? e).slice(0, 300), at: new Date().toISOString() }
      try { console.warn('[myilidepu] 生物钟启动失败：' + e.message) } catch {}
    }

    ctx.effect(() => () => {
      try { sched?.stop() } catch {}
      for (const d of disposers) { try { d() } catch {} }
    })

    try {
      console.log(`[myilidepu] 设置页已挂载：/dsh-myilidepu/ · 配置 ${configStatus().path} · 数据 ${DATA_DIR}`)
    } catch {}
  },
}
