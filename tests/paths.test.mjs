// 数据目录可搬家（2026-10-23）：$MYILIDEPU_DATA_DIR / 配置 paths.dataDir / 默认 $DSH_HOME/myilidepu
//
// 为什么用子进程测：DATA_DIR 是模块级 const，进程内只能有一个值。
//   这里用 `node -e` 起一个干净进程，把不同的 env / 配置文件喂给 tools/lib/paths.mjs，
//   断言它算出来的 DATA_DIR 和 dataDirSource() —— 也就是"她到底写到哪个盘"。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const MOD = path.join(ROOT, 'tools', 'lib', 'paths.mjs')
const NODE = process.execPath

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `myilidepu-paths-${tag}-`))
}

/** 在干净子进程里 import paths.mjs，返回 { dataDir, source }。 */
function probe(env = {}) {
  const code = [
    `import { DATA_DIR, dataDirSource } from ${JSON.stringify(pathToFileURL(MOD).href)}`,
    `console.log(JSON.stringify({ dataDir: DATA_DIR, source: dataDirSource() }))`,
  ].join('\n')
  const out = execFileSync(NODE, ['--input-type=module', '-e', code], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
  return JSON.parse(String(out).trim().split(/\r?\n/).pop())
}

/** 造一个 DSH home + 可选配置文件，返回 { env, cfgPath }。 */
function sandbox(tag, userConfig) {
  const dsh = tmpDir(tag)
  const cfgPath = path.join(dsh, 'myilidepu.config.json')
  if (userConfig !== undefined) {
    const body = typeof userConfig === 'string' ? userConfig : JSON.stringify(userConfig, null, 2)
    fs.writeFileSync(cfgPath, body, 'utf8')
  }
  return {
    env: { DSH_HOME: dsh, MYILIDEPU_CONFIG: cfgPath, MYILIDEPU_DATA_DIR: '', BILI_WHALE_CONFIG: '' },
    cfgPath,
    dsh,
  }
}

test('默认：数据目录跟着 DSH_HOME 走', () => {
  const { env, dsh } = sandbox('default')
  const r = probe(env)
  assert.equal(r.source, 'default')
  assert.equal(r.dataDir, path.join(dsh, 'myilidepu'))
})

test('配置文件 paths.dataDir 生效（搬家到别的盘）', () => {
  const target = path.join(tmpDir('target'), 'MyDepu')
  const { env } = sandbox('cfg', { paths: { dataDir: target } })
  const r = probe(env)
  assert.equal(r.source, 'config')
  assert.equal(r.dataDir, path.resolve(target))
})

test('环境变量优先级高于配置文件', () => {
  const fromCfg = path.join(tmpDir('cfgv'), 'from-config')
  const fromEnv = path.join(tmpDir('envv'), 'from-env')
  const { env } = sandbox('env', { paths: { dataDir: fromCfg } })
  const r = probe({ ...env, MYILIDEPU_DATA_DIR: fromEnv })
  assert.equal(r.source, 'env')
  assert.equal(r.dataDir, path.resolve(fromEnv))
})

test('配置文件带 BOM 也能读到 paths.dataDir（记事本/PowerShell 5.1 存的）', () => {
  const target = path.join(tmpDir('bom'), 'MyDepu')
  const { env, cfgPath } = sandbox('bom')
  fs.writeFileSync(cfgPath, '\uFEFF' + JSON.stringify({ paths: { dataDir: target } }), 'utf8')
  const r = probe(env)
  assert.equal(r.source, 'config')
  assert.equal(r.dataDir, path.resolve(target))
})

test('配置文件坏了/没有 paths 时安静回落到默认（不让插件的路径解析崩掉）', () => {
  const broken = sandbox('broken', '{ 这不是 JSON')
  assert.equal(probe(broken.env).source, 'default')

  const noPaths = sandbox('nopaths', { persona: { name: '小鱼' } })
  assert.equal(probe(noPaths.env).source, 'default')

  const empty = sandbox('emptycfg', { paths: { dataDir: '   ' } })
  assert.equal(probe(empty.env).source, 'default')
})

test('相对路径按绝对路径解析（避免"当前目录"跟着调用者跑）', () => {
  const { env } = sandbox('rel', { paths: { dataDir: 'relative/MyDepu' } })
  const r = probe(env)
  assert.equal(r.source, 'config')
  assert.equal(r.dataDir, path.resolve('relative/MyDepu'))
})
