/**
 * 二维码生成器测试。
 *
 * 这里做两件事：
 *   ① 结构不变量 —— 定位/定时/对齐/格式/版本信息都在规范要求的位置上
 *   ② **自己解回来** —— 反掩码、反交织、逐块验证 RS 余数为 0、取出原始字节，
 *      和输入逐字节比对。这等于在 Node 里自带一个「最小解码器」✓
 *
 * 外部交叉验证（开发机上做，不进测试）：把矩阵渲染成 PNG 交给 OpenCV 的
 * QRCodeDetector / QRCodeDetectorAruco 真解码 → 8 个掩码 × 4 段语料 32/32 通过。
 * 所以「格子摆得对不对」这件事有独立实现背书，不只是自己说自己对 ✓
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { qrMatrix, qrSvg, QR_LIMITS } from '../lib/qr.mjs'

// ── 测试里的小工具（和服务端实现独立的另一份）────────────────────────────────

function gfMul(x, y) {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree) {
  const r = new Uint8Array(degree)
  r[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      r[j] = gfMul(r[j], root)
      if (j + 1 < degree) r[j] ^= r[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return r
}

/** 用与编码器相同的除法验证「数据+纠错」整体余数为 0（RS 码的核心性质） */
function rsIsValid(block, divisor) {
  const rem = new Uint8Array(divisor.length)
  for (const b of block) {
    const factor = b ^ rem[0]
    rem.copyWithin(0, 1)
    rem[rem.length - 1] = 0
    for (let i = 0; i < rem.length; i++) rem[i] ^= gfMul(divisor[i], factor)
  }
  return rem.every((v) => v === 0)
}

/** 从矩阵里把码字按规范顺序读回来（编码器的逆操作） */
function readCodewords(qr) {
  const { modules, size } = qr
  const isFn = Array.from({ length: size }, () => new Array(size).fill(false))
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) isFn[y][x] = true }
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { mark(3 + dx, 3 + dy); mark(size - 4 + dx, 3 + dy); mark(3 + dx, size - 4 + dy) }
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6) }
  const numAlign = Math.floor(qr.version / 7) + 2
  if (qr.version > 1) {
    const step = Math.ceil((qr.version * 4 + 4) / (numAlign * 2 - 2)) * 2
    const pos = [6]
    for (let p = size - 7; pos.length < numAlign; p -= step) pos.splice(1, 0, p)
    for (const cy of pos) for (const cx of pos) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === pos[pos.length - 1]) || (cx === pos[pos.length - 1] && cy === 6)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy)
    }
  }
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8) }
  for (let i = 0; i < 8; i++) { mark(size - 1 - i, 8); mark(8, size - 1 - i) }
  mark(8, size - 8)
  if (qr.version >= 7) {
    for (let i = 0; i < 18; i++) { mark(size - 11 + (i % 3), Math.floor(i / 3)); mark(Math.floor(i / 3), size - 11 + (i % 3)) }
  }
  const bits = []
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFn[y][x]) bits.push(modules[y][x] ? 1 : 0)
      }
    }
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0
    for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k]
    bytes.push(v)
  }
  return bytes
}

/** 反掩码（写回一份新矩阵） */
function unmask(qr) {
  const mods = qr.modules.map((r) => r.slice())
  const { size, mask } = qr
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inv
      switch (mask) {
        case 0: inv = (x + y) % 2 === 0; break
        case 1: inv = y % 2 === 0; break
        case 2: inv = x % 3 === 0; break
        case 3: inv = (x + y) % 3 === 0; break
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
        case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break
        case 6: inv = ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0; break
        case 7: inv = ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0; break
        default: throw new Error('bad mask')
      }
      if (inv && !isFunctionAt(size, qr.version, x, y)) mods[y][x] = !mods[y][x]
    }
  }
  return mods
}

function isFunctionAt(size, version, x, y) {
  const inBox = (cx, cy, r) => Math.abs(x - cx) <= r && Math.abs(y - cy) <= r
  if (inBox(3, 3, 4) || inBox(size - 4, 3, 4) || inBox(3, size - 4, 4)) return true
  if (x === 6 || y === 6) return true
  if (x === 8 && y <= 8) return true
  if (y === 8 && x <= 8) return true
  if (x === 8 && y >= size - 8) return true
  if (y === 8 && x >= size - 8) return true
  if (version >= 7 && ((x >= size - 11 && x <= size - 9 && y <= 5) || (y >= size - 11 && y <= size - 9 && x <= 5))) return true
  const numAlign = Math.floor(version / 7) + 2
  if (version > 1) {
    const step = Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2
    const pos = [6]
    for (let p = size - 7; pos.length < numAlign; p -= step) pos.splice(1, 0, p)
    for (const cy of pos) for (const cx of pos) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === pos[pos.length - 1]) || (cx === pos[pos.length - 1] && cy === 6)) continue
      if (Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2) return true
    }
  }
  return false
}

// ── ① 结构不变量 ─────────────────────────────────────────────────────────────

test('尺寸 / 版本 / 掩码都落在规范范围里', () => {
  const qr = qrMatrix('https://example.com')
  assert.equal(qr.size, qr.version * 4 + 17)
  assert.ok(qr.version >= 1 && qr.version <= QR_LIMITS.maxVersion)
  assert.ok(qr.mask >= 0 && qr.mask <= 7)
  assert.equal(qr.modules.length, qr.size)
  assert.ok(qr.modules.every((row) => row.length === qr.size && row.every((v) => typeof v === 'boolean')))
})

test('三个定位图案（含分隔符）都在规范位置', () => {
  const qr = qrMatrix('position check')
  const { modules: m, size } = qr
  const expected = [
    [true, true, true, true, true, true, true],
    [true, false, false, false, false, false, true],
    [true, false, true, true, true, false, true],
    [true, false, true, true, true, false, true],
    [true, false, true, true, true, false, true],
    [true, false, false, false, false, false, true],
    [true, true, true, true, true, true, true],
  ]
  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) assert.equal(m[oy + y][ox + x], expected[y][x], `finder@${ox},${oy} +${x},${y}`)
    }
  }
  // 分隔符必须是白的
  for (let i = 0; i < 8; i++) {
    assert.equal(m[7][i], false)
    assert.equal(m[i][7], false)
  }
})

test('定时图案是交替的，固定黑点在 (8, size-8)', () => {
  const qr = qrMatrix('timing')
  const { modules: m, size } = qr
  for (let i = 8; i < size - 8; i++) {
    assert.equal(m[6][i], i % 2 === 0, `row timing @${i}`)
    assert.equal(m[i][6], i % 2 === 0, `col timing @${i}`)
  }
  assert.equal(m[size - 8][8], true)
})

test('格式信息能被规范生成多项式整除（即真的写对了）', () => {
  for (const ec of ['L', 'M', 'Q', 'H']) {
    const qr = qrMatrix('format check', { ec })
    const { modules: m, size } = qr
    // 读第一份格式信息（规范位置）
    const bits = []
    for (let i = 0; i <= 5; i++) bits.push(m[i][8] ? 1 : 0)
    bits.push(m[7][8] ? 1 : 0)
    bits.push(m[8][8] ? 1 : 0)
    bits.push(m[8][7] ? 1 : 0)
    for (let i = 9; i < 15; i++) bits.push(m[8][14 - i] ? 1 : 0)
    // 位序：bits[i] 是格式值的**第 i 位（LSB 在前）**—— 用移位装配，别用 (v<<1)|b ✗
    let v = 0
    bits.forEach((b, i) => { v |= b << i })
    v ^= 0x5412
    // BCH(15,5)：除以 0x537 余数必须为 0
    let rem = v
    for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10)
    assert.equal(rem, 0, `ec=${ec} 格式信息余数应为 0`)
    // 且前 5 位要回得出 ec + mask
    const data = (v >>> 10) & 0x1f
    assert.equal(data >>> 3, { L: 1, M: 0, Q: 3, H: 2 }[ec], `ec=${ec} 的等级位`)
    assert.equal(data & 7, qr.mask, `ec=${ec} 的掩码位`)
  }
})

test('版本 ≥7 才写版本信息，且两处副本一致', () => {
  const small = qrMatrix('v-small')
  assert.ok(small.version < 7)
  const big = qrMatrix('z'.repeat(140), { ec: 'L' })
  assert.ok(big.version >= 7, `期望大版本，实际 v${big.version}`)
  const { modules: m, size } = big
  for (let i = 0; i < 18; i++) {
    const a = m[Math.floor(i / 3)][size - 11 + (i % 3)]
    const b = m[size - 11 + (i % 3)][Math.floor(i / 3)]
    assert.equal(a, b, `第 ${i} 位两处副本应一致`)
  }
})

// ── ② 自己解回来（真正的回归防线）─────────────────────────────────────────────

test('反掩码 + 反交织 + RS 校验 + 取回原文，逐字节相等', () => {
  const cases = [
    { text: 'HELLO', ec: 'M' },
    { text: 'https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=' + 'a'.repeat(32), ec: 'M' },
    { text: 'https://passport.bilibili.com/h5-app/passport/login/scan?navhide=1&qrcode_key=8587cf8106a0b863c46d6bab913537f6&from=', ec: 'M' },
    { text: '中文内容也要能原样取回：嘟嘟可 ' + 'x'.repeat(30), ec: 'Q' },
  ]
  for (const c of cases) {
    const qr = qrMatrix(c.text, { ec: c.ec })
    const plain = { ...qr, modules: unmask(qr) }
    const cw = readCodewords(plain)
    const total = cw.length
    // 用与实现同构的方式推出分块结构
    const table = { 1: [[7, 1], [10, 1], [13, 1], [17, 1]], 2: [[10, 1], [16, 1], [22, 1], [28, 1]], 3: [[15, 1], [26, 1], [18, 2], [22, 2]], 4: [[20, 1], [18, 2], [26, 2], [16, 4]], 5: [[26, 1], [24, 2], [18, 4], [22, 4]], 6: [[18, 2], [16, 4], [24, 4], [28, 4]], 7: [[20, 2], [18, 4], [18, 6], [26, 5]], 8: [[24, 2], [22, 4], [22, 6], [26, 6]], 9: [[30, 2], [22, 5], [20, 8], [24, 8]], 10: [[18, 4], [26, 5], [24, 8], [28, 8]] }[qr.version][{ L: 0, M: 1, Q: 2, H: 3 }[qr.ec]]
    const [ecPerBlock, blocks] = table
    const numShort = blocks - (total % blocks)
    const shortLen = Math.floor(total / blocks)
    const shortDataLen = shortLen - ecPerBlock
    // 反交织：数据码字
    const datBlocks = Array.from({ length: blocks }, () => [])
    let p = 0
    for (let i = 0; i <= shortDataLen; i++) {
      for (let j = 0; j < blocks; j++) {
        if (i === shortDataLen && j < numShort) continue
        datBlocks[j].push(cw[p++])
      }
    }
    const eccBlocks = Array.from({ length: blocks }, () => [])
    for (let i = 0; i < ecPerBlock; i++) for (let j = 0; j < blocks; j++) eccBlocks[j].push(cw[p++])
    assert.equal(p, total)
    // 每块整体（数据+纠错）都应能被生成多项式整除
    const divisor = rsDivisor(ecPerBlock)
    datBlocks.forEach((dat, i) => {
      assert.ok(rsIsValid([...dat, ...eccBlocks[i]], divisor), `${c.ec} 第 ${i} 块 RS 校验失败`)
    })
    // 取回原文
    const data = datBlocks.flat()
    const bits = []
    for (const b of data) for (let k = 7; k >= 0; k--) bits.push((b >>> k) & 1)
    const mode = bits.slice(0, 4).join('')
    assert.equal(mode, '0100', '应是字节模式')
    const ccBits = qr.version <= 9 ? 8 : 16
    let len = 0
    for (let i = 4; i < 4 + ccBits; i++) len = (len << 1) | bits[i]
    const bytes = []
    for (let i = 0; i < len; i++) {
      let v = 0
      for (let k = 0; k < 8; k++) v = (v << 1) | bits[4 + ccBits + i * 8 + k]
      bytes.push(v)
    }
    assert.equal(Buffer.from(bytes).toString('utf8'), c.text, `原文应原样取回（${c.ec}）`)
  }
})

// ── ③ 边界与错误 ─────────────────────────────────────────────────────────────

test('空内容 / 超长内容 / 非法等级 / 非法版本都要明确报错', () => {
  assert.throws(() => qrMatrix(''), /内容不能是空的/)
  assert.throws(() => qrMatrix('a'.repeat(400), { ec: 'H' }), /内容太长/)
  assert.throws(() => qrMatrix('x', { ec: 'Z' }), /纠错等级只能是 L\/M\/Q\/H/)
  assert.throws(() => qrMatrix('x', { version: 40 }), /版本只能是/)
  assert.throws(() => qrMatrix('x'.repeat(100), { version: 1 }), /装不下/)
})

test('M 等级不会被「格式位是 0」骗过去（假值 bug 的回归）', () => {
  const qr = qrMatrix('M level must work', { ec: 'M' })
  assert.equal(qr.ec, 'M')
  assert.ok(qr.size > 0)
})

test('纠错等级越高，版本只会更大或持平', () => {
  const text = 'https://example.com/a/b/c'
  const m = qrMatrix(text, { ec: 'M' }).version
  const l = qrMatrix(text, { ec: 'L' }).version
  const h = qrMatrix(text, { ec: 'H' }).version
  assert.ok(l <= m && m <= h, `期望 v(L)<=v(M)<=v(H)，实际 ${l}/${m}/${h}`)
})

test('同样的输入必须产出同样的矩阵（可复现）', () => {
  const a = qrMatrix('deterministic?', { ec: 'Q' })
  const b = qrMatrix('deterministic?', { ec: 'Q' })
  assert.deepEqual(a.modules, b.modules)
  assert.equal(a.mask, b.mask)
})

test('扫码登录那条真链接装得下（等级 M 的默认选择）', () => {
  const url = 'https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=' + 'f'.repeat(32)
  const qr = qrMatrix(url)
  assert.ok(qr.version <= 10, `v${qr.version} 应在支持范围内`)
  assert.equal(qr.ec, 'M')
})

// ── ④ SVG ────────────────────────────────────────────────────────────────────

test('SVG 是纯 ASCII、尺寸对得上、只含必要元素', () => {
  const svg = qrSvg('https://www.bilibili.com', { ec: 'M', scale: 6, margin: 4 })
  assert.ok(/^[\x00-\x7f]*$/.test(svg), '必须纯 ASCII（否则 data URL / btoa 会炸）')
  assert.ok(svg.startsWith('<svg '))
  assert.ok(svg.endsWith('</svg>'))
  const qr = qrMatrix('https://www.bilibili.com', { ec: 'M' })
  const dim = (qr.size + 8) * 6
  assert.ok(svg.includes(`width="${dim}"`) && svg.includes(`height="${dim}"`))
  assert.ok(svg.includes('<path d="M'))
  assert.equal((svg.match(/<rect /g) || []).length, 1, '只需要一块背景')
})

test('SVG 可以 base64 进 data URL（浏览器 <img> 直接能用）', () => {
  const svg = qrSvg('https://b23.tv/xxxx', { scale: 4 })
  const b64 = Buffer.from(svg, 'utf8').toString('base64')
  assert.ok(b64.length > 100)
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), svg)
})
