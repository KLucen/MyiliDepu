// 立刻解封（2026-10-25 加，起因：-412 从中午拦到晚上，她一整天的消息都没发出去）
//
// 用法：
//   node bili.mjs unban            看现在被哪几层锁着，并全部清掉
//   node bili.mjs unban status     只看状态，不清（排障用）
//   --json                         机器读版
//
// 退出码：0 = 成功（含"本来就没锁"）；2 = 参数用错
//
// 退避是**可恢复状态**，不是惩罚：B站 限流是一时的，把它当成"必须等满"的判决书没有意义。
// 留这个人手开关，是为了让主人在"她的消息发不出去"时能立刻一刀切掉，
// 而不是陪着指数退避等到天亮 ✗
//
// 2026-10-26 补：以前它只清**风控闸门**（tools/lib/bili-api.mjs 里的 api-ban），
// 而**账本里的那把锁**（store.pause，他读原文/学习时被 -101 之类锁住）是另一个地方，
// 结果主人更新完 cookie，锁还在 —— 她只能干看着，最后在私信里塞给主人一段
//   node --input-type=module -e "… new Store('D:/MyDepu') … s.resume() …"
// 长命令让主人手动开锁 ✗✗ 那不该是主人做的事。现在两把锁一起开。
import { apiBanState, clearApiBan } from '../lib/bili-api.mjs'
import { dataPath } from '../lib/paths.mjs'
import { Store } from '../../lib/reading/store.mjs'
import { describePause, isCredentialPause, isRiskPause } from '../../lib/reading/pause-heal.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

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

/** 账本那把锁（她读原文/学习的那条路）—— 读不出来就当没有（账本还没建的新装机）。 */
function ledgerPause() {
  const dir = dataPath()
  // 别为了看一眼状态就把账本（和数据目录）创建出来：没有 ledger.sqlite 就是新装机 ✓
  if (!existsSync(join(dir, 'ledger.sqlite'))) return { ok: false, store: null, pause: null, error: '账本还没建' }
  try {
    const store = new Store(dir)
    const p = store.getControl('pause')
    return { ok: true, store, pause: p }
  } catch (e) {
    return { ok: false, store: null, pause: null, error: String(e?.message ?? e) }
  }
}

if (action === 'status') {
  const st = apiBanState()
  const led = ledgerPause()
  if (asJson) out({ ok: true, action: 'status', ...st, ledger: { readable: led.ok, pause: led.pause ?? null, error: led.error ?? null } })
  else {
    console.log(line('全机闸门（挡住她发评论/私信的那个）', st.global))
    console.log(line('监控闸门（只看别人更新，不影响她发文）', st.monitor))
    console.log(led.ok
      ? `账本锁（挡住她读原文/学习）：${describePause(led.pause)}`
      : `账本锁：读不到账本（${led.error}）—— 新装机就是这样，不用管`)
    if (st.global.banned || led.pause) console.log('想立刻全开：node tools/bili.mjs unban')
  }
  process.exit(0)
}

const before = clearApiBan()
const led = ledgerPause()
let ledgerBefore = led.pause
let ledgerCleared = false
if (led.ok && led.pause) {
  led.store.resume()
  ledgerCleared = true
}

if (asJson) {
  out({
    ok: true,
    action: 'clear',
    before,
    cleared: before.global.banned || before.monitor.banned || ledgerCleared,
    ledger: { cleared: ledgerCleared, before: ledgerBefore ?? null, readable: led.ok, error: led.error ?? null },
  })
} else {
  console.log(line('清之前 · 全机闸门', before.global))
  console.log(line('清之前 · 监控闸门', before.monitor))
  console.log(`清之前 · 账本锁：${led.ok ? describePause(ledgerBefore) : `读不到账本（${led.error}）`}`)
  const any = before.global.banned || before.monitor.banned || ledgerCleared
  if (!any) console.log('✓ 本来就没锁，什么都没动')
  else {
    console.log('✓ 已全开 —— 下一次请求会照常打到 B站（如果它还在限流，会重新退避，但至少不是"陪着等到天亮"）')
    if (ledgerCleared && isCredentialPause(ledgerBefore?.reason)) {
      console.log('  · 账本那把是凭据类的锁：以后你在设置页换完 cookie，它会**自己开**（v1.4.3 起），不用再手动清')
    }
    if (ledgerCleared && isRiskPause(ledgerBefore?.reason)) {
      console.log('  · 账本那把是风控类的锁：不是配置问题，先让它慢下来（少醒几次），别连着刷')
    }
  }
  console.log('提示：如果刚清完又立刻被锁回来，说明 B站 那边是真的还在生气，那就让监控先停几小时')
}
