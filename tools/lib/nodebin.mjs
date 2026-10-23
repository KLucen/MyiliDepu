import { DSH_HOME } from './paths.mjs'
import { resolveRuntime } from './runtime.mjs'
const runtime = resolveRuntime(DSH_HOME, { allowCurrent: true })
export const NODE_EXE = runtime.file
export const NODE_ENV = runtime.env
// 'node' = 真 node；'electron' = 拿桌面版主程序靠 ELECTRON_RUN_AS_NODE=1 顶着（能跑，但更慢更吃内存）
export const NODE_KIND = runtime.kind
// Also propagate to existing callers which inherit the tool process environment.
if (runtime.env.ELECTRON_RUN_AS_NODE === '1') process.env.ELECTRON_RUN_AS_NODE = '1'
// 2026-10-23 修：以前是 `(p = NODE_EXE) => p === NODE_EXE` —— 自己等于自己，永远 true，
//   于是 deps 里「node 运行时」那一项等于**从没查过** ✗。真正要回答的是：
//   跑脚本的这个东西是真 node，还是拿桌面版主程序顶的（后者慢，且是常见坑）。
export const isRealNode = () => NODE_KIND === 'node'
