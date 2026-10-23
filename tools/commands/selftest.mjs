// 启动测试（2026-10-20 加 —— 装完插件先跑这个，一步确认能不能用）
//
//   node bili.mjs selftest           本机装配检查（配置/凭据/目录/依赖/权限）
//   node bili.mjs selftest --real    再加「真机十二问」：真账号真接口跑一遍只读链路（2026-10-23 加）
//
// 为什么需要它：很多人装完插件卡在两件事上 ——
//   ① 插件新开的会话在「工作区 → 未分组」里，不点开那个文件夹看不见
//   ② 那个新会话默认没有完全权限，agent 起来后什么都干不了
// 这个命令把"该确认的事"列成一张表，缺哪项就直说缺哪项。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from '../lib/capture.mjs'
import { fileURLToPath } from 'node:url'
import { dshPath, dataPath, configPath } from '../lib/paths.mjs'
import { configStatus } from '../lib/config.mjs'
import { NODE_EXE } from '../lib/nodebin.mjs'   // 2026-10-21：别用 process.execPath（Electron 里它是主程序 ✗）


const HOME = (process.env.USERPROFILE || process.env.HOME || '/')
const DSH = dshPath()
const CFG = configPath
const CRED = path.join(HOME, '.bili-ai', 'credentials.json')
const OK = '✓'
const NO = '✗'
const WARN = '!'

let bad = 0
const line = (mark, label, detail) => {
  if (mark === NO) bad += 1
  console.log(`  ${mark} ${label}${detail ? '  —— ' + detail : ''}`)
}

console.log('\n══════════ 启动测试（装完插件跑这一条）══════════\n')

// ① 配置文件
try {
  const c = JSON.parse(fs.readFileSync(CFG, 'utf8'))
  line(OK, '配置文件', CFG)
  line(c.self?.mid ? OK : NO, '她的身份', c.self?.name ? `${c.self.name}（${c.self.mid}）` : '设置页 →「她是谁」还没填')
  line(c.owner?.mid ? OK : NO, '主人的身份', c.owner?.name ? `${c.owner.name}（${c.owner.mid}）` : '设置页 →「她是谁」里填主人 mid')
  line(c.share?.via ? OK : NO, '分享方式', c.share?.via === 'dm' ? '私信（不发公开评论）' : '评论区 @')
  line(c.notify?.type ? OK : NO, '消息推送', String(c.notify?.type ?? '未设置'))
} catch {
  line(NO, '配置文件', '没有 ' + CFG + ' —— 先去设置页保存一次')
}

// ② 凭据
try {
  const cred = JSON.parse(fs.readFileSync(CRED, 'utf8'))
  const has = !!cred.sessdata && !!cred.bili_jct
  line(has ? OK : NO, 'B站凭据', has ? '已保存（cookie）' : '缺 sessdata / bili_jct')
  line(cred.buvid3 ? OK : WARN, 'buvid3', cred.buvid3 ? '有' : '缺 —— 不影响评论/私信；个别接口可能被风控。想要就 F12 → Cookies 复制 buvid3 再写入')
  // 2026-10-21：bili_jct 是"能不能发东西"的关键 —— 只读全绿但一发就 code=-111，最常见就是它 ✗
  const jct = String(cred.bili_jct ?? '')
  if (!jct) line(NO, 'bili_jct（写操作）', '空着 —— 发私信/评论/收藏都会失败（code=-111）→ 设置页重新粘贴一次')
  else if (!/^[0-9a-fA-F]{32}$/.test(jct)) line(WARN, 'bili_jct（写操作）', '格式不像（长度 ' + jct.length + '，正常 32 位十六进制）—— 可能复制时截断了')
  else line(OK, 'bili_jct（写操作）', '格式正常（和 SESSDATA 是否同一账号，只能靠一次真实写入验证）')
} catch {
  line(NO, 'B站凭据', '没有 ' + CRED + ' —— 设置页粘贴 cookie 后保存')
}

// ③ 登录态
try {
  const BILI0 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bili.mjs')
  const out = execFileSync(NODE_EXE, [BILI0, 'session'], { encoding: 'utf8', timeout: 30000 })
  const who = out.match(/账号\s*:\s*(.+)/) ?? []
  const midM = out.match(/mid\s*:\s*(\d+)/) ?? []
  line(who[1] ? OK : NO, '登录态', who[1] ? `${who[1].trim()}（mid ${midM[1] ?? '?'}）` : String(out).trim().slice(0, 80))
} catch (e) {
  line(NO, '登录态', '查不到（cookie 可能过期）—— ' + String(e.message).slice(0, 60))
}

// ④ 数据目录
for (const d of ['.bili-ai', '.dsh']) {
  const p = path.join(HOME, d)
  line(fs.existsSync(p) ? OK : NO, '目录 ' + d, p)
}
// 2026-10-23：合并后数据目录里其实是三本本子，分开报，别只查一本（diary.md 不是"公开日记"，是叙事账本）
for (const [label, file] of [['叙事账本', 'diary.md'], ['私人日记', 'diary-private.md'], ['公开日记留痕', 'diary-public.md']]) {
  const p = dataPath(file)
  line(fs.existsSync(p) ? OK : WARN, label, fs.existsSync(p) ? p : '还没建（她第一次醒来会写）→ ' + p)
}

// ⑤ 依赖体检（直接调现成的 deps，别在这里重复实现 ✗）
try {
  const BILI2 = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bili.mjs')
  const out = execFileSync(NODE_EXE, [BILI2, 'deps'], { encoding: 'utf8', timeout: 60000 })
  const reds = (String(out).match(/✗/g) ?? []).length
  line(reds === 0 ? OK : NO, '依赖体检（deps）', reds === 0 ? '全绿' : `${reds} 项红 —— 详见 \`node bili.mjs deps\``)
} catch (e) {
  line(WARN, '依赖体检（deps）', '没跑起来：' + String(e.message).slice(0, 60))
}

// ⑥ 真机十二问（2026-10-23 加，只在 --real 下跑）——
//   单测全是临时目录 + 假凭据 + 模拟网络，证明的是逻辑自洽；只有真账号真接口才证明"能用"。
//   B 站接口是非官方的（WBI 签名、HTTP 412 风控都真遇到过），测试全绿而真机全红完全可能。
//   这里**全部只读**：不发评论、不发动态、不发私信、不写平台任何东西。
if (process.argv.includes('--real')) {
  const HERE = path.dirname(fileURLToPath(import.meta.url))
  const BILI = path.join(HERE, '..', 'bili.mjs')
  const run = (args, timeout = 60000) => {
    try {
      return { ok: true, out: String(execFileSync(NODE_EXE, [BILI, ...args], { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 })) }
    } catch (e) {
      return { ok: false, out: String(e?.stdout ?? ''), err: String(e?.stderr ?? e?.message ?? e) }
    }
  }
  const first = (s, re) => (String(s).match(re) ?? [''])[0]
  const why = (r) => (String(r.err || r.out).trim().replace(/\s+/g, ' ').slice(0, 140)) || '（没有输出）'

  console.log('\n────────── 真机十二问（--real · 全部只读，不发任何东西）──────────\n')

  let BV = ''
  {
    const r = run(['session'], 30000)
    const m = first(r.out, /账号\s*:\s*\S+/)
    line(m ? OK : NO, '1  凭据能用（真的问了一次 B 站）', m ? m.replace(/\s+/g, ' ').trim() : why(r))
  }
  {
    const r = run(['feed', '--n', '2'], 60000)
    BV = first(r.out, /BV[0-9A-Za-z]{10}/)
    line(BV ? OK : NO, '2  推荐流能出候选（WBI 签名过得去）', BV ? `拿到 ${BV}` : why(r))
  }
  {
    const r = run(['candidates', '--count', '1'], 90000)
    const bv = first(r.out, /BV[0-9A-Za-z]{10}/)
    line(r.ok && bv ? OK : NO, '3  学习候选能挑到片子', bv || why(r))
  }
  if (BV) {
    const r = run(['read', BV, '--route', 'auto'], 150000)
    line(r.ok ? OK : NO, `4  能真的读到原文（${BV}）`, r.ok ? (first(r.out, /\S[^\n]*/) || '有输出').slice(0, 120) : why(r))
  } else {
    line(WARN, '4  能真的读到原文', '跳过：第 2 步没拿到 BV')
  }
  {
    const r = run(['journal', 'show'], 30000)
    line(r.ok ? OK : NO, '5  见闻账本读得出来', r.ok ? (first(r.out, /见闻|账本|条|\d/) || '有输出').slice(0, 80) : why(r))
  }
  {
    const r = run(['personality', 'show'], 30000)
    line(r.ok ? OK : NO, '6  人格札记读得出来', r.ok ? '有输出' : why(r))
  }
  {
    const r = run(['diary', 'private', 'show'], 30000)
    line(r.ok ? OK : NO, '7  私人日记读得出来', r.ok ? '有输出' : why(r))
  }
  {
    const r = run(['diary', 'public', 'show'], 30000)
    line(r.ok ? OK : NO, '8  公开日记读得出来', r.ok ? '有输出' : why(r))
  }
  {
    const r = run(['quota', 'status'], 30000)
    const m = first(r.out, /分享[^\n]*/)
    line(r.ok ? OK : NO, '9  额度账本能读', m ? m.trim().slice(0, 100) : (r.ok ? '有输出' : why(r)))
  }
  {
    const r = run(['night', 'status'], 30000)
    const m = first(r.out, /\S[^\n]*/)
    line(r.ok ? OK : NO, '10 生物钟状态能读', m ? m.trim().slice(0, 100) : why(r))
  }
  {
    const dir = dataPath()
    let ok = false
    let note = dir
    try {
      fs.mkdirSync(dir, { recursive: true })
      const probe = path.join(dir, '.write-probe')
      fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe)
      ok = true
    } catch (e) { note = dir + ' —— ' + String(e?.message ?? e).slice(0, 80) }
    line(ok ? OK : NO, '11 数据目录可写（日记 / 账本 / 人格札记都落这儿）', note)
  }
  {
    try {
      const st = configStatus()
      if (!st.ok) {
        line(NO, '12 配置文件体检', `解析失败，当前用的是默认值：${String(st.error).slice(0, 110)} → ${st.path}`)
      } else {
        const bits = [`读到 ${st.readPath}`]
        if (st.hadBom) bits.push('带 BOM（已自动兼容）')
        if (st.migratedFrom) bits.push(`从旧位置迁移：${st.migratedFrom}`)
        if (!st.hasUserFile) bits.push('还没有用户配置（全默认）')
        line(OK, '12 配置文件体检', bits.join(' · '))
      }
    } catch (e) { line(WARN, '12 配置文件体检', '跳过：' + String(e?.message ?? e).slice(0, 80)) }
  }
  console.log('\n  （以上 12 条全绿 = 真账号 + 真接口下真的能用；任何一条 ✗ 都先按提示处理再重跑）')
}

// ⑦ 告诉她/他 下一步该做什么（这一步是很多人卡住的地方）
console.log('\n────────── 接下来要做的三件事（很多人卡在这）──────────\n')
console.log('  ① 【找到她的会话】')
console.log('     插件启动时会自动开一个会话，名字就叫 myilidepu，位置在左侧「工作区」里：')
console.log('       · 通常在「未分组」文件夹下；数据目录换过地方的话，')
console.log('         会在一个按数据目录命名的工作区里（本机是 D:\\MyDepu\\work）')
console.log('     ⚠️ 不展开那个文件夹是看不见它的 —— 这一步最容易漏 ✗')
console.log('')
console.log('  ② 【给她完全权限】')
console.log('     打开那个会话 → 权限设置 → 选「完全访问 / danger-full-access」')
console.log('     否则她起来后跑不了命令、发不了评论、写不了日记 ✗')
console.log('')
console.log('  ③ 【如果设置页打不开，或插件一直 pending】')
console.log('     那说明 DSH 是用 headless（纯命令行）模式起的 —— 这个插件需要一个真会话 + Web 服务，')
console.log('     那种模式下它**不会激活**，DSH 会打印：')
console.log('       dsh-myilidepu: pending (waiting for services: sessionController, webServer, connection)')
console.log('     这是**预期行为，不是装坏了** —— 用桌面版 / 网页版启动就行。')
console.log('     （只跑 node bili.mjs 那些命令不受影响，CLI 是独立的一条腿）')
console.log('')
// 2026-10-20：全绿时落个标记 —— 设置页和她的唤醒提示会用它在"还没测过"时提醒
if (bad === 0) {
  try {
    fs.mkdirSync(path.join(HOME, '.bili-ai'), { recursive: true })
    fs.writeFileSync(path.join(HOME, '.bili-ai', 'selftest-passed.json'), JSON.stringify({ at: new Date().toISOString() }, null, 2))
  } catch {}
  console.log('══════════ 全部通过 ✓ 可以用了 ══════════')
  console.log('  想立刻看她跑一轮：设置页 →「生物钟」→ 把窗口改成现在之后 2 分钟 → 等她自己醒\n')
} else {
  console.log(`══════════ ${bad} 项没通过 ✗ 按上面的提示补一下 ══════════\n`)
}
process.exit(bad === 0 ? 0 : 1)
