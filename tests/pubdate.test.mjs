// 发布日期过滤的单测（2026-10-23 主人要求「只看 2026 年 9 月之后发布的视频」）。
//
// 为什么值得单独测：这条规则同时管两条通路（feed 的候选池 + 学习侧 candidates），
// 一旦哪天有人只改了其中一边、或者日期边界从「含当天」变成「不含」，症状是
// 静默的 —— 她只是"最近看的都是旧片"，没人会收到报错 ✗ 所以边界必须钉死。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseDay,
  dayText,
  toSeconds,
  pubdateOf,
  isAfter,
  splitByDay,
  describeDay,
  describeFilter,
} from '../tools/lib/pubdate.mjs'

// 用本地时区构造时间戳：判断口径是"本地自然日"，测试也必须用本地时间 ✗ 不能用 UTC
const D = (s) => Math.floor(new Date(s).getTime() / 1000)

test('parseDay：接受 2026-09-01 / 2026-9-1 / 2026/09/01', () => {
  assert.equal(parseDay('2026-09-01').day, '2026-09-01')
  assert.equal(parseDay('2026-9-1').day, '2026-09-01')
  assert.equal(parseDay('2026/09/01').day, '2026-09-01')
  assert.equal(parseDay('2026-09-01').from.getHours(), 0, '当天 00:00 起算')
})

test('parseDay：空值 = 不限（不是错误）', () => {
  for (const v of ['', '   ', null, undefined]) assert.equal(parseDay(v), null)
})

test('parseDay：写法看不懂 / 日期不存在 → INVALID_DAY（fail-closed）', () => {
  for (const bad of ['九月', '2026-9', '20260901', '2026年9月1日', '01-09-2026']) {
    assert.throws(() => parseDay(bad), (e) => e.code === 'INVALID_DAY', `${bad} 应报 INVALID_DAY`)
  }
  assert.throws(() => parseDay('2026-02-30'), (e) => e.code === 'INVALID_DAY', '2 月没有 30 号')
})

test('toSeconds：秒 / 毫秒 / 数字串 / 日期串 都认得；0 与垃圾 = null', () => {
  const sec = D('2026-09-01T12:00:00')
  assert.equal(toSeconds(sec), sec)
  assert.equal(toSeconds(sec * 1000), sec, '毫秒要折回秒')
  assert.equal(toSeconds(String(sec)), sec, '数字串也算')
  assert.equal(toSeconds('2026-09-01 12:00:00'), sec, '日期串算本地时间')
  assert.equal(toSeconds(0), null)
  assert.equal(toSeconds(''), null)
  assert.equal(toSeconds('三天前'), null)
})

test('pubdateOf：各接口的字段名都能取到（含关注动态的 pub_ts）', () => {
  const sec = D('2026-09-15T08:00:00')
  assert.equal(pubdateOf({ pubdate: sec }), sec)
  assert.equal(pubdateOf({ pubtime: sec }), sec)
  assert.equal(pubdateOf({ ctime: sec }), sec)
  assert.equal(pubdateOf({ modules: { module_author: { pub_ts: sec } } }), sec, '关注动态')
  assert.equal(pubdateOf({ bv: 'BV1' }), null, '没有日期字段 = null')
  assert.equal(pubdateOf(null), null)
})

test('dayText：本地自然日；拿不到 → null', () => {
  assert.equal(dayText(D('2026-09-01T00:00:00')), '2026-09-01')
  assert.equal(dayText(D('2026-09-01T23:59:59')), '2026-09-01')
  assert.equal(dayText(undefined), null)
})

test('splitByDay：不限时原样放行（行为与加这个功能之前完全一致）', () => {
  const items = [{ bv: 'A', pubdate: D('2020-01-01T00:00:00') }, { bv: 'B' }]
  const s = splitByDay(items, '')
  assert.deepEqual(s.kept.map((x) => x.bv), ['A', 'B'])
  assert.equal(s.day, null)
  assert.equal(s.droppedOld, 0)
  assert.equal(s.droppedUnknown, 0)
})

test('splitByDay：边界含当天；更早的丢；没日期的算"不确定"丢', () => {
  const items = [
    { bv: 'old', pubdate: D('2026-08-31T23:59:59') },
    { bv: 'edge', pubdate: D('2026-09-01T00:00:00') },
    { bv: 'new', pubdate: D('2026-10-20T12:00:00') },
    { bv: 'nodate' },
  ]
  const s = splitByDay(items, '2026-09-01')
  assert.deepEqual(s.kept.map((x) => x.bv), ['edge', 'new'], '当天 00:00 要算进来')
  assert.equal(s.droppedOld, 1)
  assert.equal(s.droppedUnknown, 1)
  assert.equal(s.scanned, 4)
  assert.equal(s.day, '2026-09-01')
})

test('splitByDay：也接受已经 parseDay 过的对象', () => {
  const s = splitByDay([{ bv: 'x', pubdate: D('2026-10-01T00:00:00') }], parseDay('2026-09-01'))
  assert.deepEqual(s.kept.map((x) => x.bv), ['x'])
})

test('isAfter：没配置时恒 true（不给没设的人添乱）', () => {
  assert.equal(isAfter({ bv: 'x' }, null), true)
  assert.equal(isAfter({ bv: 'x', pubdate: D('2000-01-01T00:00:00') }, parseDay('2026-09-01')), false)
  assert.equal(isAfter({ bv: 'x' }, parseDay('2026-09-01')), false, '日期未知 = 不确认放行')
})

test('describeDay / describeFilter：说的话里要带日期与条数（不静默）', () => {
  assert.equal(describeDay(''), '')
  assert.equal(describeDay('2026-09-01'), '只看 2026-09-01 之后发布的')
  const line = describeFilter(splitByDay([{ bv: 'a' }], '2026-09-01'))
  assert.match(line, /2026-09-01/, '要把日期念出来')
  assert.match(line, /没有发布日期的丢掉 1 条/, '要把"不确定"的条数念出来')
  assert.equal(describeFilter({ day: null }), '', '没过滤就不说话')
  // reader.candidates 挂在数组上的 filterStats 里 kept 是"条数"而不是数组 ✓
  assert.match(
    describeFilter({ day: '2026-09-01', scanned: 20, droppedOld: 12, droppedUnknown: 3, kept: 5 }),
    /20 条里留下 5 条/,
  )
})
