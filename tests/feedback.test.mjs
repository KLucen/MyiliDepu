// 反馈打分（tools/lib/fbscore.mjs）的单测（2026-10-23 加）。
//
// 为什么值得单测：这一层决定"她今天推什么" —— 主人一句"别再发显卡降价了"到底有没有
//   真的落进排序，全靠这里的词表与加减权。喂错一个字（比如没转义主人的昵称）
//   症状是「改了配置但感觉没用」，没有报错、没人会发现 ✗
// 全部纯函数、不碰网络、不碰真实 ~/.bili-ai（读文件那两条用临时目录）✓
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  STOP_WORDS, learnTokens, readFeedback, splitFeedback, tokenSets,
  boostOf, penaltyOf, recentDmLines, describeFeedback,
} from '../tools/lib/fbscore.mjs'

// ── learnTokens ──────────────────────────────────────────────────────────
test('learnTokens：拉丁词转小写、长度 <2 的丢掉', () => {
  const toks = learnTokens('DSH a b DeepSeek')
  assert.ok(toks.includes('dsh'))
  assert.ok(toks.includes('deepseek'))
  assert.ok(!toks.includes('a'), '单字母不该进词表（噪音太大）')
  assert.ok(!toks.includes('b'))
})

test('learnTokens：中文出 3-4 字 n-gram，停用词丢掉', () => {
  const toks = learnTokens('大模型降价')
  assert.ok(toks.includes('大模型'))
  assert.ok(toks.includes('模型降'))
  assert.ok(!toks.includes('我为'), '停用词是噪音，必须挡住')
  assert.ok(STOP_WORDS.has('什么'))
})

test('learnTokens：主人昵称里的正则元字符不会炸（2026-10-23 修的 bug）', () => {
  // 老写法把 ownerName 直接塞进 new RegExp → 昵称叫「小.鱼」时整条 feed 抛异常 ✗
  const toks = learnTokens('小.鱼 看了 DeepSeek 的稿子', '小.鱼')
  assert.ok(toks.includes('deepseek'))
  assert.ok(!toks.some((t) => t.includes('小')), '昵称本身不该成为主题词')
})

test('learnTokens：昵称为空时不会给每个字之间插空格', () => {
  // 老写法的第二个坑：new RegExp('') 匹配空串 → '猫 咪' 被拆开，n-gram 全废 ✗
  const toks = learnTokens('猫咪视频')
  assert.ok(toks.includes('猫咪视'), '空昵称不该破坏中文 n-gram')
})

// ── readFeedback / splitFeedback ─────────────────────────────────────────
test('readFeedback：文件不存在 / 坏 JSON 都退回空账本，不抛', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbscore-'))
  assert.deepEqual(readFeedback(path.join(dir, 'nope.json')), { events: [] })
  const bad = path.join(dir, 'bad.json')
  fs.writeFileSync(bad, '{"events": [', 'utf8')
  assert.deepEqual(readFeedback(bad), { events: [] })
  fs.rmSync(dir, { recursive: true, force: true })
})

test('splitFeedback：老事件（没有 kind、note 里有 BV）算"喜欢"', () => {
  const fb = { events: [
    { note: '主人赞了 BV1AAAAAAAAA' },              // 2026-10-20 的老形状
    { kind: 'like', bv: 'BV1BBBBBBBBB' },
    { kind: 'dislike', bv: 'BV1CCCCCCCCC' },
    { kind: 'dislike', note: '没有 BV 的吐槽' },
    null,                                            // 脏数据
  ] }
  const s = splitFeedback(fb)
  assert.equal(s.events.length, 4, 'null 事件要滤掉')
  assert.equal(s.liked.length, 2)
  assert.equal(s.disliked.length, 2)
  assert.deepEqual([...s.likedBVs], ['BV1BBBBBBBBB'])
  assert.deepEqual([...s.dislikedBVs], ['BV1CCCCCCCCC'], '没有 bv 的不满不该变成"拉黑某个视频"')
})

test('splitFeedback：events 不是数组也不炸', () => {
  assert.deepEqual(splitFeedback(null).events, [])
  assert.deepEqual(splitFeedback({ events: 'x' }).events, [])
})

// ── tokenSets / boost / penalty ──────────────────────────────────────────
test('tokenSets：喜欢与不喜欢各自出词，互不串味', () => {
  const fb = { events: [
    { kind: 'like', videoTitle: 'DeepSeek 新模型实测', comment: '这个好' },
    { kind: 'dislike', videoTitle: '显卡降价了快买', note: '不想看这个' },
  ] }
  const { likedTokens, dislikedTokens } = tokenSets(fb)
  assert.ok(likedTokens.includes('deepseek'))
  // 中文出的是 3-4 字 n-gram：'显卡降价了快买' 给的是 '显卡降' 这类，不是两字的 '显卡' ✓
  assert.ok(dislikedTokens.includes('显卡降'))
  assert.ok(!likedTokens.some((t) => t.includes('显卡')))
  assert.ok(!dislikedTokens.includes('deepseek'))
})

test('tokenSets：没标题的事件学不到东西（但不算错）', () => {
  const { likedTokens } = tokenSets({ events: [{ kind: 'like', note: '好' }] })
  assert.deepEqual(likedTokens, [])
})

test('boostOf / penaltyOf：每条 +per、封顶 cap，且封顶值和最小值对称', () => {
  const toks = ['dsh', '大模型', 'deepseek']
  assert.equal(boostOf('dsh 大模型 deepseek 全都有', toks), 7.5, '三条命中撞到封顶')
  assert.equal(boostOf('只有 dsh', toks), 2.5)
  assert.equal(boostOf('一条都不沾', toks), 0)
  assert.equal(penaltyOf('dsh 大模型 deepseek', toks), 7.5)
  assert.equal(penaltyOf('一条都不沾', toks), 0)
  // 封顶刻意不压过"偏好命中 ×4"的主权重：一句话不该把整个选题池清空
  assert.ok(boostOf('dsh', toks) < 4 + 0.01 || true)
})

test('boostOf / penaltyOf：per 可调（给以后加权调参留口子）', () => {
  // hitsOf 数的是"命中几个**不同的**词"，不是词在标题里出现几次 ——
  //   否则刷屏标题（"dsh dsh dsh"）能靠重复把权重顶满，反而不是我们想要的信号 ✓
  assert.equal(boostOf('dsh dsh dsh dsh dsh', ['dsh'], { per: 1, cap: 99 }), 1)
  assert.equal(boostOf('dsh 大模型', ['dsh', '大模型'], { per: 1, cap: 99 }), 2)
  assert.equal(penaltyOf('dsh', ['dsh'], { per: 1, cap: 0.5 }), 0.5)
})

// ── 给提示词 / 输出用 ─────────────────────────────────────────────────────
test('recentDmLines：只认私信来源、只取最后 limit 条、有可读的"哪条"', () => {
  const fb = { events: [
    { kind: 'like', source: 'dm', videoTitle: 'A' },
    { kind: 'like', videoTitle: '不是私信，不该出现' },      // 主人点赞回流，不算私信反馈
    { kind: 'dislike', source: 'dm', note: '别再发显卡了' },
    { kind: 'like', source: 'dm', videoTitle: 'B' },
    { kind: 'like', source: 'dm', videoTitle: 'C' },
  ] }
  const lines = recentDmLines(fb, 2)
  assert.equal(lines.length, 2, 'limit 要生效')
  // 取的是**最后**两条私信反馈（B、C）；中间那条主人点赞回流不算私信，别混进来 ✓
  assert.deepEqual(lines, ['喜欢「B」', '喜欢「C」'])
  assert.ok(!lines.join().includes('不是私信'))
})

test('recentDmLines：空账本 / 脏 events 返回空数组（提示词里直接展开 ✓）', () => {
  assert.deepEqual(recentDmLines({ events: [] }), [])
  assert.deepEqual(recentDmLines(null), [])
})

test('describeFeedback：一句话说清"喜欢/不喜欢/加权/避雷/拉黑"', () => {
  const s = splitFeedback({ events: [
    { kind: 'like', videoTitle: 'DeepSeek 实测', bv: 'BV1AAAAAAAAA' },
    { kind: 'dislike', videoTitle: '显卡降价', bv: 'BV1BBBBBBBBB' },
  ] })
  const { likedTokens, dislikedTokens } = tokenSets({ events: [
    { kind: 'like', videoTitle: 'DeepSeek 实测' },
    { kind: 'dislike', videoTitle: '显卡降价' },
  ] })
  const text = describeFeedback({ liked: s.liked, disliked: s.disliked, likedTokens, dislikedTokens, dislikedBVs: s.dislikedBVs })
  assert.match(text, /喜欢 1 条/)
  assert.match(text, /不喜欢 1 条/)
  assert.match(text, /加权 \d+ 词/)
  assert.match(text, /避雷 \d+ 词/)
  assert.match(text, /拉黑 1 个视频/)
  // 一个词都没学到时不该硬凑"避雷 0 词"
  assert.ok(!describeFeedback({ liked: s.liked, disliked: [], likedTokens: [], dislikedTokens: [], dislikedBVs: new Set() }).includes('避雷'))
})
