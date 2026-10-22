/**
 * 夜间作息配置（合并后统一走 tools/lib/config.mjs）。
 *
 * 以前这里自己读 `$BILI_WHALE_CONFIG || bili-whale.config.json` 再用对象展开拼默认值，
 * 有两个坑：① 文件带 UTF-8 BOM 时整份 JSON.parse 失败、静默退回默认值 ✗
 * ② `whale-night.config.json` 这份历史上的二级文件与主配置可能给出互相矛盾的 windows ✗
 * 合并后只有一个来源：myilidepu.config.json 的 night 段（旧 bili-whale.config.json 自动兜底）。
 *
 * @param {string} [_dshHome] 保留参数只为不破坏调用点（路径解析已由 paths.mjs 统一）
 * @returns {{windows: Array<{start:string,end:string,wakes:number}>, skipChance:number, minGapMin:number, maxVideos:number}}
 */
import { config, resetConfig } from './config.mjs'

export function readNightConfig(_dshHome) {
  resetConfig()          // 改设置立刻生效：不吃进程内缓存
  const night = config().night
  return night && typeof night === 'object' ? night : {}
}