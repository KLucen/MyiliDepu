/**
 * 统一的路径解析（DSH home、用户主目录、**插件数据根目录**）。
 *
 * 为什么需要它：插件宿主半边（lib/index.js）用的是
 *   process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
 * 而工具链（tools/ 下的脚本）此前各自硬编码 path.join(HOME, '.dsh')，
 * **完全不读 DSH_HOME**。两边的 home 语义一旦不一致就会分叉：
 *
 *   · DSH_HOME 被自定义（多个 profile 根、便携安装、CI）时，
 *     宿主把配置写进 $DSH_HOME/bili-whale.config.json，
 *     工具链却去 $HOME/.dsh/ 读 → 读不到（或读到另一份），
 *     生物钟、日记、日志、配置全部错位。
 *
 * 因此所有 tools/ 脚本都应从这里取路径，别再本地拼 '.dsh'。
 *
 * 注意保留旧行为：USERPROFILE 优先于 HOME，`BILI_WHALE_CONFIG` 仍可覆盖配置文件位置。
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

/** 用户主目录（Windows 优先 USERPROFILE，保持与原实现一致）。 */
export const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir() || '.'

/** DSH home：与宿主半边 (lib/index.js) 完全一致的解析顺序。 */
export const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')

/** 拼一个位于 DSH home 下的路径。 */
export const dshPath = (...parts) => path.join(DSH_HOME, ...parts)

/**
 * 插件配置文件（合并后改名 myilidepu.config.json）。
 *
 * 查找顺序（2026-10-22 合并两个插件时定）：
 *   ① $MYILIDEPU_CONFIG（新名，显式指定）
 *   ② $BILI_WHALE_CONFIG（旧名，保留兼容 —— 老用户的启动脚本/快捷方式里可能有它）
 *   ③ $DSH_HOME/myilidepu.config.json（新默认位置）
 *   ④ $DSH_HOME/bili-whale.config.json（**迁移兜底**：新文件不存在时仍然读旧文件，
 *      这样从 bili-whale 升级过来的用户不用手动搬配置。见 config.mjs 的 loadUser()）
 */
export const configPath =
  process.env.MYILIDEPU_CONFIG ||
  process.env.BILI_WHALE_CONFIG ||
  dshPath('myilidepu.config.json')

/** 旧版配置文件位置（只用于迁移兜底，永远不写入）。 */
export const legacyConfigPath = dshPath('bili-whale.config.json')

/**
 * 数据目录的三种来源（2026-10-23 新增：支持把她的"整个生活"搬到别的盘）。
 *
 * 为什么要可配置：默认数据（两本日记 / 见闻账本 / 抽帧 / 读过的原文 / 会话工作区）
 * 都堆在 C:\Users\<你>\.dsh\myilidepu 下，占 C 盘空间。现在可以整体搬到
 * 例如 D:\MyDepu；**代码里所有数据路径都从 DATA_DIR 派生**，不需要改第二处。
 *
 * 解析优先级：
 *   ① $MYILIDEPU_DATA_DIR（环境变量；多实例/CI/便携场景用，优先级最高）
 *   ② 配置文件里的 `paths.dataDir`（设置页「工具链 → 数据目录」写的那一格）
 *   ③ 默认 `$DSH_HOME/myilidepu`
 *
 * 为什么在这里直接读配置文件、而不是 import config.mjs：
 *   config.mjs 反过来要 import 本文件（configPath / dshPath / HOME），
 *   直接 import 会形成循环依赖，而 ESM 的顶层 const 在循环里会拿到 undefined。
 *   这里只做一次 readFileSync + JSON.parse（几 KB），开销可忽略。
 */
function dataDirFromConfig() {
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const body = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw   // 剥 BOM（记事本/PowerShell 5.1 存的配置带 BOM）
    const v = JSON.parse(body)?.paths?.dataDir
    return typeof v === 'string' && v.trim() ? v.trim() : ''
  } catch { return '' }
}

/** 解析数据根目录（便于测试；不创建目录）。 */
export function resolveDataDir() {
  const env = String(process.env.MYILIDEPU_DATA_DIR ?? '').trim()
  if (env) return path.resolve(env)
  const cfg = dataDirFromConfig()
  if (cfg) return path.resolve(cfg)
  return dshPath('myilidepu')
}

/** 数据目录来源：env | config | default（设置页/日志里显示，排查"为什么还写在 C 盘"）。 */
export function dataDirSource() {
  if (String(process.env.MYILIDEPU_DATA_DIR ?? '').trim()) return 'env'
  if (dataDirFromConfig()) return 'config'
  return 'default'
}

/**
 * 插件数据根目录：日记、账本、读过的原文、抽帧、夜间/监听状态、她的会话工作区都在这里。
 * 默认 `$DSH_HOME/myilidepu/`，可用 `paths.dataDir` / `$MYILIDEPU_DATA_DIR` 搬走。
 */
export const DATA_DIR = resolveDataDir()

/** 拼一个位于插件数据目录下的路径。 */
export const dataPath = (...parts) => path.join(DATA_DIR, ...parts)

/** 拼一个位于用户主目录下的路径（.bili-ai 等凭据/状态目录用）。 */
export const homePath = (...parts) => path.join(HOME, ...parts)

/** Credentials are per OS user, independent of DSH_HOME（凭据不跟着数据目录走 ✓）。 */
export const credentialsPath = homePath('.bili-ai', 'credentials.json')
