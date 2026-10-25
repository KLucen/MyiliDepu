// 立刻解封（2026-10-25 加，起因：-412 从中午拦到晚上，她一整天的消息都没发出去）
//
// 用法：
//   node bili.mjs unban            看现在是不是在被退避，并清掉
//   node bili.mjs unban status     只看状态，不清（排障用）
//   --json                         机器读版
//
// 退出码：0 = 成功（含"本来就没封"）；2 = 参数用错
//
// 退避是**可恢复状态**，不是惩罚：B站 限流是一时的，把它当成"必须等满"的判决书没有意义。
// 留这个人手开关，是为了让主人在"她的消息发不出去"时能立刻一刀切掉，
// 而不是陪着指数退避等到天亮 ✗
import { apiBanState, clearApiBan } from '../lib/bili-api.mjs'

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const action = (argv.find((a) => !a.startsWith('--')) || 'clear').toLowerCase()

const out = (o) => console.log(JSON.stringify(o, null, 2))

if (!['clear', 'status', 'reset'].includes(action)) {
  console.error(`不认识的子命令：${action}\n用法：unban [status] [--json]`)
  process.exit(2)
}

const mins = (n) => (n >= 60 ? `${Math.floor(n / 60)} 小时 ${n % 60} 分钟` : `${n} 分钟`)
const line = (label, s) => (s.banned
  ? `⏳ ${label}：还在退避，剩 ${mins(s.minutesLeft)}（${s.why ?? '?'}${s.endpoint ? ' · ' + s.endpoint : ''}）`
  : `✓ ${label}：没有在退避`)

if (action === 'status') {
  const st = apiBanState()
  if (asJson) out({ ok: true, action: 'status', ...st })
  else {
    console.log(line('全机闸门（挡住她发评论/私信的那个）', st.global))
    console.log(line('监控闸门（只看别人更新，不影响她发文）', st.monitor))
    if (st.global.banned) console.log('想立刻放行：node tools/bili.mjs unban')
  }
  process.exit(0)
}

const before = clearApiBan()
if (asJson) out({ ok: true, action: 'clear', before, cleared: before.global.banned || before.monitor.banned })
else {
  console.log(line('清之前 · 全机闸门', before.global))
  console.log(line('清之前 · 监控闸门', before.monitor))
  console.log(before.global.banned || before.monitor.banned
    ? '✓ 已清掉 —— 下一次请求会照常打到 B站（如果它还在限流，会重新退避，但至少不是"陪着等到天亮"）'
    : '✓ 本来就没在退避，什么都没动')
  console.log('提示：如果刚清完又立刻被退避，说明 B站 那边是真的还在限流，那就让监控先停几小时')
}
