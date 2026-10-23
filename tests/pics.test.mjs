// 图片库（tools/lib/pics.mjs）：主人往 D:\MyDepu\pics 丢图，她按名字挑一张配到动态里 ✓
//
// 2026-10-23 主人要求（m05172）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { kindOf, dimsOf, listPics, resolvePic, describePics, IMAGE_EXT } from '../tools/lib/pics.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pics-test-'))

// 造几个**只有文件头**的假图：够 kindOf/dimsOf 用，不需要真的能解码 ✓
function fakePng(w, h) {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
  return b
}
function fakeGif(w, h) {
  const b = Buffer.alloc(13)
  b.write('GIF89a', 0, 'latin1')
  b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8)
  return b
}
function fakeJpg(w, h) {
  const b = Buffer.alloc(24)
  b.writeUInt16BE(0xffd8, 0)                 // SOI
  b.writeUInt16BE(0xffc0, 2)                 // SOF0
  b.writeUInt16BE(11, 4)                     // 段长
  b[6] = 8                                   // 精度
  b.writeUInt16BE(h, 7); b.writeUInt16BE(w, 9)
  return b
}
function fakeWebp(w, h) {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1')
  const put24 = (v, off) => { b[off] = v & 0xff; b[off + 1] = (v >> 8) & 0xff; b[off + 2] = (v >> 16) & 0xff }
  put24(w - 1, 24); put24(h - 1, 27)
  return b
}

test('kindOf：按文件头认类型（不信扩展名）', () => {
  assert.equal(kindOf(fakePng(1, 1)), 'png')
  assert.equal(kindOf(fakeGif(1, 1)), 'gif')
  assert.equal(kindOf(fakeJpg(1, 1)), 'jpg')
  assert.equal(kindOf(fakeWebp(1, 1)), 'webp')
  assert.equal(kindOf(Buffer.from('这不是图片，只是一段话')), null)
  assert.equal(kindOf(Buffer.alloc(0)), null)
  assert.equal(kindOf('不是 Buffer'), null)
})

test('dimsOf：四种格式都读得出宽高', () => {
  assert.deepEqual(dimsOf(fakePng(1280, 720)), { width: 1280, height: 720 })
  assert.deepEqual(dimsOf(fakeGif(320, 200)), { width: 320, height: 200 })
  assert.deepEqual(dimsOf(fakeJpg(1920, 1080)), { width: 1920, height: 1080 })
  assert.deepEqual(dimsOf(fakeWebp(640, 480)), { width: 640, height: 480 })
  assert.equal(dimsOf(Buffer.from('x'.repeat(40))), null)          // 认不出类型 → null，不抛 ✓
  assert.equal(dimsOf(Buffer.alloc(4)), null)                      // 太短 → null ✓
})

test('listPics：只列真的能识别的图，按名字排序，跳过非图片与目录', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'b-happy.jpg'), fakeJpg(800, 600))
  fs.writeFileSync(path.join(dir, 'a-shy.png'), fakePng(400, 400))
  fs.writeFileSync(path.join(dir, 'c-note.txt'), '我不是图')
  fs.writeFileSync(path.join(dir, 'd-broken.jpg'), 'jpg 后缀但不是图')
  fs.mkdirSync(path.join(dir, 'e-dir.png'))
  fs.writeFileSync(path.join(dir, '.hidden.png'), fakePng(1, 1))
  const list = listPics(dir)
  assert.deepEqual(list.map((x) => x.name), ['a-shy', 'b-happy'])
  assert.equal(list[1].kind, 'jpg')
  assert.equal(list[1].width, 800)
  assert.equal(list[1].uploadable, true)
})

test('listPics：webp 会被标成不能上传（B 站只收 png/jpg/gif）', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'w.webp'), fakeWebp(100, 100))
  const [one] = listPics(dir)
  assert.equal(one.kind, 'webp')
  assert.equal(one.uploadable, false)
})

test('listPics：目录不存在时返回空数组（不抛）', () => {
  assert.deepEqual(listPics(path.join(tmp(), '没有这个目录')), [])
})

test('resolvePic：名字 / 带扩展名 / 绝对路径都认', () => {
  const dir = tmp()
  const file = path.join(dir, 'happy.jpg')
  fs.writeFileSync(file, fakeJpg(10, 10))
  fs.writeFileSync(path.join(dir, 'shy.png'), fakePng(10, 10))
  assert.equal(resolvePic('happy', dir), file)
  assert.equal(resolvePic('happy.jpg', dir), file)
  assert.equal(resolvePic(file, dir), file)
  assert.equal(resolvePic('shy', dir), path.join(dir, 'shy.png'))
})

test('resolvePic：找不到时报错并列出可用的名字', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'happy.jpg'), fakeJpg(10, 10))
  fs.writeFileSync(path.join(dir, 'sad.png'), fakePng(10, 10))
  assert.throws(() => resolvePic('angry', dir), (e) => {
    assert.match(e.message, /没有「angry」/)
    assert.match(e.message, /happy/)
    assert.match(e.message, /sad/)
    return true
  })
  assert.throws(() => resolvePic('', dir), /没给图片名/)
})

test('resolvePic：库是空的时候提示让主人放图', () => {
  assert.throws(() => resolvePic('anything', tmp()), /还没有图片|是空的/)
})

test('describePics：空库与有图两种输出', () => {
  assert.match(describePics([], 'D:\\MyDepu\\pics')[0], /还没有图片/)
  const lines = describePics(listPics((() => {
    const d = tmp()
    fs.writeFileSync(path.join(d, 'happy.jpg'), fakeJpg(800, 600))
    return d
  })()), 'D:\\MyDepu\\pics')
  assert.match(lines[0], /可用图片 1 张/)
  assert.match(lines[1], /happy/)
  assert.match(lines[1], /800x600/)
})

test('IMAGE_EXT 覆盖四种扩展名（含 .jpeg）', () => {
  for (const e of ['.png', '.jpg', '.jpeg', '.gif', '.webp']) assert.ok(IMAGE_EXT.includes(e), e)
})
