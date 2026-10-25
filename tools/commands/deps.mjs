// 依赖体检（2026-10-17 加）：装完之后让 agent 自己跑一次，确认"能不能用"
//
// 用法：
//   node deps.mjs            人读版（每项 ✓/✗ + 怎么修）
//   node deps.mjs --json     机器读版（agent 判断用）
//
// 退出码：0 = 全可用；3 = 有缺的（缺的那项会写明补救办法）
import fs from 'node:fs'
import path from 'node:path'
import { ffmpegInfo } from '../lib/ffmpeg.mjs'
import { apiState } from '../lib/bili-api.mjs'
import { dataPath } from '../lib/paths.mjs'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const cred = path.join(HOME, '.bili-ai', 'credentials.json')
const asJson = process.argv.includes('--json')

const items = []

// ① 凭据（cookie）：**真去请求一次 nav** —— 只查"字段齐不齐"是不够的（cookie 会过期 ✗）
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
let credOk = false, credNote = ''
try {
  const c = JSON.parse(fs.readFileSync(cred, 'utf8'))
  const miss = ['sessdata', 'bili_jct'].filter((k) => !c[k] || !String(c[k]).trim())
  if (miss.length) { credNote = `缺字段：${miss.join(', ')}` }
  else {
    const nav = await (await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: `SESSDATA=${c.sessdata}; bili_jct=${c.bili_jct}; buvid3=${c.buvid3}` },
    })).json()
    credOk = nav.code === 0 && !!nav.data?.isLogin
    credNote = credOk
      ? `已登录：${nav.data.uname}（mid ${nav.data.mid}）`
      : `cookie 无效：code=${nav.code} ${nav.message ?? ''} —— 重新复制一次（选"长期/记住我"）`
  }
} catch { credNote = `没有或读不了凭据文件（${cred}）` }
items.push({
  name: 'B站 cookie',
  ok: credOk,
  detail: credNote,
  fix: '在设置里重新填 SESSDATA / bili_jct（buvid3 可留空）；注意 cookie 会过期，写操作前先跑一次本命令',
})

// ② ffmpeg（抽帧看画面）—— 2026-10-23：这是**可选**依赖，不再是必选项 ✗ → !
//   没有它照样能读字幕 / 官方总结 / 热评 / 弹幕，只是少一路「看画面」（抽帧）。
//   以前把可选项按必选项报 ✗，于是"没装 ffmpeg"的机器体检永远「不通过 · 退出码 3」，
//   把真正的红项（凭据失效、找不到真 node）淹在噪音里，agent 也会误判成装坏了 ✗
const ff = ffmpegInfo()
items.push({
  name: 'ffmpeg（可选：抽帧看画面）',
  ok: ff.ok,
  optional: true,
  detail: ff.ok
    ? `${ff.version}\n  路径：${ff.path}`
    : (ff.path
      ? `找到了但跑不起来：${ff.version ?? ff.error}`
      : '没找到 —— 不影响字幕/官方总结/热评/弹幕，只少一路「看画面」'),
  fix: '想要就装：① winget install ffmpeg  ② 或设环境变量 FFMPEG=路径  ③ 或放进 <仓库>/bin/ 或 <数据目录>/bin/；不装也能正常用',
})

// ③ Node 版本（2026-10-23 修：门槛从 18 提到 24）
//   以前查的是 18+（fetch/Blob 够用），但账本用的是 `node:sqlite`（lib/reading/store.mjs:1 的
//   DatabaseSync），18 上根本没有这个模块 → 体检报 ✓ 而一读账本就炸，属于"假绿" ✗
//   package.json 的 engines 也写的是 node>=24，这里跟它对齐。
const major = Number(process.versions.node.split('.')[0])
items.push({
  name: 'Node.js',
  ok: major >= 24,
  detail: `v${process.versions.node}`,
  fix: '升级到 Node 24 或更高（账本用的 node:sqlite 需要 24+；fetch/Blob 也要它）；winget install OpenJS.NodeJS.LTS',
})

// ④ 两处目录分开查（2026-10-23 修）：以前只查 `~/.bili-ai` 还管它叫「数据目录」——
//   但数据目录早就跟着配置搬走了（默认 <DSH_HOME>/myilidepu，本机已改到 D:\MyDepu），
//   于是一边报"C:\Users\…\.bili-ai 可写 ✓"、一边她的日记其实写在别处，体检结论是错的 ✗
const probeDir = (d) => {
  try {
    fs.mkdirSync(d, { recursive: true })
    const probe = path.join(d, '.write-probe')
    fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe)
    return true
  } catch { return false }
}
const credDir = path.join(HOME, '.bili-ai')
items.push({
  name: '凭据目录可写',
  ok: probeDir(credDir),
  detail: credDir,
  fix: '检查该目录权限（cookie 就放这儿）',
})
let DATA_DIR = ''
try {
  DATA_DIR = dataPath()
  items.push({
    name: '数据目录可写',
    ok: probeDir(DATA_DIR),
    detail: DATA_DIR + '（她的日记 / 账本 / 人格札记 / 工作区都在这儿）',
    fix: '检查该目录权限；想换地方：设置页「数据目录」或配置文件里的 paths.dataDir',
  })
} catch (e) {
  items.push({ name: '数据目录可写', ok: false, detail: '解析不出数据目录：' + String(e?.message ?? e).slice(0, 120), fix: '配置文件里的 paths.dataDir 要写绝对路径' })
}
// 2026-10-21 加（Issue #8-3）：没有 node 运行时 → 生物钟/监听/直播间全部停用，
//   但以前体检不报这一项 ✗ 表面全绿、其实永远不会醒 ✗
try {
  const { NODE_EXE, NODE_KIND, isRealNode } = await import('../lib/nodebin.mjs')
  const real = isRealNode()
  items.push({
    name: real ? 'node 运行时' : 'node 运行时（可选：现在用桌面版主程序顶着）',
    // 能解析出运行时 = 一定能跑：resolveRuntime 已经真的执行过一次并验了输出（probeRuntime）✗ 不会静默假绿
    ok: true,
    optional: !real,
    detail: real
      ? `${NODE_EXE}\n  版本：${process.versions.node}`
      : `${NODE_EXE}\n  这是 DSH 桌面版的主程序（kind=${NODE_KIND}），靠 ELECTRON_RUN_AS_NODE=1 当 node 用 —— 能用，但每次调用都要启一个 Electron，更慢更吃内存`,
    fix: '装一个真正的 Node.js（winget install OpenJS.NodeJS.LTS），或设环境变量 DSH_NODE 指向 node.exe 的绝对路径，然后完全退出并重启 DSH',
  })
} catch (e) {
  items.push({
    name: 'node 运行时',
    ok: false,
    detail: '解析失败：' + String(e?.message ?? e).slice(0, 200),
    fix: '设 DSH_NODE=真 node 的绝对路径（Windows 常见 C:\\Program Files\\nodejs\\node.exe），然后完全退出并重启 DSH',
  })
}

// 2026-10-22：把「接口缓存 / 熔断」现状也列出来 ——
//   被 412 限流时最想知道的就是「还要等多久」和「缓存里还有多少能撑」
try {
  const st = apiState()
  items.push({
    name: 'B站 限流',
    ok: !st.banned,
    detail: st.banned
      ? `熔断中，约 ${st.banMinutesLeft} 分钟后恢复（原因 ${st.banWhy ?? '-'}${st.banEndpoint ? ' · ' + st.banEndpoint : ''}）；缓存里 ${st.cacheEntries} 条可撑`
      : `正常 · 元信息缓存 ${st.cacheEntries} 条` + (st.monitor?.banned ? `（监控接口另在退避，剩 ${st.monitor.minutesLeft} 分钟，不影响她发文）` : ''),
    fix: 'bili unban 可以立刻解封；等它自己恢复是 5→10→20→30 分钟退避。'
      + '如果一天里反复被封，先看是不是监控类轮询太密（v1.4.1 起关注同步只在醒来时、6 小时至多一次）',
  })
} catch {}

// 2026-10-23（P2）：开机自启也列出来 —— 生物钟只在 DSH 开着的时候走，
//   所以「DSH 会不会自己起来」直接决定她晚上还醒不醒。没开不算故障（只是提醒），
//   给 optional:true，免得把一个建议项报成 ✗ 把真问题淹掉。
try {
  const { status: autostartStatus, describe: describeAutostart } = await import('../lib/autostart.mjs')
  const st = autostartStatus()
  items.push({
    name: '开机自启（可选：让生物钟有人守）',
    ok: !!st.installed,
    optional: true,
    detail: describeAutostart(st),
    fix: '想让它登录后自己起来：node bili.mjs autostart on（只写 HKCU，不需要管理员；撤销用 autostart off）',
  })
} catch (e) {
  items.push({
    name: '开机自启（可选：让生物钟有人守）',
    ok: false,
    optional: true,
    detail: '查不了：' + String(e?.message ?? e).slice(0, 120),
    fix: '手动看：node bili.mjs autostart status',
  })
}

// 2026-10-23：可选依赖（ffmpeg）没装不算失败 —— 只有必需项缺了才算
const bad = items.filter((i) => !i.ok && !i.optional)
const optionalMissing = items.filter((i) => !i.ok && i.optional)

if (asJson) {
  console.log(JSON.stringify({ ok: bad.length === 0, node: process.versions.node, items }, null, 2))
} else {
  console.log('== 依赖体检 ==')
  for (const i of items) {
    const mark = i.ok ? '✓' : (i.optional ? '!' : '✗')
    console.log(`${mark} ${i.name}  ${i.detail ? '— ' + i.detail : ''}`)
    if (!i.ok) console.log(`    ${i.optional ? '可选（不影响使用），想要就' : '修'}：${i.fix}`)
  }
  if (bad.length) console.log(`\n✗ ${bad.length} 项不可用 —— 先用上面的"修"处理，再重跑一次。`)
  else if (optionalMissing.length) console.log(`\n✓ 必需项都在。${optionalMissing.length} 项可选没装（${optionalMissing.map((i) => i.name).join('、')}），不影响使用。`)
  else console.log('\n✓ 全部可用')
}
process.exit(bad.length ? 3 : 0)
