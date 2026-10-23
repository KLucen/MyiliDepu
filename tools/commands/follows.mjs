/**
 * `bili follows` —— 关注名单同步（**只读 B 站，只写本地配置**）。
 *
 *   node tools/bili.mjs follows list [--json]
 *   node tools/bili.mjs follows sync [--dry|--go] [--topics "a,b"] [--max N] [--json]
 *
 * 为什么要有它：主人说「以后我会直接用她的账号关注up主，监测到有新关注就按格式写进配置」
 *   → 关注动作主人在 B 站自己做，这里只负责"看见 + 记账" ✓
 *
 * 默认是 **dry**（只说要写什么，不写）；真写要 `--go` —— 与 comment / dm / diary 等
 * 所有会改外部状态的命令保持同一套约定（错误的手滑不该改任何东西）。
 *
 * 退出码：0 正常 · 2 用法/参数错 · 3 读不到（未登录 / 风控 / 网络）
 */
import { syncFollows, fetchFollowings, SEEN_PATH, readSeen, describeFollows } from '../lib/follows.mjs'
import { apiGet } from '../lib/bili-api.mjs'
import { loadCred } from '../lib/cred.mjs'
import { biliHeaders } from '../lib/visual.mjs'

const USAGE = [
  'follows list [--json]                      # 她账号现在关注了谁（只读）',
  'follows sync [--dry|--go] [--topics a,b] [--max N] [--json]',
  '                                           # 比上次快照，把新关注写进配置 watchups（默认 --dry）',
].join('\n')

const parse = (argv) => {
  const o = { _: [], dry: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') o.json = true
    else if (a === '--dry') o.dry = true
    else if (a === '--go') o.dry = false
    else if (a === '--topics') o.topics = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    else if (a === '--max') o.max = Number(argv[++i])
    else if (a.startsWith('--')) { console.error(`未知参数：${a}\n${USAGE}`); process.exit(2) }
    else o._.push(a)
  }
  return o
}

const day = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : '—')

const main = async () => {
  const o = parse(process.argv.slice(2))
  const sub = o._[0] ?? 'list'
  if (!['list', 'sync'].includes(sub)) { console.error(USAGE); process.exit(2) }

  if (sub === 'list') {
    let uid = ''
    try {
      const headers = biliHeaders(loadCred())
      const nav = await apiGet('https://api.bilibili.com/x/web-interface/nav', headers)
      uid = String(nav?.data?.mid ?? '')
      if (!uid) { console.error('读不到她的账号 mid（没登录 / cookie 过期）'); process.exit(3) }
      const got = await fetchFollowings({ headers: { ...headers, referer: `https://space.bilibili.com/${uid}/fans/follow` }, vmid: uid })
      if (o.json) { console.log(JSON.stringify({ uid, ...got }, null, 2)); return }
      console.log(`她（uid ${uid}）现在关注 ${got.total} 位${got.complete ? '' : '（列表太长，只读了前几页）'}：`)
      got.list.forEach((x, i) => console.log(`  ${String(i + 1).padStart(2)}. ${x.name}  ${x.mid}  · 关注于 ${day(x.mtime)}`))
      if (!got.list.length) console.log('  （一个都没有）')
      return
    } catch (e) {
      console.error(`读关注列表失败：${e?.message ?? e}`)
      process.exit(3)
    }
  }

  // sync
  const r = await syncFollows({ dry: o.dry, topics: o.topics, max: o.max })
  if (o.json) { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok ? 0 : 3) }
  if (!r.ok) {
    console.error(`同步失败（${r.code}）：${r.message}`)
    if (r.code === 'NO_LOGIN') console.error('→ 先在设置页/`node bili.mjs session` 确认她的账号还登着')
    else if (r.apiCode) console.error('→ 多半是风控（-352/-412）：过几分钟再试，别连着刷')
    process.exit(3)
  }

  const seen = readSeen(SEEN_PATH)
  const head = r.dry ? '[dry] ' : ''
  console.log(`${head}她关注 ${r.total} 位 · 上次快照 ${seen.at ? seen.at.slice(0, 16).replace('T', ' ') : '（还没有）'}`)
  if (r.added.length) {
    console.log(`  新增 ${r.added.length} 位 → ${r.dry ? '会写进' : '已写进'}配置 watchups：`)
    for (const x of r.added) console.log(`    + ${x.name}  ${x.mid}${r.dry ? '' : '  ✓'}`)
  } else {
    console.log('  没有新关注。')
  }
  if (r.skipped.length) {
    for (const s of r.skipped) {
      const why = { already: '名单里已经有了（或你手写过同名）', 'over-limit': '超出单次上限，下次再写', 'no-name': '接口没给昵称' }[s.why] ?? s.why
      console.log(`    · 跳过 ${s.name || s.mid}：${why}`)
    }
  }
  if (r.removed.length) console.log(`  ⚠️ 取关 ${r.removed.length} 位（**不会**从 watchups 删掉）：` + r.removed.map((x) => x.name || x.mid).join('、'))
  if (r.added.length && r.dry) {
    console.log('（dry-run：没有写任何文件。要真写加 --go）')
    const miss = r.added.filter((x) => !(x.topics ?? []).length).length
    if (miss) console.log(`  提示：新条目的 topics 用的是配置 follows.topics（当前为空）——想要汇报聚焦就填上，或用 --topics "DeepSeek,codex"`)
  }
  if (!r.dry && r.wroteConfig) console.log(`  ✓ 已写进配置：watchups 共 ${r.watchups.length} 条`)
  else if (!r.dry) console.log(`  ✓ 快照已更新${r.wroteConfig ? '' : '（配置没变）'}：${SEEN_PATH}`)
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(3) })
