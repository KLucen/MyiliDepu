/**
 * 会话手册投放：把 `prompts/AGENTS.md` 复制到她的会话工作目录（**只在缺失时**）。
 *
 * 为什么需要这一步：
 *   `lib/scheduler.js` 里唤醒提示写的是「按 AGENTS.md 的『看的那晚』流程走一遍」，
 *   但插件从来没有把这份 AGENTS.md 送到她面前 —— 以前全靠使用者自己往
 *   `~/.dsh/AGENTS.md` 手写一遍（那一份还会污染所有其它会话 ✗）。
 *   合并版把手册放进**她自己的会话 cwd**：DSH 只在那一个会话里加载它，
 *   身份与作用域就分开了（CHANGELOG 2026-10-21 那条的思路，现在真正落实）。
 *
 * 三条纪律：
 *   ① 只在文件**不存在**时写 —— 那是她的工作记忆，使用者也可能手改过，绝不覆盖。
 *   ② 写不进去不致命：这条链路失败只影响"她知不知道规矩"，不该挡住整个插件装载。
 *   ③ 模板随包发布（`package.json` 的 `files` 要包含 `prompts/`）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 模板位置：<插件根>/prompts/AGENTS.md */
export const TEMPLATE_AGENTS = path.join(HERE, '..', 'prompts', 'AGENTS.md')

/**
 * 确保 workDir 里有一份 AGENTS.md。
 * @param {string} workDir 她那个会话的工作目录（绝对路径）
 * @param {{log?: (m: string) => void}} [opts]
 * @returns {{wrote:boolean, path:string, error?:string}}
 */
export function ensureWorkDocs(workDir, opts = {}) {
  const log = opts.log || (() => {})
  const target = path.join(workDir, 'AGENTS.md')
  try {
    if (fs.existsSync(target)) return { wrote: false, path: target }
    if (!fs.existsSync(TEMPLATE_AGENTS)) {
      log(`[myilidepu] 手册模板缺失（${TEMPLATE_AGENTS}）→ 跳过投放`)
      return { wrote: false, path: target, error: 'template-missing' }
    }
    fs.mkdirSync(workDir, { recursive: true })
    fs.copyFileSync(TEMPLATE_AGENTS, target)
    log(`[myilidepu] 已投放会话手册：${target}`)
    return { wrote: true, path: target }
  } catch (e) {
    const error = String(e?.message ?? e)
    log(`[myilidepu] 手册投放失败（不影响运行）：${error}`)
    return { wrote: false, path: target, error }
  }
}
