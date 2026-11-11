// 模型与密钥（2026-10-22 主人要求：「能够选择模型和 sk 密钥」）
//   为什么单独一个文件：这两条路由**依赖宿主服务**（llm / credentials / sessionController），
//   要能给它们喂"假宿主"才验得动。这里验的是**接线对不对**，不是真去调模型 ✓
//   重点守两件事：
//     ① 换模型只打她自己的会话（sessionId=myilidepu），不碰全局默认
//     ② 密钥值**绝不**进响应、也绝不进插件配置文件 —— 只存"引用名" ✓
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {test, after} from 'node:test'
import {Readable} from 'node:stream'

// 配置隔离：必须在 import lib/index.js **之前**设 —— paths.mjs 在模块加载时就定了 DSH_HOME ✓
const BOX = fs.mkdtempSync(path.join(os.tmpdir(), 'myilidepu-model-'))
process.env.DSH_HOME = path.join(BOX, 'dsh')
fs.mkdirSync(process.env.DSH_HOME, {recursive: true})
// 「DSH 本地密钥」测试夹具：凭据库文件（只枚举名字，值不该出现在任何响应里）✓
const FAKE_TENCENT = 'sk-fake-tencent-' + Date.now()
const FAKE_DEEPSEEK = 'sk-fake-deepseek-' + Date.now()
const FAKE_ORPHAN = 'sk-fake-orphan-' + Date.now()
fs.writeFileSync(path.join(process.env.DSH_HOME, '.credentials.yaml'), [
  'version: 1',
  'refs:',
  `  TENCENT_API_KEY: ${FAKE_TENCENT}`,
  `  DEEPSEEK_API_KEY: ${FAKE_DEEPSEEK}`,
  `  ORPHAN_API_KEY: ${FAKE_ORPHAN}`,
  'records: {}',
  '',
].join('\n'), 'utf8')
const CONFIGURED = ['TENCENT_API_KEY', 'DEEPSEEK_API_KEY', 'ORPHAN_API_KEY']

// 调度器会在 apply() 里起定时器；测试里把定时器打桩，避免进程挂住 ✓
//   注意返回对象要带 unref/ref：有些代码会对句柄调 .unref()，返回 undefined 会炸 ✓
const fakeHandle = () => ({unref() {}, ref() {}})
globalThis.setInterval = fakeHandle
globalThis.setTimeout = fakeHandle
globalThis.clearInterval = () => {}
globalThis.clearTimeout = () => {}

const calls = {selectModel: [], set: [], unset: []}
const llmStub = {
  listProviders: () => [{id: 'tencent', name: '腾讯'}, {id: 'deepseek', name: 'DeepSeek'}],
  listModels: async (id) => (id === 'tencent' ? [{id: 'deepseek-v4.1-flash', name: 'V4.1 Flash'}] : []),
  resolveModelInfo: async () => ({reasoning: {efforts: [{id: 'low', name: '低'}, {id: 'max', name: '最大'}]}}),
}
const credStub = {
  describe: async (ref) => ({configured: CONFIGURED.includes(ref), source: 'file', writable: true}),
  set: async (ref, value) => { calls.set.push([ref, value]) },
  unset: async (ref) => { calls.unset.push(ref) },
}
// configEditor：provider 到底**实际引用**哪个凭据名（真实来源是 profile 的 apiKeyEnv）✓
const editorStub = {
  configuration: () => [{
    entry: {options: {id: 'llm-pi-ai', config: {providers: {
      tencent: {displayName: '腾讯', apiKeyEnv: 'TENCENT_API_KEY', models: ['deepseek-v4.1-flash']},
      deepseek: {displayName: 'DeepSeek 官方', apiKeyEnv: 'DEEPSEEK_API_KEY', models: ['deepseek-chat']},
    }}}},
  }],
}
const scStub = {
  selectModel: async (arg) => { calls.selectModel.push(arg); return {provider: arg.provider, model: arg.model} },
}
const services = {
  llm: llmStub,
  credentials: credStub,
  sessionController: scStub,
  configEditor: editorStub,
  // 信任栅栏：真实宿主里由 connection 服务提供，缺失时插件按 fail-closed 拒绝（503）✓
  connection: {requestRejection: () => null},
}

const {default: plugin} = await import('../lib/index.js')
const routes = new Map()
plugin.apply({
  get: (name) => services[name],
  webServer: {register(r) { routes.set(r.path, r.handler); return () => {} }},
  effect: () => {},
})

async function call(p, {method = 'GET', body = {}} = {}) {
  // 路由表按 pathname 注册；查询串只影响 handler 里自己解析 ✓
  const pathname = p.split('?')[0]
  const handler = routes.get(pathname)
  assert.ok(handler, `路由没注册：${pathname}`)
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = method
  req.headers = {host: '127.0.0.1:1234'}
  req.url = p
  const out = {status: 200, text: ''}
  const res = {
    statusCode: 200,
    writeHead(code) { this.statusCode = code },
    end(text) { out.status = this.statusCode; out.text = text == null ? '' : String(text) },
  }
  await handler(req, res)
  let data = null
  try { data = JSON.parse(out.text) } catch {}
  return {status: out.status, data, text: out.text}
}

const cfgFile = () => path.join(process.env.DSH_HOME, 'myilidepu.config.json')

test('GET /model：给出 provider 目录、模型列表、推理档与"配没配"', async () => {
  const r = await call('/dsh-bili/api/model')
  assert.equal(r.status, 200)
  assert.equal(r.data.ok, true)
  assert.deepEqual(r.data.providers.map((p) => p.id), ['tencent', 'deepseek'])
  assert.deepEqual(r.data.providers[0].models.map((m) => m.id), ['deepseek-v4.1-flash'])
  assert.deepEqual(r.data.providers[1].models, [])
  assert.ok(r.data.suggestedRefs.includes('TENCENT_API_KEY'), '应能猜出引用名')
  assert.deepEqual(r.data.services, {llm: true, credentials: true, sessionController: true, configEditor: true})
  assert.equal(r.data.sessionId, 'myilidepu')
})

test('GET /model?provider=&model=：换下拉时立刻查该模型的推理档', async () => {
  const r = await call('/dsh-bili/api/model?provider=tencent&model=deepseek-v4.1-flash')
  assert.equal(r.status, 200)
  assert.deepEqual(r.data.efforts.map((e) => e.id), ['low', 'max'])
})

test('POST /model：开了「用指定模型」却缺 provider/model → 400（别存个坏配置）', async () => {
  const r = await call('/dsh-bili/api/model', {method: 'POST', body: {model: {enabled: true}}})
  assert.equal(r.status, 400)
  assert.match(r.data.error, /provider/)
})

test('POST /model：保存并按她自己的会话应用（sessionId 不是全局默认）', async () => {
  const r = await call('/dsh-bili/api/model', {
    method: 'POST',
    body: {apply: true, model: {enabled: true, provider: 'tencent', model: 'deepseek-v4.1-flash', reasoningEffort: 'max', apiKeyEnv: 'TENCENT_API_KEY'}},
  })
  assert.equal(r.status, 200)
  assert.equal(r.data.model.provider, 'tencent')
  assert.equal(r.data.model.reasoningEffort, 'max')
  assert.equal(r.data.applied, true)
  assert.equal(calls.selectModel.length, 1)
  assert.deepEqual(calls.selectModel[0], {
    sessionId: 'myilidepu', provider: 'tencent', model: 'deepseek-v4.1-flash', reasoningEffort: 'max',
  })
  assert.deepEqual(r.data.efforts.map((e) => e.id), ['low', 'max'])
  // 落盘的是配置本身（不含 __ 内部字段）
  const saved = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'))
  assert.equal(saved.model.model, 'deepseek-v4.1-flash')
  assert.equal(saved.model.apiKeyEnv, 'TENCENT_API_KEY')
})

test('POST /model：推理档只认白名单，不在表内的值落成"默认"', async () => {
  const r = await call('/dsh-bili/api/model', {method: 'POST', body: {model: {reasoningEffort: 'ultra'}}})
  assert.equal(r.status, 200)
  assert.equal(r.data.model.reasoningEffort, '')
})

test('POST /model/key：引用名格式不对 → 400', async () => {
  const r = await call('/dsh-bili/api/model/key', {method: 'POST', body: {ref: '9BAD-NAME', value: 'x'}})
  assert.equal(r.status, 400)
  assert.match(r.data.error, /引用名/)
})

test('POST /model/key：缺 ref → 400', async () => {
  const r = await call('/dsh-bili/api/model/key', {method: 'POST', body: {value: 'x'}})
  assert.equal(r.status, 400)
})

test('POST /model/key：写入走 DSH 凭据库 —— 响应里没有密钥，配置文件里也没有', async () => {
  const secret = 'sk-very-secret-' + Date.now()
  const r = await call('/dsh-bili/api/model/key', {method: 'POST', body: {ref: 'TENCENT_API_KEY', value: secret}})
  assert.equal(r.status, 200)
  assert.equal(r.data.ok, true)
  assert.deepEqual(calls.set, [['TENCENT_API_KEY', secret]])
  assert.equal(r.text.includes(secret), false, '响应体绝不能回显密钥')
  assert.equal(r.data.key.configured, true, '只回"配没配"')
  const cfg = fs.readFileSync(cfgFile(), 'utf8')
  assert.equal(cfg.includes(secret), false, '插件配置文件里绝不能有密钥')
  assert.match(cfg, /TENCENT_API_KEY/, '只记引用名')
})

test('POST /model/key：删除 → 清引用名、不残留', async () => {
  const r = await call('/dsh-bili/api/model/key', {method: 'POST', body: {ref: 'TENCENT_API_KEY', action: 'unset'}})
  assert.equal(r.status, 200)
  assert.deepEqual(calls.unset, ['TENCENT_API_KEY'])
  const saved = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'))
  assert.equal(saved.model.apiKeyEnv, '')
})

test('旧接口路径别名 /dsh-myilidepu/api/model 仍然可用', async () => {
  const r = await call('/dsh-myilidepu/api/model')
  assert.equal(r.status, 200)
  assert.equal(r.data.ok, true)
})

test('宿主没有 llm 服务时：目录标错但页面不 500（灰掉而不是白屏）', async () => {
  delete services.llm
  const r = await call('/dsh-bili/api/model')
  assert.equal(r.status, 200)
  assert.match(String(r.data.catalogError), /llm/)
  assert.deepEqual(r.data.providers, [])
  services.llm = llmStub   // 还原，别影响后续
})

test('宿主不支持会话级换模型时：保存成功但 applied=false + 给出原因', async () => {
  delete services.sessionController
  const r = await call('/dsh-bili/api/model', {method: 'POST', body: {apply: true, model: {enabled: true, provider: 'tencent', model: 'deepseek-v4.1-flash'}}})
  assert.equal(r.status, 200)
  assert.equal(r.data.applied, false)
  assert.match(String(r.data.applyError), /sessionController/)
  services.sessionController = scStub
})

// ── 「导入 DSH 本地密钥」与「切换模型」（2026-11-11）────────────────────────────
//   主人原话：「由于有时候 api 密钥会出现失效的情况，所以在插件中加入可以导入 dsh 本地的
//   apikey 和切换模型的功能」
//   守的两条底线：① 只碰名字/状态，凭据值一个字节都不回显；② provider 必须真的引用那个名字，
//   否则"导入成功"是假象（宿主调用模型仍会用别的 ref）✗

test('GET /model：列出本机密钥名字（只有名字，一个值都不回显）', async () => {
  const r = await call('/dsh-bili/api/model')
  assert.equal(r.status, 200)
  const lk = r.data.localKeys
  assert.ok(lk, '响应里要有 localKeys')
  assert.deepEqual(lk.refs.map((x) => x.ref).sort(), ['DEEPSEEK_API_KEY', 'ORPHAN_API_KEY', 'TENCENT_API_KEY'])
  assert.equal(lk.configEditor.available, true)
  assert.equal(lk.refs.find((x) => x.ref === 'TENCENT_API_KEY').bound, true)
  assert.equal(lk.refs.find((x) => x.ref === 'ORPHAN_API_KEY').configured, true)
  assert.equal(lk.refs.find((x) => x.ref === 'ORPHAN_API_KEY').bound, false)
  for (const secret of [FAKE_TENCENT, FAKE_DEEPSEEK, FAKE_ORPHAN]) {
    assert.equal(r.text.includes(secret), false, '响应体里绝不能出现凭据值')
  }
})

test('POST /model/import：把凭据库里已有的名字接上，并切到真正引用它的 provider', async () => {
  const r = await call('/dsh-bili/api/model/import', {method: 'POST', body: {ref: 'DEEPSEEK_API_KEY'}})
  assert.equal(r.status, 200)
  assert.equal(r.data.ok, true)
  assert.equal(r.data.model.provider, 'deepseek', '有 provider 真的引用这个名 → 切过去')
  assert.equal(r.data.model.model, 'deepseek-chat', '模型用该 provider 声明的第一个')
  assert.equal(r.data.model.apiKeyEnv, 'DEEPSEEK_API_KEY')
  assert.equal(r.data.model.enabled, true)
  assert.equal(r.data.applied, true)
  assert.equal(calls.selectModel.at(-1).provider, 'deepseek')
  assert.equal(calls.selectModel.at(-1).sessionId, 'myilidepu')
  assert.match(r.data.detail, /已接上/)
  for (const secret of [FAKE_TENCENT, FAKE_DEEPSEEK, FAKE_ORPHAN]) assert.equal(r.text.includes(secret), false)
})

test('POST /model/import：凭据库里没值的引用名 → 400（别存个"看起来配好了"的坏配置）', async () => {
  const r = await call('/dsh-bili/api/model/import', {method: 'POST', body: {ref: 'NOPE_API_KEY'}})
  assert.equal(r.status, 400)
  assert.match(r.data.error, /凭据库里没有/)
  // 配置不能被改坏：仍然指着上一个能用的组合
  const saved = JSON.parse(fs.readFileSync(cfgFile(), 'utf8'))
  assert.equal(saved.model.apiKeyEnv, 'DEEPSEEK_API_KEY')
})

test('POST /model/import：没有任何 provider 引用这个名字 → 409 + 说清为什么', async () => {
  const r = await call('/dsh-bili/api/model/import', {method: 'POST', body: {ref: 'ORPHAN_API_KEY'}})
  assert.equal(r.status, 409)
  assert.match(r.data.error, /没有被 provider/)
  assert.match(r.data.error, /没有任何 provider 引用它/)
})

test('POST /model/switch：只切模型，验真后热生效（密钥引用名跟着 provider 走）', async () => {
  const r = await call('/dsh-bili/api/model/switch', {
    method: 'POST',
    body: {provider: 'tencent', model: 'deepseek-v4.1-flash', reasoningEffort: 'max'},
  })
  assert.equal(r.status, 200)
  assert.equal(r.data.applied, true)
  assert.equal(r.data.model.provider, 'tencent')
  assert.equal(r.data.model.apiKeyEnv, 'TENCENT_API_KEY')
  assert.equal(r.data.model.reasoningEffort, 'max')
  assert.deepEqual(r.data.efforts.map((e) => e.id), ['low', 'max'])
  assert.deepEqual(calls.selectModel.at(-1), {
    sessionId: 'myilidepu', provider: 'tencent', model: 'deepseek-v4.1-flash', reasoningEffort: 'max',
  })
})

test('POST /model/switch：模型 id 改过名 → 自动校正成同一 provider 还在的那个', async () => {
  const r = await call('/dsh-bili/api/model/switch', {
    method: 'POST',
    body: {provider: 'tencent', model: 'deepseek-v4.1-flash-OLD'},
  })
  assert.equal(r.status, 200)
  assert.equal(r.data.model.model, 'deepseek-v4.1-flash')
  assert.notEqual(r.data.warn, null, '要告诉用户"自动换过"')
  assert.match(String(r.data.warn), /已经没有/)
  assert.match(r.data.detail, /已切到/)
})

test('GET /model：configEditor 不可用时，provider 绑定退回按名字猜，页面不炸', async () => {
  delete services.configEditor
  const r = await call('/dsh-bili/api/model')
  assert.equal(r.status, 200)
  assert.equal(r.data.localKeys.configEditor.available, false)
  const tencent = r.data.localKeys.refs.find((x) => x.ref === 'TENCENT_API_KEY')
  assert.equal(tencent.guessed, true, '没有权威来源就标"猜的"')
  assert.equal(tencent.bound, false)
  services.configEditor = editorStub
})

// 清理必须放在 after() 里：顶层 rmSync 会在**测试开跑之前**就把隔离目录（含 .credentials.yaml
// 夹具）删掉 —— 文件级 test() 只是注册，顶层代码先跑完才执行用例（2026-11-11 踩过 ✗）
after(() => fs.rmSync(BOX, {recursive: true, force: true}))
