// 模型 id 验真 + 兜底（v1.5.1）
//
//   病的形状：provider 把 `deepseek-v4.1-flash` 改名成 `deepseek-v4.1-flash-1017`，
//   她那个会话里存的还是旧 id → 每次醒来 prompt 直接在起跑线被拒：
//     pi-ai provider "tencent" has no configured model "deepseek-v4.1-flash"
//   而且不会自愈（没人重新 selectModel），能连着瘫好几天 ✗
//
//   这里钉住的是**换模型的决策**：同 provider 优先（换 provider 等于换凭据，
//   很可能直接没 key），换了一定说清理由；一个能用的都没有就老实返回 null。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {test} from 'node:test'

import {
  parseUnknownModel,
  isUnknownModelError,
  normalizeProviders,
  pickValidModel,
  describePick,
} from '../lib/model-pick.mjs'

// 真机上的形状（2026-11-04 从她的会话日志里抠出来的原文）
const REAL = 'pi-ai provider "tencent" has no configured model "deepseek-v4.1-flash"'

const CATALOG = [
  {id: 'tencent', models: [{id: 'deepseek-v4.1-flash-1017'}, {id: 'glm-5.3'}, {id: 'kimi-k3'}]},
  {id: 'deepseek-official', models: [{id: 'deepseek-chat'}]},
]

test('parseUnknownModel：从真机原文里抠得出 provider 与 model', () => {
  assert.deepEqual(parseUnknownModel(REAL), {provider: 'tencent', model: 'deepseek-v4.1-flash', code: 'UNKNOWN_MODEL'})
})

test('parseUnknownModel：别的报错一律 null（不能见错误就换模型）', () => {
  assert.equal(parseUnknownModel('network timeout'), null)
  assert.equal(parseUnknownModel('credentials missing'), null)
  assert.equal(parseUnknownModel(''), null)
  assert.equal(parseUnknownModel(undefined), null)
})

test('isUnknownModelError：只认"模型不认识"，其它错误不许触发重试', () => {
  assert.equal(isUnknownModelError(REAL), true)
  assert.equal(isUnknownModelError('code: UNKNOWN_MODEL'), true)
  assert.equal(isUnknownModelError('unknown model "x" for provider "y"'), true)
  assert.equal(isUnknownModelError('429 rate limited'), false)
  assert.equal(isUnknownModelError('ECONNRESET'), false)
})

test('normalizeProviders：脏数据丢掉，字符串与对象两种模型写法都认', () => {
  const got = normalizeProviders([
    {id: 'a', models: [{id: 'm1'}, 'm2', {id: 'm1'}, {name: '没有 id'}]},
    {provider: 'b', models: []},
    {models: [{id: 'x'}]},            // 没有 id 的 provider → 丢
    null,
    {id: '', models: ['y']},
  ])
  assert.deepEqual(got, [{id: 'a', models: ['m1', 'm2']}, {id: 'b', models: []}])
})

test('pickValidModel：配的模型还在 → 原样用，不算"换过"', () => {
  const p = pickValidModel(CATALOG, {provider: 'tencent', model: 'deepseek-v4.1-flash-1017'})
  assert.equal(p.provider, 'tencent')
  assert.equal(p.model, 'deepseek-v4.1-flash-1017')
  assert.equal(p.healed, false)
})

test('pickValidModel：模型被改名了 → 换成**同一 provider** 的第一个（不换 provider = 不换凭据）', () => {
  const p = pickValidModel(CATALOG, {provider: 'tencent', model: 'deepseek-v4.1-flash'})
  assert.equal(p.provider, 'tencent', '必须留在 tencent，否则可能直接没 key ✗')
  assert.equal(p.model, 'deepseek-v4.1-flash-1017')
  assert.equal(p.healed, true)
  assert.match(p.reason, /已经没有/)
})

test('pickValidModel：provider 整个没了 → 跟着这个 model 去别的 provider', () => {
  const p = pickValidModel(CATALOG, {provider: 'gone', model: 'glm-5.3'})
  assert.equal(p.provider, 'tencent')
  assert.equal(p.model, 'glm-5.3')
  assert.equal(p.healed, true)
})

test('pickValidModel：provider 与 model 都不存在 → 兜底第一个有模型的 provider', () => {
  const p = pickValidModel(CATALOG, {provider: 'gone', model: 'nope'})
  assert.equal(p.provider, 'tencent')
  assert.equal(p.model, 'deepseek-v4.1-flash-1017')
  assert.equal(p.healed, true)
})

test('pickValidModel：一个模型都没有 → null（调用方不许硬试）', () => {
  assert.equal(pickValidModel([], {provider: 'tencent', model: 'x'}), null)
  assert.equal(pickValidModel([{id: 'a', models: []}], {provider: 'a', model: 'x'}), null)
  assert.equal(pickValidModel(null, {}), null)
})

test('pickValidModel：没点名 provider 时，同 provider 的第一个也能用（默认路径）', () => {
  const p = pickValidModel(CATALOG, {})
  assert.equal(p.provider, 'tencent')
  assert.equal(p.model, 'deepseek-v4.1-flash-1017')
  assert.equal(p.healed, true)
})

test('describePick：换过要写理由，没换也要能读', () => {
  assert.match(describePick(pickValidModel(CATALOG, {provider: 'tencent', model: 'glm-5.3'})), /tencent\/glm-5\.3（配置的模型还在）/)
  assert.match(describePick(pickValidModel(CATALOG, {provider: 'tencent', model: 'old'})), /已自动换/)
  assert.match(describePick(null), /没有可用模型/)
})

// 源码契约：光有纯函数没用，得真接进醒来那条路 ✓
//   ① 四处投递（醒来 / 私信 / 监听 / 直播间）都必须走 sendPrompt；
//   ② 醒来前必须验真（pickValidModel），否则 provider 一改名又瘫。
test('源码契约：scheduler 的投递都走 sendPrompt，且醒来前验真', () => {
  const src = fs.readFileSync(new URL('../lib/scheduler.js', import.meta.url), 'utf8')
  assert.match(src, /from '\.\/model-pick\.mjs'/, '要真的 import model-pick')
  // sendPrompt 内部的两处直调之外，别处不许绕过它直接调 prompt ✗
  assert.equal(
    (src.match(/await ctx\.sessionController\.prompt\(/g) || []).length,
    2,
    '只有 sendPrompt 内部可以直接调 prompt；四处投递点必须走 sendPrompt',
  )
  assert.equal((src.match(/await sendPrompt\(/g) || []).length, 4, '醒来 / 私信 / 监听 / 直播间四处都要接上')
  assert.match(src, /pickValidModel\(cat, want\)/, '醒来前要验真配置的模型还在不在')
  assert.match(src, /isUnknownModelError\(msg\)/, '撞上 UNKNOWN_MODEL 才自救（别的错不重试）')
})
