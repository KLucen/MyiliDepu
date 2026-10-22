// 会话副本去重（2026-10-23 真事故的回归测试）
//
// 事故：她的会话 id 固定（myilidepu），会话目录按 cwd 分桶。数据目录从
// C:\Users\KLucen\.dsh\myilidepu\work 搬到 D:\MyDepu\work 后，同一个 id 在两个
// project 目录里各有一份 → DSH 下次启动时 dsh-workspace 抛
//   "duplicate JSONL session id ... appears in multiple project directories"
// → workspaceRegistry 不激活 → sessionController/workspaceController 全 pending →
// 界面上「会话全没了」。
//
// 这里用真文件（真 zstd 帧）验证：留哪一份、其余搬去哪、以及"谁的 cwd 是现在这个"。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { dedupeSessionCopies, scanSessionCopies, readSessionHeader, sessionsRoot } from '../lib/session-home.js'

const ID = 'myilidepu'

function tmp(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `myilidepu-sess-${tag}-`))
}

/** 造一份会话：<dshHome>/sessions/<bucket>/<id>/session.v4.jsonl.zstd，首帧是 header。 */
function makeSession(dshHome, bucket, { cwd, mtimeMs, id = ID, frames = [] } = {}) {
  const dir = path.join(sessionsRoot(dshHome), bucket, id)
  fs.mkdirSync(dir, { recursive: true })
  const header = { type: 'session', version: 4, id, createdAt: 1792683879210, cwd, isSeeded: false, delegationDepth: 0, agentPreset: 'standard' }
  const body = [JSON.stringify(header), ...frames.map((f) => JSON.stringify(f))].join('\n') + '\n'
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from(body, 'utf8')))
  if (mtimeMs !== undefined) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs))
  return { dir, file }
}

test('首帧就是 header，能读出 id 和 cwd', () => {
  const dsh = tmp('header')
  const { file } = makeSession(dsh, '--A-work--', { cwd: 'A:\\work' })
  const h = readSessionHeader(file)
  assert.equal(h.id, ID)
  assert.equal(h.cwd, 'A:\\work')
})

test('只有一份时不动（singleton）', () => {
  const dsh = tmp('one')
  const { dir } = makeSession(dsh, '--D-MyDepu-work--', { cwd: 'D:\\MyDepu\\work' })
  const q = path.join(tmp('q'), 'orphan')
  const r = dedupeSessionCopies({ sessionId: ID, dshHome: dsh, keepCwd: 'D:\\MyDepu\\work', quarantineRoot: q })
  assert.equal(r.reason, 'singleton')
  assert.equal(r.moved.length, 0)
  assert.ok(fs.existsSync(dir))
  assert.equal(fs.existsSync(q), false, '无重复时不该创建隔离目录')
})

test('两份重复：留下 cwd 相符的那一份，另一份移进隔离区（不删）', () => {
  const dsh = tmp('dup')
  const oldOne = makeSession(dsh, '--C-Users-KLucen-.dsh-myilidepu-work--', { cwd: 'C:\\Users\\KLucen\\.dsh\\myilidepu\\work', mtimeMs: Date.now() - 60_000, frames: [{ n: 1 }] })
  const newOne = makeSession(dsh, '--D-MyDepu-work--', { cwd: 'D:\\MyDepu\\work', mtimeMs: Date.now() })
  const q = path.join(tmp('q'), 'orphan')

  const r = dedupeSessionCopies({ sessionId: ID, dshHome: dsh, keepCwd: 'D:\\MyDepu\\work', quarantineRoot: q })
  assert.equal(r.total, 2)
  assert.equal(r.reason, 'cwd', '应优先认 cwd 相符的那份，而不是 mtime 最新的')
  assert.equal(r.kept.bucket, '--D-MyDepu-work--')
  assert.equal(r.moved.length, 1)
  assert.equal(r.moved[0].ok, true)
  assert.equal(r.moved[0].bucket, '--C-Users-KLucen-.dsh-myilidepu-work--')

  assert.ok(fs.existsSync(newOne.dir), '当前 cwd 的那份要留着')
  assert.equal(fs.existsSync(oldOne.dir), false, '旧桶里不该再有同名会话目录')
  assert.ok(fs.existsSync(r.moved[0].to), '隔离区里应有搬走的那份')
  assert.ok(fs.existsSync(path.join(r.moved[0].to, 'session.v4.jsonl.zstd')), '搬走的是整个会话目录')

  // 去重后再扫一遍：必须回到"每桶至多一份、全局唯一"
  const after = scanSessionCopies(ID, sessionsRoot(dsh))
  assert.equal(after.length, 1)
  assert.equal(after[0].bucket, '--D-MyDepu-work--')
})

test('cwd 都对不上时退化成"留 mtime 最新"，仍然只留一份', () => {
  const dsh = tmp('none')
  makeSession(dsh, '--A-work--', { cwd: 'A:\\work', mtimeMs: Date.now() - 10_000 })
  const newer = makeSession(dsh, '--B-work--', { cwd: 'B:\\work', mtimeMs: Date.now() })
  const q = path.join(tmp('q'), 'orphan')
  const r = dedupeSessionCopies({ sessionId: ID, dshHome: dsh, keepCwd: 'D:\\MyDepu\\work', quarantineRoot: q })
  assert.equal(r.reason, 'newest')
  assert.equal(r.kept.bucket, '--B-work--')
  assert.equal(r.moved.length, 1)
  assert.ok(fs.existsSync(newer.dir))
  assert.equal(scanSessionCopies(ID, sessionsRoot(dsh)).length, 1)
})

test('三份重复也收敛成一份，且第一帧读不出的不参与 cwd 判定', () => {
  const dsh = tmp('three')
  const wanted = makeSession(dsh, '--D-MyDepu-work--', { cwd: 'D:\\MyDepu\\work' })
  makeSession(dsh, '--A-work--', { cwd: 'A:\\work' })
  // 坏文件：只有半个 zstd 块，readSessionHeader 会返回 null，不能因此崩掉
  const broken = path.join(sessionsRoot(dsh), '--B-work--', ID)
  fs.mkdirSync(broken, { recursive: true })
  fs.writeFileSync(path.join(broken, 'session.v4.jsonl.zstd'), Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00]))

  const q = path.join(tmp('q'), 'orphan')
  const r = dedupeSessionCopies({ sessionId: ID, dshHome: dsh, keepCwd: 'D:\\MyDepu\\work', quarantineRoot: q })
  assert.equal(r.total, 3)
  assert.equal(r.reason, 'cwd')
  assert.ok(fs.existsSync(wanted.dir))
  assert.equal(r.moved.length, 2)
  assert.equal(scanSessionCopies(ID, sessionsRoot(dsh)).length, 1)
})

test('sessions 目录不存在时安静返回', () => {
  const dsh = tmp('empty')
  const r = dedupeSessionCopies({ sessionId: ID, dshHome: dsh, keepCwd: 'D:\\MyDepu\\work', quarantineRoot: path.join(tmp('q'), 'x') })
  assert.equal(r.total, 0)
  assert.equal(r.kept, null)
  assert.equal(r.moved.length, 0)
})
