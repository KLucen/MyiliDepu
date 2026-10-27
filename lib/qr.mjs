/**
 * 二维码生成（QR Code，Model 2）—— 自包含实现，**零依赖**。
 *
 * 为什么自己写：插件要能在任何装了 DSH 的机器上直接跑起来。
 * 为了「把一段 URL 画成二维码」引一个 npm 包，就得跟着它升级、审计、进 lockfile ✗
 * 而这件事的规范是死的（ISO/IEC 18004），实现一次就够 ✓
 *
 * 覆盖范围：**版本 1–10**（21×21 … 57×57 模块）、纠错等级 L/M/Q/H、字节模式（UTF-8）。
 * 超出范围会明确报错（B站 扫码登录链接 ~131 字符，等级 M 只需版本 8 = 49×49）✓
 *
 * 结构参考 Project Nayuki 的 qrcodegen（MIT）——同一套算法，逐段可对照。
 */

/** 纠错等级 → 格式信息里的 2 bit（注意不是 0/1/2/3 顺序：L=1, M=0, Q=3, H=2） */
const EC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 }

/**
 * 版本 → 纠错等级 → [每块纠错码字数, 块数]
 * 这两个数足以推出全部分块结构：总码字数由规范公式算出，其余按长块/短块规则分配 ✓
 */
const ECC = {
  1: { L: [7, 1], M: [10, 1], Q: [13, 1], H: [17, 1] },
  2: { L: [10, 1], M: [16, 1], Q: [22, 1], H: [28, 1] },
  3: { L: [15, 1], M: [26, 1], Q: [18, 2], H: [22, 2] },
  4: { L: [20, 1], M: [18, 2], Q: [26, 2], H: [16, 4] },
  5: { L: [26, 1], M: [24, 2], Q: [18, 4], H: [22, 4] },
  6: { L: [18, 2], M: [16, 4], Q: [24, 4], H: [28, 4] },
  7: { L: [20, 2], M: [18, 4], Q: [18, 6], H: [26, 5] },
  8: { L: [24, 2], M: [22, 4], Q: [22, 6], H: [26, 6] },
  9: { L: [30, 2], M: [22, 5], Q: [20, 8], H: [24, 8] },
  10: { L: [18, 4], M: [26, 5], Q: [24, 8], H: [28, 8] },
}

const MIN_VERSION = 1
const MAX_VERSION = 10

/** 版本 → 一行/一列的模块数 */
function sizeOf(version) {
  return version * 4 + 17
}

/** 版本 → 数据+纠错的总码字数（规范公式，免查大表） */
function rawCodewordsOf(version) {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (version >= 7) result -= 36
  }
  return Math.floor(result / 8)
}

/** 版本+等级 → { total, data, ecPerBlock, blocks } */
function blockInfoOf(version, ec) {
  const [ecPerBlock, blocks] = ECC[version][ec]
  const total = rawCodewordsOf(version)
  return { total, data: total - ecPerBlock * blocks, ecPerBlock, blocks }
}

/** 版本 → 对齐图案中心坐标（规范给的行列值，两轴相同） */
function alignmentPositionsOf(version) {
  if (version === 1) return []
  const numAlign = Math.floor(version / 7) + 2
  const step = Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2
  const result = [6]
  for (let pos = sizeOf(version) - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}

// ── GF(256) 上的 Reed-Solomon ──────────────────────────────────────────────────
const GF_PRIMITIVE = 0x11d

function gfMul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * GF_PRIMITIVE)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

/** 生成多项式 (x - r^0)(x - r^1)...(x - r^(deg-1)) 的系数（除首项） */
function rsDivisor(degree) {
  const result = new Uint8Array(degree)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

/** 数据码字 → 纠错码字（多项式取余） */
function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length)
  for (const b of data) {
    const factor = b ^ result[0]
    result.copyWithin(0, 1)
    result[result.length - 1] = 0
    for (let i = 0; i < result.length; i++) result[i] ^= gfMul(divisor[i], factor)
  }
  return result
}

// ── 位缓冲 ────────────────────────────────────────────────────────────────────
class BitBuffer {
  constructor() { this.bits = [] }
  push(value, len) {
    for (let i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1)
  }
  get length() { return this.bits.length }
  toBytes() {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8))
    this.bits.forEach((b, i) => { if (b) out[i >>> 3] |= 0x80 >>> (i & 7) })
    return out
  }
}

function utf8Bytes(text) {
  return new TextEncoder().encode(String(text))
}

/** 字符计数指示符的位数：版本 1–9 是 8 位，10–26 是 16 位（字节模式） */
function charCountBits(version) {
  return version <= 9 ? 8 : 16
}

/** 自动挑版本：第一个装得下的（同等内容，版本越大格子越密） */
function pickVersion(byteLen, ec) {
  for (let v = MIN_VERSION; v <= MAX_VERSION; v++) {
    const { data } = blockInfoOf(v, ec)
    const needBits = 4 + charCountBits(v) + byteLen * 8
    if (needBits <= data * 8) return v
  }
  const maxBytes = Math.floor((blockInfoOf(MAX_VERSION, ec).data * 8 - 20) / 8)
  throw new RangeError(
    `内容太长：${byteLen} 字节，纠错等级 ${ec} 最高支持 ${maxBytes} 字节（版本 ${MAX_VERSION}）`,
  )
}

// ── 数据码字 + 纠错 + 交织 ───────────────────────────────────────────────────
function buildCodewords(bytes, version, ec) {
  const { data: dataCw, ecPerBlock, blocks } = blockInfoOf(version, ec)
  const bb = new BitBuffer()
  bb.push(0b0100, 4)                    // 字节模式
  bb.push(bytes.length, charCountBits(version))
  for (const b of bytes) bb.push(b, 8)
  // 终止符：最多 4 个 0（装不下就不补满）
  for (let i = 0; i < 4 && bb.length < dataCw * 8; i++) bb.push(0, 1)
  // 补齐到字节边界
  while (bb.length % 8 !== 0) bb.push(0, 1)
  // 交替填充 0xEC / 0x11
  for (let pad = 0xec; bb.length < dataCw * 8; pad ^= 0xec ^ 0x11) bb.push(pad, 8)

  const data = bb.toBytes()
  if (data.length !== dataCw) throw new Error(`数据码字数不对：${data.length} ≠ ${dataCw}`)

  // 分块：前 numShortBlocks 块比后面少 1 个数据码字（规范的长块/短块规则）
  const raw = rawCodewordsOf(version)
  const numShortBlocks = blocks - (raw % blocks)
  const shortBlockLen = Math.floor(raw / blocks)          // 含纠错码字
  const divisor = rsDivisor(ecPerBlock)
  const datBlocks = []
  const eccBlocks = []
  let k = 0
  for (let i = 0; i < blocks; i++) {
    const datLen = shortBlockLen - ecPerBlock + (i < numShortBlocks ? 0 : 1)
    const dat = data.slice(k, k + datLen)
    k += datLen
    datBlocks.push(dat)
    eccBlocks.push(rsRemainder(dat, divisor))
  }
  if (k !== data.length) throw new Error(`分块错位：吃了 ${k} 字节，只有 ${data.length} 字节`)

  // 交织（不是拼起来 ✗）——先按列取数据码字，再按列取纠错码字
  const out = new Uint8Array(raw)
  let p = 0
  const shortDataLen = shortBlockLen - ecPerBlock
  for (let i = 0; i <= shortDataLen; i++) {
    for (let j = 0; j < blocks; j++) {
      if (i === shortDataLen && j < numShortBlocks) continue   // 短块没有第 shortDataLen+1 个
      out[p++] = datBlocks[j][i]
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (let j = 0; j < blocks; j++) out[p++] = eccBlocks[j][i]
  }
  if (p !== raw) throw new Error(`交织后长度不对：${p} ≠ ${raw}`)
  return out
}

// ── 矩阵绘制 ─────────────────────────────────────────────────────────────────
class QrMatrix {
  constructor(version, ec) {
    this.version = version
    this.ec = ec
    this.size = sizeOf(version)
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false))
    this.isFunction = Array.from({ length: this.size }, () => new Array(this.size).fill(false))
  }
  /** x = 列，y = 行（跟规范一致，读代码时别搞反） */
  setFn(x, y, dark) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return
    this.modules[y][x] = !!dark
    this.isFunction[y][x] = true
  }
  drawFunctionPatterns() {
    for (let i = 0; i < this.size; i++) {
      this.setFn(6, i, i % 2 === 0)
      this.setFn(i, 6, i % 2 === 0)
    }
    this.drawFinder(3, 3)
    this.drawFinder(this.size - 4, 3)
    this.drawFinder(3, this.size - 4)
    const align = alignmentPositionsOf(this.version)
    const n = align.length
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
        this.drawAlignment(align[i], align[j])
      }
    }
    this.drawFormat(0)   // 先占位（真实掩码后面再写一遍）
    this.drawVersion()
  }
  drawFinder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        this.setFn(cx + dx, cy + dy, dist !== 2 && dist !== 4)
      }
    }
  }
  drawAlignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }
  drawFormat(mask) {
    const data = (EC_FORMAT_BITS[this.ec] << 3) | mask
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = ((data << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) this.setFn(8, i, ((bits >>> i) & 1) !== 0)
    this.setFn(8, 7, ((bits >>> 6) & 1) !== 0)
    this.setFn(8, 8, ((bits >>> 7) & 1) !== 0)
    this.setFn(7, 8, ((bits >>> 8) & 1) !== 0)
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, ((bits >>> i) & 1) !== 0)
    for (let i = 0; i < 8; i++) this.setFn(this.size - 1 - i, 8, ((bits >>> i) & 1) !== 0)
    for (let i = 8; i < 15; i++) this.setFn(8, this.size - 15 + i, ((bits >>> i) & 1) !== 0)
    this.setFn(8, this.size - 8, true)   // 固定黑点
  }
  drawVersion() {
    if (this.version < 7) return
    let rem = this.version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (this.version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) !== 0
      const a = this.size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      this.setFn(a, b, bit)
      this.setFn(b, a, bit)
    }
  }
  drawCodewords(data) {
    let i = 0
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j
          const upward = ((right + 1) & 2) === 0
          const y = upward ? this.size - 1 - vert : vert
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0
            i++
          }
        }
      }
    }
  }
  applyMask(mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue
        let invert
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break
          case 1: invert = y % 2 === 0; break
          case 2: invert = x % 3 === 0; break
          case 3: invert = (x + y) % 3 === 0; break
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break
          case 6: invert = ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0; break
          case 7: invert = ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0; break
          default: throw new RangeError('掩码只能是 0–7')
        }
        if (invert) this.modules[y][x] = !this.modules[y][x]
      }
    }
  }
  /** 规范里的四条罚分（N1–N4），越小越好 —— 用来挑掩码 */
  penalty() {
    const s = this.size
    const m = this.modules
    let score = 0
    // N1：同色连续 ≥5
    for (let y = 0; y < s; y++) {
      let run = 0
      let last = false
      for (let x = 0; x < s; x++) {
        if (x === 0 || m[y][x] === last) { run++ } else { if (run >= 5) score += 3 + (run - 5); run = 1 }
        last = m[y][x]
      }
      if (run >= 5) score += 3 + (run - 5)
    }
    for (let x = 0; x < s; x++) {
      let run = 0
      let last = false
      for (let y = 0; y < s; y++) {
        if (y === 0 || m[y][x] === last) { run++ } else { if (run >= 5) score += 3 + (run - 5); run = 1 }
        last = m[y][x]
      }
      if (run >= 5) score += 3 + (run - 5)
    }
    // N2：2×2 同色
    for (let y = 0; y < s - 1; y++) {
      for (let x = 0; x < s - 1; x++) {
        const c = m[y][x]
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3
      }
    }
    // N3：像定位图案的 1:1:3:1:1 序列
    //   规范给的判定形态是两种 11 位：1011101 0000 和 0000 1011101 ✓
    const P1 = [true, false, true, true, true, false, true, false, false, false, false]
    const P2 = [false, false, false, false, true, false, true, true, true, false, true]
    const lineHasPat = (get, len) => {
      for (let i = 0; i + 11 <= len; i++) {
        let m1 = true
        let m2 = true
        for (let k = 0; k < 11; k++) {
          const v = get(i + k)
          if (v !== P1[k]) m1 = false
          if (v !== P2[k]) m2 = false
          if (!m1 && !m2) break
        }
        if (m1 || m2) return true
      }
      return false
    }
    for (let y = 0; y < s; y++) if (lineHasPat((x) => m[y][x], s)) score += 40
    for (let x = 0; x < s; x++) if (lineHasPat((y) => m[y][x], s)) score += 40
    // N4：黑白比例偏离 50%（规范：每偏离 5% 罚 10 分）
    let dark = 0
    for (const row of m) for (const c of row) if (c) dark++
    const total = s * s
    const k = Math.floor(Math.abs(dark * 20 - total * 10) / total)
    score += k * 10
    return score
  }
  /** 冻结成不可变的二维布尔数组（true = 黑） */
  snapshot() {
    return this.modules.map((row) => row.slice())
  }
}

// ── 对外接口 ─────────────────────────────────────────────────────────────────

/**
 * 文本 → 二维码模块矩阵。
 * @param {string} text 任意文本（按 UTF-8 编码）
 * @param {{ec?: 'L'|'M'|'Q'|'H', version?: number, mask?: number}} [opts]
 * @returns {{size:number, version:number, ec:string, mask:number, modules:boolean[][]}}
 */
export function qrMatrix(text, opts = {}) {
  const ec = String(opts.ec ?? 'M').toUpperCase()
  // 注意：M 的格式位是 0（假值）—— 不能用 `!EC_FORMAT_BITS[ec]` 判断 ✗
  if (!Object.hasOwn(EC_FORMAT_BITS, ec)) throw new RangeError(`纠错等级只能是 L/M/Q/H，收到 ${opts.ec}`)
  const bytes = utf8Bytes(text)
  if (bytes.length === 0) throw new RangeError('内容不能是空的')
  const version = opts.version ? Number(opts.version) : pickVersion(bytes.length, ec)
  if (!ECC[version]) throw new RangeError(`版本只能是 ${MIN_VERSION}–${MAX_VERSION}，收到 ${opts.version}`)
  const need = 4 + charCountBits(version) + bytes.length * 8
  if (need > blockInfoOf(version, ec).data * 8) {
    throw new RangeError(`版本 ${version} + 等级 ${ec} 装不下 ${bytes.length} 字节的内容`)
  }
  const codewords = buildCodewords(bytes, version, ec)
  const qr = new QrMatrix(version, ec)
  qr.drawFunctionPatterns()
  qr.drawCodewords(codewords)
  const masks = opts.mask != null ? [Number(opts.mask)] : [0, 1, 2, 3, 4, 5, 6, 7]
  let best = null
  for (const mask of masks) {
    qr.applyMask(mask)
    qr.drawFormat(mask)
    const score = qr.penalty()
    if (!best || score < best.score) best = { mask, score, modules: qr.snapshot() }
    qr.applyMask(mask)   // 异或两次 = 还原
  }
  return { size: qr.size, version, ec, mask: best.mask, modules: best.modules }
}

/**
 * 文本 → SVG 字符串（可直接塞进 <img src="data:image/svg+xml;base64,...">）。
 * 纯 ASCII 输出 —— 没有字体、没有外部引用，任何浏览器都能画 ✓
 * @param {string} text
 * @param {{ec?:string, scale?:number, margin?:number, dark?:string, light?:string}} [opts]
 */
export function qrSvg(text, opts = {}) {
  const scale = Number(opts.scale ?? 6)
  const margin = Number(opts.margin ?? 4)
  const dark = opts.dark ?? '#000000'
  const light = opts.light ?? '#ffffff'
  const { modules, size } = qrMatrix(text, { ec: opts.ec ?? 'M' })
  const dim = (size + margin * 2) * scale
  let path = ''
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules[y][x]) continue
      path += `M${(x + margin) * scale} ${(y + margin) * scale}h${scale}v${scale}h-${scale}z`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim}" height="${dim}" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">`
    + `<rect width="${dim}" height="${dim}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`
}

export const QR_LIMITS = { minVersion: MIN_VERSION, maxVersion: MAX_VERSION, levels: ['L', 'M', 'Q', 'H'] }
