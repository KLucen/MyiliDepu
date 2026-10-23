// 开机自启（2026-10-23 加，对应「已知限制」P2）
//
// 用法：
//   node bili.mjs autostart              看现状（默认）
//   node bili.mjs autostart status       同上
//   node bili.mjs autostart on           开启：登录 Windows 后自动启动 DSH
//   node bili.mjs autostart off          关闭
//   --json                               机器读版（agent 判断用）
//   --exe "<绝对路径>"                    on 时指定 exe（自动找不到时用）
//
// 退出码：0 = 成功；2 = 参数用错；3 = 做不到（非 Windows / 找不到 exe / 注册表写不进去）
//
// 只写 HKCU（当前用户），不需要管理员，不碰系统级设置。
import { status, enable, disable, describe, VALUE_NAME, RUN_KEY } from '../lib/autostart.mjs'

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const exeFlag = (() => {
  const i = argv.indexOf('--exe')
  return i >= 0 ? argv[i + 1] : ''
})()
const action = (argv.find((a) => !a.startsWith('--') && (!exeFlag || a !== exeFlag)) || 'status').toLowerCase()

const out = (o) => console.log(JSON.stringify(o, null, 2))
const fail = (code, message) => {
  if (asJson) out({ ok: false, error: code, message })
  else console.error(`✗ ${message}`)
  process.exit(3)
}

if (!['status', 'on', 'off', 'enable', 'disable'].includes(action)) {
  console.error(`不认识的子命令：${action}\n用法：autostart [status|on|off] [--exe <路径>] [--json]`)
  process.exit(2)
}

const st = status()

if (action === 'status') {
  if (asJson) {
    out({ ok: true, action: 'status', ...st, summary: describe(st) })
  } else {
    console.log('== 开机自启 ==')
    console.log(`  状态    : ${st.installed ? '已开启' : '没开'}`)
    if (st.supported) {
      console.log(`  DSH 程序: ${st.exe ?? '（没找到，可用 --exe 指定）'}`)
      if (st.installed) console.log(`  注册表值: ${st.command}`)
      console.log(`  位置    : ${RUN_KEY}\\${VALUE_NAME}`)
    }
    console.log(`\n  ${describe(st)}`)
    console.log('\n  说明：只在 **登录 Windows 之后** 触发。电脑关机/睡眠期间错过的窗口它补不回来 ——')
    console.log('        那是「生物钟 catch-up」的事，这一条只保证「DSH 没开着」不再是常态。')
    console.log('        撤销：node bili.mjs autostart off（或任务管理器 → 启动应用 里禁用）')
    process.exit(0)
  }
}

if (action === 'on' || action === 'enable') {
  try {
    const r = enable({ exe: exeFlag || undefined })
    if (asJson) out({ ok: true, action: 'on', ...r, alreadyInstalled: st.installed })
    else {
      console.log(`✓ 已开启开机自启：${r.command}`)
      console.log(`  写进 ${RUN_KEY}\\${VALUE_NAME}`)
      console.log('  下次登录 Windows 时它就会自己启动 —— 现在想立刻生效就直接打开 DSH。')
    }
    process.exit(0)
  } catch (e) {
    fail(e?.code ?? 'ENABLE_FAILED', `开不了：${String(e?.message ?? e).split(/\r?\n/)[0]}`)
  }
}

if (action === 'off' || action === 'disable') {
  const r = disable()
  if (asJson) out({ ok: true, action: 'off', ...r })
  else if (r.already) console.log('✓ 本来就是关的（注册表里没有这一项），没改任何东西')
  else console.log(`✓ 已关闭开机自启（删掉 ${RUN_KEY}\\${VALUE_NAME}）`)
  process.exit(0)
}
