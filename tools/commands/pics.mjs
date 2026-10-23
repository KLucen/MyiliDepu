// 看她手上有什么图可用（主人放在 D:\MyDepu\pics 里的照片）
//
//   node bili.mjs pics                列出全部（名字 / 类型 / 尺寸 / 大小）
//   node bili.mjs pics list --json    同上，机器可读
//   node bili.mjs pics path <名字>    只打印绝对路径（给别的命令用 / 自己拼命令用）
//
// 2026-10-23 主人要求（m05172）：「我希望她在 at 我的时候如果能够用上这些图片，可以选张图片发出来」
//   · 发图走动态：`node bili.mjs dynamic-image --pic <名字> --text "…" --at <主人uid> --at-name 主人 --go`
//   · **评论 / 回复也能带图**（2026-10-23 更正）：`node bili.mjs comment … --pic <名字>`
//     —— 之前这里写「评论塞不进图 ✗」是**错的**，别再照那句做 ✗
import { listPics, resolvePic, describePics, picsDir, UPLOAD_KINDS } from '../lib/pics.mjs'

const argv = process.argv.slice(2)
const pos = argv.filter((a) => !a.startsWith('--'))
const cmd = pos[0] ?? 'list'

if (cmd === 'list' || cmd === '') {
  const items = listPics()
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ dir: picsDir(), items }, null, 2)); process.exit(0) }
  for (const line of describePics(items)) console.log(line)
  console.log('')
  if (items.length) {
    const usable = items.filter((x) => x.uploadable).map((x) => x.name)
    console.log(`发图 · 动态：node bili.mjs dynamic-image --pic ${usable[0] ?? '<名字>'} --text "…" --at <主人uid> --at-name 主人 --go`)
    console.log(`发图 · 评论/回复：node bili.mjs comment --oid <aid> --message "…" --pic ${usable[0] ?? '<名字>'} --go`)
  } else {
    console.log(`把图片放进 ${picsDir()} 就行（png / jpg / gif / webp 都认，只是 webp 上传前要转成 ${UPLOAD_KINDS.join('/')}）`)
  }
  process.exit(0)
}

if (cmd === 'path') {
  const name = pos[1]
  if (!name) { console.error('用法: node bili.mjs pics path <名字>'); process.exit(2) }
  try { console.log(resolvePic(name)) } catch (e) { console.error('✗ ' + e.message); process.exit(3) }
  process.exit(0)
}

console.error(`未知子命令：${cmd}\n用法: node bili.mjs pics [list] [--json] | pics path <名字>`)
process.exit(2)
