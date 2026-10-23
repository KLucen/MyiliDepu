// bili frames —— 「让她看一眼画面」（2026-10-23，P3 抽帧·轻量版）
//
// 为什么单独一条命令（而不是只用 debrief 的抽帧）：
//   ① debrief 是「分享」那条腿的：它要先整片下载（几十 MB～GB）。学习/回想的时候
//      只想看一眼画面，不该付这个代价 —— 这条走直链 seek，不下载整片。
//   ② prompts/AGENTS.md 早就写了「抽帧看画面……或 `read` 的 `visual`」，
//      但合并版里那个 `visual` 一直没落地（humanism 的 Python 抽帧被裁掉了）。
//      这条命令就是把那句承诺兑现，且是 ffmpeg 实现，不引入 Python。
//
// 用法:
//   node frames.mjs <BV|URL> [--n 9] [--grid 3x3] [--at 12,45,90] [--out <目录>] [--json]
//
// 产出: 目录里若干 fNN.jpg + 一张 sheet-CxR.jpg；终端打印 SHEET: / FRAMES:
//       交给 agent 用 read_image 看（脚本只备素材，不作判断）
import fs from 'node:fs'
import { loadCred } from '../lib/cred.mjs'
import { requireFfmpeg } from '../lib/ffmpeg.mjs'
import { fmtClock, gridForN, visualForBv } from '../lib/visual.mjs'

const argv = process.argv.slice(2)
const opt = {}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  const a = String(argv[i])
  if (a.startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || String(v).startsWith('--')) opt[a.slice(2)] = true
    else { opt[a.slice(2)] = v; i += 1 }
  } else positional.push(a)
}

const usage = () => {
  console.error('用法: node frames.mjs <BV|URL> [--n 9] [--grid 3x3] [--at 12,45,90] [--out <目录>] [--json]')
  process.exit(2)
}
const input = positional[0]
if (!input) usage()

const m = /(BV[0-9A-Za-z]{10})/.exec(input)
if (!m) { console.error(`看不懂这个输入（要 BV 号或视频链接）：${input}`); usage() }
const bvid = m[1]

let ffmpeg
try { ffmpeg = requireFfmpeg() } catch (e) { console.error(String(e.message)); process.exit(2) }

let cred
try { cred = loadCred() } catch (e) { console.error(`读不到凭据：${String(e.message)}`); process.exit(3) }

const at = typeof opt.at === 'string' ? opt.at.split(',').map((s) => s.trim()).filter(Boolean) : undefined
const n = Number(opt.n) || undefined
// 只给 --n 没给 --grid 时自动挑格子（4 帧 → 2x2），免得九宫格里一大片黑格
const grid = typeof opt.grid === 'string' ? opt.grid : gridForN(n ?? 9)
const buffered = []

const out = await visualForBv({
  bvid,
  n,
  at,
  grid,
  outDir: typeof opt.out === 'string' ? opt.out : undefined,
  cred,
  ffmpeg,
  log: (line) => buffered.push(line),
})

if (!out.ok) {
  if (opt.json) console.log(JSON.stringify({ ok: false, code: out.code, message: out.message, outDir: out.outDir ?? null }, null, 2))
  else {
    console.error(`${out.code}: ${out.message}`)
    if (out.code === 'NO_PLAYURL') console.error('（这条可能只有 dash 流或要登录；也可以先用 debrief 看它能不能整片下载）')
  }
  process.exit(out.code === 'INVALID_GRID' || out.code === 'INVALID_TIME' ? 2 : out.code === 'NO_FRAMES' ? 4 : 3)
}

if (opt.json) {
  console.log(JSON.stringify({
    ok: true,
    bvid: out.bvid,
    title: out.title,
    duration: out.duration,
    quality: out.quality,
    grid: `${out.cols}x${out.rows}`,
    sheet: out.sheet,
    sheetBytes: out.sheetBytes,
    frames: out.frames.map((f) => ({ at: f.at, atText: f.atText, path: f.path, bytes: f.bytes })),
    failed: out.failed,
    elapsedMs: out.elapsedMs,
    outDir: out.outDir,
  }, null, 2))
  process.exit(0)
}

console.log(`标题: ${out.title ?? bvid}   时长: ${fmtClock(out.duration)}   画质: ${out.quality}`)
console.log(`抽帧: ${out.cols}x${out.rows} 共 ${out.frames.length} 帧，用时 ${(out.elapsedMs / 1000).toFixed(1)}s（不下载整片：直链 seek）`)
buffered.forEach((line) => console.log(line))
if (out.failed.length) console.log(`（有 ${out.failed.length} 个时间点没抽到，已跳过）`)
console.log(`\nSHEET: ${out.sheet}`)
out.frames.forEach((f) => console.log(`FRAMES: ${f.atText}  ${f.path}`))
console.log('\n用 read_image 看 SHEET（一张图看完这一条的画面走向）；要看某一秒的细节就看对应的 FRAMES。')
console.log('（脚本只备素材，不作判断 —— 结论要你自己写，看不清就说看不清 ✗）')
if (fs.existsSync(out.outDir)) console.log(`（原图都在: ${out.outDir}）`)
