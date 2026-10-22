// 设置页前端（lib/client.js）的冒烟测试
//   为什么需要它：client.js 是在浏览器里跑的一坨 JSX-less 的 h(...) 树，
//   `node --check` 只能查语法，查不出"渲染时引用了不存在的变量"（2026-10-22 就踩过
//   `setKeyState` 写成不存在的 setter —— 语法合法、点一下设置页就炸）✗
//   这里用假 React + 假 __ModuleLoader__ 把整个 section **真渲染一遍**：
//   不验像素，只验"能渲染、新字段在、不抛异常" ✓
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CODE = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')

// 真实默认配置当"已加载的配置"喂进去 —— 组件里到处 cfg.xxx.yyy，形状必须完整 ✓
const {config} = await import('../tools/lib/config.mjs')
const CFG = JSON.parse(JSON.stringify(config()))

function makeReact() {
  // 渲染计数：主要用来确认「确实渲染到了模型组」而不是空树 ✓
  const rendered = []
  const createElement = (type, props, ...children) => {
    const p = {...(props || {})}
    if (children.length) p.children = children.length === 1 ? children[0] : children
    if (typeof type === 'function') {
      rendered.push(typeof type === 'function' ? type.name : String(type))
      const out = type({...p, children: p.children})
      return {__component: type.name || 'anon', out}
    }
    return {type, props: p}
  }
  const useState = (init) => [init === null || init === undefined ? CFG : init, () => {}]
  const noop = () => {}
  const api = {
    createElement,
    useState,
    useEffect: noop,
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (v) => ({current: v}),
    Fragment: 'Fragment',
    __rendered: rendered,
  }
  return api
}

const React = makeReact()
let mod = null
globalThis.window = {
  __ModuleLoader__: {
    load(def) {
      mod = def.factory((name) => {
        if (name === 'react') return React
        throw new Error('未知模块：' + name)
      })
    },
  },
}
// 动态执行 client.js（它依赖 window.__ModuleLoader__ 这个全局，不能 import）
const fn = new Function('window', 'module', 'exports', 'require', CODE)
fn(globalThis.window, {exports: {}}, {}, (name) => (name === 'react' ? React : null))

test('client.js 能被加载并导出 section', () => {
  assert.ok(mod, '模块没有被 __ModuleLoader__ 收到')
  assert.equal(typeof mod.apply, 'function')
  assert.equal(typeof mod.BiliWhaleSection, 'function')
  assert.ok(Array.isArray(mod.FIELDS) && mod.FIELDS.length > 20, 'FIELDS 太少了，可能没加载全')
})

test('FIELDS 里不能有模型键（provider/模型是动态的，不能写死成静态字段）', () => {
  const keys = mod.FIELDS.map((f) => f.key)
  for (const k of ['model.provider', 'model.model', 'model.reasoningEffort', 'model.apiKeyEnv', 'model.enabled']) {
    assert.equal(keys.includes(k), false, `${k} 应该由 ModelEditor 动态渲染，不该进 FIELDS`)
  }
})

test('整页渲染不抛异常，并且渲染到了「模型与密钥」组', () => {
  const tree = React.createElement(mod.BiliWhaleSection, {})
  assert.ok(tree && typeof tree === 'object', '渲染没有返回树')
  const names = React.__rendered
  assert.ok(names.includes('ModelEditor'), '渲染树里没有 ModelEditor —— 新组没接进页面')
  // 模型组是独立组件，能渲染到就说明它的所有 hook / 字段访问都没炸 ✓
})

test('渲染树里能找到「模型与密钥」标题与 API 密钥输入框', () => {
  const collected = []
  const walk = (node) => {
    if (node == null) return
    if (Array.isArray(node)) return node.forEach(walk)
    if (typeof node !== 'object') { collected.push(node); return }
    if (node.__component) return walk(node.out)
    if (node.props) {
      if (typeof node.props.children !== 'undefined') walk(node.props.children)
      if (typeof node.props.placeholder === 'string') collected.push(node.props.placeholder)
    }
    if (node.type) collected.push(node.type)
  }
  walk(React.createElement(mod.BiliWhaleSection, {}))
  const text = collected.filter((x) => typeof x === 'string').join('|')
  assert.match(text, /模型与密钥/, '页面上没有「模型与密钥」标题')
  assert.match(text, /TENCENT_API_KEY/, '页面上没有密钥引用名输入提示')
})
