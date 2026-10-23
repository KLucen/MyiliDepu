// 主人的图片库：他自己往 `D:\MyDepu\pics` 里丢图，她想配图时**按名字**选一张 ✓
//
// 2026-10-23 主人要求（m05172）：「我在 D:\MyDepu\pics 中加了几张照片（后面可能还会放更多照片），
//   我希望她在 at 我的时候如果能够用上这些图片，可以选张图片发出来。」
//
// 设计边界（诚实）：
//   · **动态**能带图：`x/dynamic/feed/draw/upload_bfs` → `create/dyn` 的 `pics[]` ✓
//   · **评论/回复**也能带图（2026-10-23 更正 ✓）：**同一个上传接口**，
//     然后在 `/x/v2/reply/add` 的表单里多带一个 `pictures` 字段
//     （JSON 数组，每项 {img_src,img_width,img_height,img_size}）✓
//     —— 依据是两份独立实现：`seiuna/bilibili-api` 的 `CommentArea.add()` 与
//        `pa-jesusf/Ibili` 的 `interaction.rs`（都是 upload_bfs → reply/add + pictures）。
//        上一版这里写「评论只能纯文本 ✗」是**错的**，2026-10-23 主人指出来才查实。
//   · 这里只做「按名字找到文件 + 认类型 + 读尺寸 + 上传」，发帖仍归各命令（不重复实现 ✗）
import fs from 'node:fs'
import path from 'node:path'
import { dataPath } from './paths.mjs'

export const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
/** B 站上传接口真的收的三种（webp 不收，要在这一层就说清楚，别等它报错 ✗） */
export const UPLOAD_KINDS = ['png', 'jpg', 'gif']

export function picsDir() { return dataPath('pics') }

export function extOf(file) { return path.extname(String(file ?? '')).toLowerCase() }

/** 按文件头判断真实类型（不信扩展名：主人可能把 webp 直接改名成 .jpg ✗） */
export function kindOf(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  const head6 = buf.toString('latin1', 0, 6)
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif'
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}

/** 读宽高（只为打印给人看；读不出来返回 null，不当成错误 ✗） */
export function dimsOf(buf, kind = kindOf(buf)) {
  if (!Buffer.isBuffer(buf)) return null
  try {
    if (kind === 'png' && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    if (kind === 'gif' && buf.length >= 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    if (kind === 'jpg') {
      let i = 2
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i += 1; continue }
        const marker = buf[i + 1]
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
        }
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue }
        const len = buf.readUInt16BE(i + 2)
        if (len < 2) break
        i += 2 + len
      }
      return null
    }
    if (kind === 'webp' && buf.length >= 30) {
      const fourcc = buf.toString('latin1', 12, 16)
      if (fourcc === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
      if (fourcc === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      if (fourcc === 'VP8L') {
        const bits = buf.readUInt32LE(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
      }
    }
  } catch { /* 脏图不致命，返回 null ✓ */ }
  return null
}

/** 列出图库里所有**真的能识别的**图（非图片/坏文件直接跳过，不抛 ✗） */
export function listPics(dir = picsDir()) {
  let names = []
  try { names = fs.readdirSync(dir) } catch { return [] }
  const out = []
  for (const file of names.slice().sort()) {
    if (file.startsWith('.')) continue
    const ext = extOf(file)
    if (!IMAGE_EXT.includes(ext)) continue
    const full = path.join(dir, file)
    let st = null
    try { st = fs.statSync(full) } catch { continue }
    if (!st.isFile()) continue
    let buf = null
    try { buf = fs.readFileSync(full) } catch { continue }
    const kind = kindOf(buf)
    if (!kind) continue
    const dims = dimsOf(buf, kind)
    out.push({
      name: path.basename(file, ext), file, path: full, bytes: st.size, kind,
      width: dims?.width ?? null, height: dims?.height ?? null,
      uploadable: UPLOAD_KINDS.includes(kind),
    })
  }
  return out
}

/**
 * 把「名字」解析成绝对路径。
 *   resolvePic('happy')            → <pics>\happy.jpg
 *   resolvePic('happy.png')        → 同上（带扩展名也认 ✓）
 *   resolvePic('D:\\x\\y.jpg')     → 原样（绝对路径直接认，方便临时用一张不在库里的图 ✓）
 * 找不到时**报错并列出可用的名字**（她一眼就知道该改成什么，不用猜 ✗）
 */
export function resolvePic(ref, dir = picsDir()) {
  const raw = String(ref ?? '').trim()
  if (!raw) throw new Error('没给图片名（用 `pics list` 看有哪些）')
  const cands = []
  if (path.isAbsolute(raw)) cands.push(raw)
  else {
    cands.push(path.join(dir, raw))
    if (!extOf(raw)) for (const e of IMAGE_EXT) cands.push(path.join(dir, raw + e))
  }
  for (const c of cands) {
    try { if (fs.statSync(c).isFile()) return c } catch { /* 继续试下一个 */ }
  }
  const avail = listPics(dir).map((x) => x.name)
  throw new Error(`图片库里没有「${raw}」`
    + (avail.length ? `；可用的有：${avail.join('、')}` : `（${dir} 是空的，让主人往里放图）`))
}

/** 一行一张，给她/主人看 ✓ */
export function describePics(list, dir = picsDir()) {
  if (!list.length) return [`（${dir} 里还没有图片 —— 让主人丢几张进去）`]
  const lines = [`可用图片 ${list.length} 张（${dir}）：`]
  const pad = Math.max(...list.map((x) => x.name.length))
  for (const x of list) {
    const dim = x.width && x.height ? `${x.width}x${x.height}` : '尺寸?'
    const kb = `${Math.round(x.bytes / 1024)} KB`
    lines.push(`  ${x.name.padEnd(pad)}  ${x.kind.padEnd(4)} ${dim.padEnd(11)} ${kb}${x.uploadable ? '' : '  ⚠️ 不能上传（B 站只收 png/jpg/gif，转一下）'}`)
  }
  return lines
}

// ── 上传（2026-10-23：动态与评论**共用**这一个）───────────────────────────────
// 注意：**上传本身就是写操作** —— 调用方必须先过限额闸，再调这里（见 dynamic-image.mjs 的注释）
export const UPLOAD_BFS = 'https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs'
export const MIME_OF = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif' }

/**
 * 把一张图传到 B 站，返回接口原样的四个字段（+ 本地信息便于打印）。
 * 失败一律 throw（附上接口原话），不静默返回半成品 ✗
 */
export async function uploadPic(file, { cred, cookie, ua, referer = 'https://www.bilibili.com/', fetchImpl = fetch } = {}) {
  let buf = null
  try { buf = fs.readFileSync(file) } catch (e) { throw new Error(`读不了这张图：${e.message}`) }
  const kind = kindOf(buf)
  if (!kind) throw new Error(`「${path.basename(file)}」不是图片（认不出文件头）`)
  if (!UPLOAD_KINDS.includes(kind)) throw new Error(`B 站不收 ${kind}（只收 png/jpg/gif）—— 换一张，或先转格式`)
  const dims = dimsOf(buf, kind)
  const fd = new FormData()
  fd.append('file_up', new Blob([buf], { type: MIME_OF[kind] }), `upload.${kind}`)
  fd.append('category', 'daily')
  fd.append('csrf', String(cred?.bili_jct ?? ''))
  const res = await fetchImpl(UPLOAD_BFS, {
    method: 'POST',
    headers: { 'user-agent': ua, referer, cookie },
    body: fd,
  })
  let json = null
  try { json = await res.json() } catch { throw new Error(`上传接口返回的不是 JSON（HTTP ${res.status}）`) }
  if (json.code !== 0) {
    throw new Error(`上传失败 code=${json.code} ${json.message ?? ''} ${JSON.stringify(json).slice(0, 200)}`)
  }
  const d = json.data ?? {}
  if (!d.image_url) throw new Error(`上传成功但没拿到 image_url：${JSON.stringify(d).slice(0, 200)}`)
  return {
    img_src: d.image_url,
    img_width: d.image_width ?? dims?.width ?? null,
    img_height: d.image_height ?? dims?.height ?? null,
    img_size: d.img_size ?? null,
    kind, file, bytes: buf.length,
  }
}

/** 评论接口只认这四个字段（多余的别塞，免得被风控盯上 ✗） */
export function replyPicture(up) {
  return {
    img_src: up.img_src,
    img_width: up.img_width,
    img_height: up.img_height,
    img_size: up.img_size,
  }
}
