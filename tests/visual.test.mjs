// visual.mjs 的单测（P3 抽帧·轻量版）
//
// 全部走注入：`run` 假装是 ffmpeg，`get` 假装是 apiGet。
// 这样测试不碰网络、不装 ffmpeg、也不需要真视频 —— CI 和本机都能跑。
//
// 有一条是**契约测试**，坏了必须红：
//   抓帧参数里 `-ss` 必须在 `-i` 之前。放到 `-i` 之后就从「Range seek」变成
//   「下载到那个时间点」（ffmpeg 会顺序解码），轻量版就名存实亡了。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  BILI_REFERER, biliCookie, biliFfmpegArgs, extractFrames, fmtClock, grabFrame, gridForN,
  montageSheet, parseClock, parseGrid, pickTimes, qualityName, resolveVideo, visualForBv,
} from '../tools/lib/visual.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'myilidepu-visual-'))

/** 假 ffmpeg：把「输出文件」写出来，并记录每次调用（failAt 里的时间点会故意失败） */
function fakeRun({ failAt = [] } = {}) {
  const calls = []
  const run = (file, args, opts) => {
    calls.push({ file, args: [...args], opts })
    const i = args.indexOf('-ss')
    const at = i >= 0 ? Number(args[i + 1]) : NaN
    if (failAt.some((f) => Math.abs(f - at) < 0.001)) throw new Error('ffmpeg 挂了（假装的）')
    fs.writeFileSync(args[args.length - 1], Buffer.from('not-a-real-jpg'))
    return Buffer.alloc(0)
  }
  run.calls = calls
  return run
}

const fakeGet = (over = {}) => async (url) => (url.includes('/view')
  ? { code: 0, data: { cid: 42, title: '测试片', duration: 180, ...over.view } }
  : { code: 0, data: { quality: 80, durl: [{ url: 'https://cdn.example/v.mp4', size: 999 }], ...over.play } })

test('parseGrid：认 3x3 / 4X3，脏值带 INVALID_GRID', () => {
  assert.deepEqual(parseGrid('3x3'), { cols: 3, rows: 3 })
  assert.deepEqual(parseGrid('4X3'), { cols: 4, rows: 3 })
  assert.deepEqual(parseGrid(undefined), { cols: 3, rows: 3 })
  for (const bad of ['abc', '3x', 'x3', '9x9', '0x3']) {
    assert.throws(() => parseGrid(bad), (e) => e.code === 'INVALID_GRID', `应拒掉 ${bad}`)
  }
})

test('gridForN：按张数挑刚好装得下的格子', () => {
  assert.equal(gridForN(1), '1x1')
  assert.equal(gridForN(4), '2x2')
  assert.equal(gridForN(6), '3x2')
  assert.equal(gridForN(9), '3x3')
  assert.equal(gridForN(12), '4x3')
})

test('parseClock / fmtClock：两种写法都认', () => {
  assert.equal(parseClock('83'), 83)
  assert.equal(parseClock('1:23'), 83)
  assert.equal(parseClock('01:23.5'), 83.5)
  assert.throws(() => parseClock('1:2:3'), (e) => e.code === 'INVALID_TIME')
  assert.throws(() => parseClock('abc'), (e) => e.code === 'INVALID_TIME')
  assert.equal(fmtClock(83), '01:23')
  assert.equal(fmtClock(0), '00:00')
  assert.equal(fmtClock(-5), '00:00')
})

test('pickTimes：均匀、递增、避开片头片尾', () => {
  const t = pickTimes(180, 9)
  assert.equal(t.length, 9)
  assert.deepEqual([...t].sort((a, b) => a - b), t)
  assert.ok(t[0] > 0, '不该从 0 开始（片头多半是黑场/logo）')
  assert.ok(t[8] < 180, '不该压在最后一秒')
  assert.deepEqual(pickTimes(180, 1), [90])
  assert.deepEqual(pickTimes(0, 3), [0, 1, 2], '时长未知就退回 0/1/2 秒')
})

test('ffmpeg 抓帧参数带 Referer，且 -ss 必须在 -i 之前（契约）', () => {
  const head = biliFfmpegArgs()
  assert.deepEqual(head.slice(0, 2), ['-user_agent', head[1]])
  assert.ok(head.includes('-headers'))
  assert.ok(head[head.indexOf('-headers') + 1].includes(`Referer: ${BILI_REFERER}`))
  assert.ok(head[head.indexOf('-headers') + 1].includes('\r\n'), 'headers 要 CRLF 结尾')

  const dir = tmp()
  const dst = path.join(dir, 'f00.jpg')
  const run = fakeRun()
  grabFrame({ run, ffmpeg: 'ffmpeg', url: 'https://cdn.example/v.mp4', at: 12, dst })
  const args = run.calls[0].args
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'), '-ss 放 -i 之后就不是 seek 了')
  assert.ok(args.indexOf('-user_agent') < args.indexOf('-ss'))
  assert.equal(args[args.indexOf('-i') + 1], 'https://cdn.example/v.mp4')
  assert.equal(args[args.length - 1], dst)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('grabFrame：ffmpeg 说成功但没写出文件 → FRAME_MISSING', () => {
  const dir = tmp()
  assert.throws(
    () => grabFrame({ run: () => {}, ffmpeg: 'ffmpeg', url: 'u', at: 1, dst: path.join(dir, 'none.jpg') }),
    (e) => e.code === 'FRAME_MISSING',
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('montageSheet：scale+tile 拼图，参数写死能被断言', () => {
  const dir = tmp()
  const frames = [0, 1, 2, 3].map((i) => { const p = path.join(dir, `f${String(i).padStart(2, '0')}.jpg`); fs.writeFileSync(p, 'x'); return p })
  const run = fakeRun()
  const out = montageSheet({ run, ffmpeg: 'ffmpeg', frames, cols: 2, rows: 2, sheet: path.join(dir, 's.jpg') })
  const vf = run.calls[0].args[run.calls[0].args.indexOf('-vf') + 1]
  assert.equal(vf, 'scale=480:-1,tile=2x2')
  assert.ok(fs.existsSync(out.path))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('extractFrames：单帧失败不算整体失败，全失败才算', () => {
  const dir = tmp()
  const ok = extractFrames({ run: fakeRun({ failAt: [30] }), ffmpeg: 'ffmpeg', url: 'u', times: [10, 30, 50], outDir: path.join(dir, 'a'), cols: 3, rows: 3 })
  assert.equal(ok.frames.length, 2)
  assert.deepEqual(ok.frames.map((f) => f.at), [10, 50])
  assert.equal(ok.failed.length, 1)
  assert.equal(ok.frames[0].atText, '00:10')
  assert.ok(fs.existsSync(ok.sheet))

  assert.throws(
    () => extractFrames({ run: fakeRun({ failAt: [10, 30] }), ffmpeg: 'ffmpeg', url: 'u', times: [10, 30], outDir: path.join(dir, 'b'), cols: 2, rows: 1 }),
    (e) => e.code === 'NO_FRAMES' && e.failed.length === 2,
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('resolveVideo：拿到 cid/时长/直链，没有直链就 NO_PLAYURL', async () => {
  const v = await resolveVideo({ bvid: 'BV1xx411c7mD', headers: {}, get: fakeGet() })
  assert.equal(v.cid, 42)
  assert.equal(v.duration, 180)
  assert.equal(v.url, 'https://cdn.example/v.mp4')
  await assert.rejects(
    () => resolveVideo({ bvid: 'BV1xx411c7mD', headers: {}, get: fakeGet({ play: { durl: [] } }) }),
    (e) => e.code === 'NO_PLAYURL',
  )
  await assert.rejects(
    () => resolveVideo({ bvid: 'BV1xx411c7mD', headers: {}, get: async () => ({ code: -404, message: '啥都木有' }) }),
    (e) => e.code === 'VIEW_FAILED',
  )
})

test('visualForBv：一条龙成功，quality 翻成人话；缺 ffmpeg 只报不抛', async () => {
  const dir = tmp()
  const out = await visualForBv({ bvid: 'BV1xx411c7mD', n: 4, outDir: dir, cred: {}, ffmpeg: 'ffmpeg', run: fakeRun(), get: fakeGet() })
  assert.equal(out.ok, true)
  assert.equal(`${out.cols}x${out.rows}`, '3x3', '--grid 默认 3x3')
  assert.equal(out.frames.length, 4)
  assert.equal(out.quality, '1080P')
  assert.ok(out.sheet.startsWith(dir))
  assert.ok(out.elapsedMs >= 0)

  const missing = await visualForBv({ bvid: 'BV1xx411c7mD', outDir: dir, cred: {}, ffmpeg: null, run: fakeRun(), get: fakeGet() })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'FFMPEG_MISSING')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('visualForBv：--at 指定时间点，脏值给 INVALID_TIME', async () => {
  const dir = tmp()
  const out = await visualForBv({ bvid: 'BV1xx411c7mD', at: ['1:00', '90'], outDir: dir, cred: {}, ffmpeg: 'ffmpeg', run: fakeRun(), get: fakeGet() })
  assert.deepEqual(out.times, [60, 90])
  const bad = await visualForBv({ bvid: 'BV1xx411c7mD', at: ['abc'], outDir: dir, cred: {}, ffmpeg: 'ffmpeg', run: fakeRun(), get: fakeGet() })
  assert.equal(bad.code, 'INVALID_TIME')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('biliCookie：字段名两种写法都认，缺了就少那个', () => {
  assert.equal(biliCookie({ sessdata: 'a', bili_jct: 'b', buvid3: 'c' }), 'SESSDATA=a; bili_jct=b; buvid3=c')
  assert.equal(biliCookie({ SESSDATA: 'A', biliJct: 'B' }), 'SESSDATA=A; bili_jct=B')
  assert.equal(biliCookie({}), '')
})

test('qualityName：认不出来就原样返回，别编', () => {
  assert.equal(qualityName(80), '1080P')
  assert.equal(qualityName(64), '720P')
  assert.equal(qualityName(999), '999')
  assert.equal(qualityName(undefined), '-')
})
