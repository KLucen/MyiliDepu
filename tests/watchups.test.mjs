// 「重点关注某个 UP」的单测（2026-10-23 主人要求）。
//
// 为什么值得单独测：这条通路**全靠降级活着** —— 查不到 mid、接口吃 -352、改名了、
// 配置写脏了，任何一步失败都只该"跳过这个人"，绝不能让一轮生物钟崩掉 ✗
// 而"跳过"是静默的：症状只是"她最近没看那个 UP"，没人会收到报错。
// 所以这里钉三件事：① 脏配置能清干净 ② 失败一律 null / []（不 throw）且**出声**
// ③ 条目形状能直接塞进 feed.mjs 的候选池（字段名/秒数/日期一样不能错）。
//
// ⚠️ 全部用假 get 注入，**一次真网络都不打**（B站 风控凶，测试绝不去戳真接口）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeWatchUps,
  resolveMid,
  latestVideos,
  topicHitsOf,
  describeWatchUps,
} from '../tools/lib/watchups.mjs'

// 与 pubdate.test.mjs 同一口径：本地时区构造时间戳（判断用的是本地自然日）
const D = (s) => Math.floor(new Date(s).getTime() / 1000)

// wbi_img 的两段文件名拼起来必须 64 个字符，否则 signWbi 会当场抛错（这里按真实形状给）
const NAV = {
  code: 0,
  data: {
    wbi_img: {
      img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084b2f8d4b4e0e0a1d1c9d5e2f0ab.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/1a2b3c4d5e6f708192a3b4c5d6e7f809.png',
    },
  },
}

// space/wbi/arc/search 的真实形状：data.list.vlist；含三种脏条目（缺 BV / 缺 author / length 是空串）
const ARC = {
  code: 0,
  data: {
    list: {
      vlist: [
        {
          bvid: 'BV1xx411c7mD', title: 'DeepSeek 新模型实测', author: '黑鸦Heya', mid: 12345,
          length: '12:34', play: 23456, video_review: 128, pubdate: D('2026-10-20T12:00:00'),
        },
        {
          bvid: 'BV1yy411c7mE', title: 'Codex 用了一周的感受', author: '黑鸦Heya', mid: 12345,
          length: '1:02:03', play: 1000, video_review: 7, ctime: D('2026-10-19T09:00:00'),
        },
        { bvid: 'BV1zz411c7mF', title: '没有作者的脏条目', length: '' },
        { title: '没有 BV 的条目', length: '3:00' },   // 应被丢掉：没有 bvid 根本看不了
      ],
    },
  },
}

const isSearch = (u) => u.includes('/search/type')
const isNav = (u) => u.includes('/web-interface/nav')
const isArc = (u) => u.includes('/space/wbi/arc/search')

/** 假 get：按 URL 匹配预设回复；没预设的 URL 直接抛（等于"网络炸了"，也顺手验路由写错的情况） */
function fakeGet(routes) {
  const calls = []
  const get = async (url, headers) => {
    calls.push({ url, headers })
    for (const [re, reply] of routes) if (re.test(url)) return typeof reply === 'function' ? reply(url, headers) : reply
    throw new Error(`测试没给这个 URL 准备回复：${url}`)
  }
  return { get, calls }
}

/** 抓住 console.error：失败必须"出声"（不静默）—— 这条要求本身就是被测行为 */
async function captureErr(fn) {
  const lines = []
  const real = console.error
  console.error = (...a) => { lines.push(a.map((x) => String(x)).join(' ')) }
  try { return { lines, value: await fn() } } finally { console.error = real }
}

// ─────────────────────────────── normalizeWatchUps ───────────────────────────────

test('normalizeWatchUps：空值 → []（"没配" = 这个功能整体不生效）', () => {
  for (const v of [undefined, null, '', '   ', [], 42, true, {}]) {
    assert.deepEqual(normalizeWatchUps(v), [], `${JSON.stringify(v)} 应清成空名单`)
  }
})

test('normalizeWatchUps：字符串 / 字符串数组', () => {
  assert.deepEqual(normalizeWatchUps('黑鸦Heya'), [{ name: '黑鸦Heya', mid: '', topics: [] }])
  assert.deepEqual(normalizeWatchUps(['黑鸦Heya', ' 影视飓风 ']), [
    { name: '黑鸦Heya', mid: '', topics: [] },
    { name: '影视飓风', mid: '', topics: [] },
  ])
})

test('normalizeWatchUps：对象（mid 数字 → 字符串；topics 去重去空；不给默认词）', () => {
  assert.deepEqual(
    normalizeWatchUps([{ name: '黑鸦Heya', mid: 12345, topics: ['DeepSeek', ' DeepSeek ', '', null, 'codex'] }]),
    [{ name: '黑鸦Heya', mid: '12345', topics: ['DeepSeek', 'codex'] }],
  )
  // topics 不是数组就当 []：**不给默认词**，默认值属于上层配置，这里保持中性
  assert.deepEqual(normalizeWatchUps({ name: '影月', mid: 'abc', topics: 'DeepSeek' }),
    [{ name: '影月', mid: '', topics: [] }], '非数字 mid 当没填（免得拼出 mid=abc 的请求）')
  assert.deepEqual(normalizeWatchUps({ name: '黑鸦Heya' }), [{ name: '黑鸦Heya', mid: '', topics: [] }])
})

test('normalizeWatchUps：没有 name 的脏数据一律丢掉', () => {
  assert.deepEqual(normalizeWatchUps([null, 3, {}, { mid: 123 }, { name: '   ' }, '  ']), [])
})

test('normalizeWatchUps：同名 / 同 mid 去重（含 @ 前缀与大小写）', () => {
  const got = normalizeWatchUps([
    { name: '@黑鸦Heya', mid: 12345, topics: ['DeepSeek'] },
    { name: '黑鸦Heya', mid: 999 },   // 同名 → 丢
    { name: 'BLACK', mid: 12345 },    // 同 mid → 丢
    { name: 'black', mid: 777 },      // 大小写不同名 → 丢
    { name: '影视飓风', mid: 888 },
  ])
  assert.deepEqual(got.map((u) => u.name), ['黑鸦Heya', '影视飓风'])
  assert.deepEqual(got[0], { name: '黑鸦Heya', mid: '12345', topics: ['DeepSeek'] })
})

// ───────────────────────────────── resolveMid ───────────────────────────────────

test('resolveMid：查到（优先昵称完全一样的那条，高亮标签要剥掉）', async () => {
  const { get, calls } = fakeGet([[/\/search\/type/, {
    code: 0,
    data: {
      result: [
        { mid: 111, uname: '<em class="keyword">黑鸦</em>Heya的小号', fans: 12 },
        { mid: 222, uname: '<em class="keyword">黑鸦</em>Heya', fans: 98765 },
      ],
    },
  }]])
  const r = await resolveMid('黑鸦Heya', { get })
  assert.deepEqual(r, { mid: '222', name: '黑鸦Heya', fans: 98765 }, 'mid 统一成字符串，昵称要干净')
  assert.match(calls[0].url, /search_type=bili_user/)
  assert.match(calls[0].url, /keyword=%E9%BB%91%E9%B8%A6Heya/, '名字要 encodeURIComponent')
  assert.match(String(calls[0].headers?.referer ?? ''), /search\.bilibili\.com/, 'search 接口要 search 的 referer')
})

test('resolveMid：名字里的空格与 & 必须编码（否则参数被切断）', async () => {
  const { get, calls } = fakeGet([[/\/search\/type/, { code: 0, data: { result: [{ mid: 7, uname: 'A B' }] } }]])
  await resolveMid('A B&C', { get })
  assert.match(calls[0].url, /keyword=A%20B%26C$/)
})

test('resolveMid：deps.headers 注入时不读凭据（给测试/上层用）', async () => {
  const { get, calls } = fakeGet([[/\/search\/type/, { code: 0, data: { result: [{ mid: 1, uname: 'x' }] } }]])
  await resolveMid('x', { get, headers: { referer: 'https://example.test/' } })
  assert.deepEqual(calls[0].headers, { referer: 'https://example.test/' })
})

test('resolveMid：空名字直接 null，一次网络都不打', async () => {
  const { get, calls } = fakeGet([[/./, NAV]])
  assert.equal(await resolveMid('   ', { get }), null)
  assert.equal(calls.length, 0)
})

test('resolveMid：没搜到（空 list）→ null 且出声', async () => {
  const { get } = fakeGet([[/\/search\/type/, { code: 0, data: { result: [] } }]])
  const { value, lines } = await captureErr(() => resolveMid('查无此人', { get }))
  assert.equal(value, null)
  assert.ok(lines.some((l) => l.includes('没搜到')), `要打一行中文原因，实际：${JSON.stringify(lines)}`)
})

test('resolveMid：get 抛错 → null（不 throw）且出声', async () => {
  const get = async () => { throw new Error('fetch failed') }
  const { value, lines } = await captureErr(() => resolveMid('黑鸦Heya', { get }))
  assert.equal(value, null)
  assert.ok(lines.some((l) => l.includes('查 mid 失败')))
})

test('resolveMid：接口 code 非 0（如 -412）→ null 且把 code 念出来', async () => {
  const { get } = fakeGet([[/\/search\/type/, { code: -412, message: '请求被拦截' }]])
  const { value, lines } = await captureErr(() => resolveMid('黑鸦Heya', { get }))
  assert.equal(value, null)
  assert.ok(lines.some((l) => l.includes('-412')))
})

// ──────────────────────────────── latestVideos ──────────────────────────────────

test('latestVideos：正常返回能直接塞进 feed.mjs 的候选池', async () => {
  const { get, calls } = fakeGet([[/web-interface\/nav/, NAV], [/space\/wbi\/arc\/search/, ARC]])
  // 不给 headers → 走模块自己的构造（能读到凭据就带 cookie，读不到就匿名）
  const got = await latestVideos(
    { name: '黑鸦Heya', mid: 12345, topics: ['DeepSeek', '国产大模型', 'codex'] },
    { get, count: 10, now: 1_750_000_000_000 },
  )
  assert.equal(got.length, 3, '没有 bvid 的脏条目要被丢掉')
  // 条目形状就是 feed.mjs 认的那一套（多两个字段：upMid / topics）
  assert.deepEqual(got[0], {
    bv: 'BV1xx411c7mD',
    t: 'DeepSeek 新模型实测',
    d: 754,                     // '12:34' → 秒
    dm: 128,
    play: 23456,
    up: '黑鸦Heya',
    kw: '关注UP',
    pubdate: D('2026-10-20T12:00:00'),
    upMid: '12345',
    topics: ['DeepSeek'],
  })
  assert.equal(got[1].d, 3723, "'1:02:03' → 秒")
  assert.equal(got[1].pubdate, D('2026-10-19T09:00:00'), '只有 ctime 也要认（复用 pubdateOf）')
  assert.deepEqual(got[1].topics, ['codex'], "'Codex' 要能被小写主题词命中")
  assert.equal(got[2].up, '黑鸦Heya', '缺 author 时回落到名单里的昵称')
  assert.equal(got[2].d, 0, 'length 是空串 → 0（不是 NaN）')
  assert.deepEqual(got[2].topics, [])

  const arc = calls.find((c) => isArc(c.url))
  assert.ok(arc, '要打 arc/search')
  assert.match(arc.url, /mid=12345/)
  assert.match(arc.url, /ps=10/)
  assert.match(arc.url, /pn=1/)
  assert.match(arc.url, /order=pubdate/)
  assert.match(arc.url, /wts=1750000000/, '签名时间戳走注入的 now')
  assert.match(arc.url, /w_rid=[0-9a-f]{32}/, 'space 接口必须带 wbi 签名')
  assert.match(String(arc.headers?.referer ?? ''), /space\.bilibili\.com\/12345/, 'space 接口要 space 的 referer')
  assert.ok(!calls.some((c) => isSearch(c.url)), '给了 mid 就不该再搜一次昵称')
  assert.deepEqual(calls.map((c) => (isNav(c.url) ? 'nav' : isArc(c.url) ? 'arc' : '?')), ['nav', 'arc'], '先取密钥再拉投稿')
})

test('latestVideos：没给 mid 时先按昵称查、再拉投稿', async () => {
  const { get, calls } = fakeGet([
    [/\/search\/type/, { code: 0, data: { result: [{ mid: 222, uname: '<em class="keyword">黑鸦</em>Heya' }] } }],
    [/web-interface\/nav/, NAV],
    [/space\/wbi\/arc\/search/, { code: 0, data: { list: { vlist: [{ bvid: 'BV1aa411c7mG', title: '一条', length: '2:00', author: '黑鸦Heya', mid: 222, pubdate: D('2026-10-21T10:00:00') }] } } }],
  ])
  const got = await latestVideos({ name: '黑鸦Heya' }, { get })
  assert.equal(got.length, 1)
  assert.equal(got[0].upMid, '222')
  assert.match(calls.find((c) => isArc(c.url)).url, /mid=222/, '要用刚查到的 mid')
  assert.equal(got[0].d, 120)
})

test('latestVideos：mid 解析不出来 → []，且不去打 arc/search', async () => {
  const { get, calls } = fakeGet([[/\/search\/type/, { code: 0, data: { result: [] } }]])
  const { value, lines } = await captureErr(() => latestVideos({ name: '黑鸦Heya' }, { get }))
  assert.deepEqual(value, [])
  assert.ok(!calls.some((c) => isArc(c.url)), 'mid 都没有就别浪费一次网络')
  assert.ok(lines.some((l) => l.includes('mid 没解析出来')), `要说清楚为什么跳过：${JSON.stringify(lines)}`)
})

test('latestVideos：get 抛错 → []（不 throw）且出声', async () => {
  const get = async () => { throw new Error('socket hang up') }
  const { value, lines } = await captureErr(() => latestVideos({ name: '黑鸦Heya', mid: '12345' }, { get }))
  assert.deepEqual(value, [])
  assert.ok(lines.some((l) => l.includes('跳过')))
})

test('latestVideos：接口 code 非 0 → []（-352 也一样，不硬闯）', async () => {
  const { get } = fakeGet([[/web-interface\/nav/, NAV], [/space\/wbi\/arc\/search/, { code: -352, message: '风控校验失败' }]])
  const { value, lines } = await captureErr(() => latestVideos({ name: '黑鸦Heya', mid: '12345' }, { get }))
  assert.deepEqual(value, [])
  assert.ok(lines.some((l) => l.includes('-352')))
})

test('latestVideos：nav 拿不到签名密钥 → []（不带着没签名的请求硬打）', async () => {
  const { get, calls } = fakeGet([[/web-interface\/nav/, { code: -412, message: '本机被限流了' }]])
  const { value, lines } = await captureErr(() => latestVideos({ name: '黑鸦Heya', mid: '12345' }, { get }))
  assert.deepEqual(value, [])
  assert.ok(!calls.some((c) => isArc(c.url)), '没有 w_rid 的请求打了也是白打')
  assert.ok(lines.some((l) => l.includes('WBI 签名密钥')))
})

test('latestVideos：接口正常但一条都没有 → []（也算"跳过"，不静默）', async () => {
  const { get } = fakeGet([[/web-interface\/nav/, NAV], [/space\/wbi\/arc\/search/, { code: 0, data: { list: { vlist: [] } } }]])
  const { value, lines } = await captureErr(() => latestVideos({ name: '黑鸦Heya', mid: '12345' }, { get }))
  assert.deepEqual(value, [])
  assert.ok(lines.some((l) => l.includes('一条投稿都没拉到')))
})

test('latestVideos：count 夹在 1..50（接口自己的上限）', async () => {
  const psOf = async (count) => {
    const { get, calls } = fakeGet([[/web-interface\/nav/, NAV], [/space\/wbi\/arc\/search/, ARC]])
    await latestVideos({ name: '黑鸦Heya', mid: 12345 }, { get, count })
    return calls.find((c) => isArc(c.url)).url
  }
  assert.match(await psOf(999), /ps=50/)
  assert.match(await psOf(-3), /ps=1/)
  assert.match(await psOf(3), /ps=3/)
})

test('latestVideos：老版形状 data.vlist 也认（接口改名过一次）', async () => {
  const { get } = fakeGet([
    [/web-interface\/nav/, NAV],
    [/space\/wbi\/arc\/search/, { code: 0, data: { vlist: [{ bvid: 'BV1bb411c7mH', title: '老形状', length: '5:06', author: '黑鸦Heya' }] } }],
  ])
  const got = await latestVideos({ name: '黑鸦Heya', mid: '12345' }, { get })
  assert.equal(got.length, 1)
  assert.equal(got[0].d, 306)
})

// ────────────────────────── topicHitsOf / describeWatchUps ──────────────────────

test('topicHitsOf：英文大小写 / 中文 / 未命中 / 空词', () => {
  const topics = ['DeepSeek', '国产大模型', 'codex']
  assert.deepEqual(topicHitsOf('实测 deepseek 的新定价', topics), ['DeepSeek'], '大小写不敏感')
  assert.deepEqual(topicHitsOf('Codex CLI 一周体验', topics), ['codex'], '大小写不敏感（反向）')
  assert.deepEqual(topicHitsOf('聊聊国产大模型的现状', topics), ['国产大模型'], '中文直接 includes')
  assert.deepEqual(topicHitsOf('DeepSeek 与 codex', topics), ['DeepSeek', 'codex'], '按传入顺序')
  assert.deepEqual(topicHitsOf('我的一天', topics), [], '没命中 → 空数组')
  assert.deepEqual(topicHitsOf('任意标题', ['', '   ', null]), [], '空词不许"命中一切"')
  assert.deepEqual(topicHitsOf('', topics), [])
  assert.deepEqual(topicHitsOf('DeepSeek', 'DeepSeek'), [], 'topics 不是数组 → 空')
  assert.deepEqual(topicHitsOf('x', ['X', 'x']), ['X'], '同一个词只算命中一次')
})

test('describeWatchUps：有内容 / 空', () => {
  assert.equal(
    describeWatchUps([{ name: '黑鸦Heya', mid: '12345', topics: ['DeepSeek', '国产大模型', 'codex'] }]),
    '重点关注：黑鸦Heya（DeepSeek · 国产大模型 · codex）',
  )
  assert.equal(describeWatchUps([{ name: '无主题的UP' }]), '重点关注：无主题的UP')
  assert.equal(describeWatchUps([{ name: 'A' }, { name: 'B', topics: ['x'] }]), '重点关注：A、B（x）')
  assert.equal(describeWatchUps('黑鸦Heya'), '重点关注：黑鸦Heya', '传原始配置值也认')
  for (const v of [[], null, undefined, '', [{ name: '  ' }, null]]) {
    assert.equal(describeWatchUps(v), '', '空名单要返回空串（调用方就不用判空）')
  }
})
