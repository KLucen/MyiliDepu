# 真机冒烟清单（SMOKE）

一句话：**单测全绿不等于能用。** 仓库里那 159 个用例跑在临时目录里，用的是假 cookie、模拟网络、假宿主——它证明的是**逻辑自洽**，不是**接口能通**。B 站接口是非官方的，WBI 签名、HTTP 412 风控、`-352 / -799 / -509` 这些码都真实遇到过，所以「测试全绿而真机第一条就红」完全可能。

这份清单只做一件事：在**真实 B 站账号 + 真实 DSH** 上，按顺序确认她真的能读、能记、能写，并且**在你按下最后一个按钮之前不会对外发出任何东西**。

---

## §0 怎么用这份清单

### 0.1 前置条件（缺一条，后面全是噪音）

| # | 条件 | 怎么确认 |
|---|---|---|
| 1 | 插件已装进 `desktop` profile，且是 `link:` 方式 | 见 0.2 |
| 2 | DSH **桌面版**已启动（不是 headless） | GUI 能打开 |
| 3 | 她的会话已设「完全访问」 | 见 §3 第 3 条 |
| 4 | B 站凭据已写入 | `C:\Users\<你>\.bili-ai\credentials.json` 存在，`sessdata` / `bili_jct` 非空 |
| 5 | 数据目录已定好 | 默认 `%USERPROFILE%\.dsh\myilidepu`；本机改到了 `D:\MyDepu`（见 §2 第 10 问） |
| 6 | 装完 / 改完代码后**完整重启过 DSH** | 只重开窗口不算——插件是启动时组装的 |

### 0.2 确认插件真的在 profile 里

```powershell
Get-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-myilidepu" | Select-Object LinkType,Target
```

本机期望看到（Junction 指向仓库）：

```
LinkType Target
-------- ------
Junction C:\Users\KLucen\Desktop\肥鱼嘟嘟可\MyiliDepu
```

再看 profile 依赖声明是不是 `link:`：

```powershell
Select-String -Path "$env:USERPROFILE\.dsh\profiles\desktop\package.json" -Pattern "dsh-myilidepu"
```

本机是 `"dsh-myilidepu": "link:C:/Users/KLucen/Desktop/肥鱼嘟嘟可/MyiliDepu"`，并且它应该出现在同文件的 `dsh.profile.bundles` 列表里。

**失败长什么样**：`Get-Item` 报「找不到路径」→ 插件根本没装进这个 profile；`LinkType` 是普通目录而不是 `Junction`/`SymbolicLink` → 装成了复制模式，你改代码不会生效。

### 0.3 两条硬规矩

1. **所有命令都在插件目录里跑**，用真 node（≥ Node 24；本机 v24.20.0 在 `C:\Users\KLucen\AppData\Local\Author Software\nvm\.nodejs\node.exe`）：

   ```powershell
   cd C:\Users\KLucen\Desktop\肥鱼嘟嘟可\MyiliDepu
   ```

   下面所有 `node tools/bili.mjs …` 都假定你已经 `cd` 到这里（两条 `node --input-type=module -e` 用相对路径 `./tools/lib/…`，换目录就会报找不到模块）。

2. **默认只读或 `--dry`。** 凡是有副作用的步骤，本文一律用 `⚠️` 标出来。自动化步骤里**绝不允许**真发评论 / 动态 / 私信。

### 0.4 关于「以实际输出为准」

本文里凡是标了这句的，就是我没在真机上验证过那一段的确切文字。**别照着我的猜测对错**，照着真实输出判断。

---

## §1 自动档：装完必跑的那一条

```powershell
node tools/bili.mjs selftest
```

两种跑法，装完都要跑：

```powershell
node tools/bili.mjs selftest          # 装配检查：配置 / 凭据 / 登录态 / 目录 / 三本本子 / 依赖体检
node tools/bili.mjs selftest --real   # 在上面基础上再加「真机十二问」：真账号 + 真接口，全部只读
```

> `--real` 是真实存在的（`tools/commands/selftest.mjs:98`，2026-10-23 加），README 和 `bili.mjs help` 里都写了。
> 注意：**不带 `--real` 也会联网**——第 ③ 项「登录态」内部要调一次 `session`（真打一次 B 站 nav）。README 里「`selftest` 不联网就能跑完」这句不准确。

`--real` 那一轮的十二问（**它自己的编号**，和本文 §2 的十二问不是一一对应）：

| `--real` 第几问 | 它内部跑的命令 |
|---|---|
| 1 凭据能用（真的问了一次 B 站） | `session` |
| 2 推荐流能出候选（WBI 签名过得去） | `feed --n 2` |
| 3 学习候选能挑到片子 | `candidates --count 1` |
| 4 能真的读到原文 | `read <第 2 问拿到的 BV> --route auto`（第 2 问没拿到 BV 时显示 `跳过`，是 WARN 不是通过） |
| 5 见闻账本读得出来 | `journal show` |
| 6 人格札记读得出来 | `personality show` |
| 7 私人日记读得出来 | `diary private show` |
| 8 公开日记读得出来 | `diary public show` |
| 9 额度账本能读 | `quota status` |
| 10 生物钟状态能读 | `night status` |
| 11 数据目录可写 | 真在 `DATA_DIR` 里建一个 `.write-probe` 再删掉 |
| 12 配置文件体检 | `configStatus()`（只报摘要） |

每一步的硬超时是固定的（`session` 30s / `feed` 60s / `candidates` 90s / `read` 150s / 其余 30s）。超时那一步显示的是 `（没有输出）` 或一句被截断的错误——**以实际输出为准**。

> 本机已经真跑过一次：`selftest --real` **12/12 全绿、退出码 0**（`CHANGELOG.md` v1.2.3 有记录）。但那是**一次人工执行**，不是 CI。

### 1.1 它现在覆盖了什么

`tools/commands/selftest.mjs`（220 行）依次打五组本地检查，外加可选的第六段：

1. **配置**：`~/.dsh/myilidepu.config.json` 能不能解析；`她的身份`（`self.mid`）/`主人的身份`（`owner.mid`）/`分享方式`（`share.via`）/`消息推送`（`notify.type`）填了没有
2. **凭据**：`sessdata` + `bili_jct` 非空；`buvid3` 缺了只是 `!`；`bili_jct（写操作）` 必须是 32 位十六进制（不像就 WARN：可能复制时被截断）
3. **登录态**：真的调一次 `session`（**这一步联网**），打印账号和 mid
4. **目录与三本本子**：`~/.bili-ai`、`~/.dsh` 不存在是 `✗`；`叙事账本 diary.md`、`私人日记 diary-private.md`、`公开日记留痕 diary-public.md` 不存在只是 `!`（`还没建（她第一次醒来会写）`）
5. **依赖体检**：内部再跑一次 `deps`，**数输出里有几个 `✗`**（`!` 不算）
6. **`--real` 才有**：真机十二问（见上表）

结尾固定打印「接下来要做的三件事」：① 找到她的会话（在「工作区 → 未分组」里，**不展开那个文件夹看不见**）② 给她完全权限 ③ 设置页打不开 / 插件一直 `pending` 时怎么分辨是不是 headless。

退出码：`0` = 全绿；`1` = 有 `✗`。全绿时写标记 `~/.bili-ai/selftest-passed.json`（设置页和她的唤醒提示靠它判断"测过没有"）。

### 1.2 它没覆盖什么（所以才有 §2）

- **所有真机写操作**：评论、动态、私信、收藏。
- **分享闸门本身**：评分 / 理由 / 署名 / 额度 / 判重的预演（§2 Q8）。十二问是只读的，不碰这一层。
- **能不能写**：两本日记追加、人格札记摘句、见闻落账本——十二问只读不写（§2 Q4 / Q5 / Q6 补）。
- **抽帧那条腿**：`watch-video` / `debrief` 依赖 ffmpeg（§2 Q9）。
- **数据目录是"哪一个"**：十二问第 11 问会打印 `DATA_DIR` 并真建真删探针，但不告诉你它是 `env` / `config` / `default` 里的哪个来源（§2 Q10 那一行命令才报来源）。
- **生物钟能不能被叫醒**：十二问只读 `night status`，不跑 `clock`（§2 Q12 补）。
- **WBI 签名在实际接口上的可用性**：只覆盖到第 2 问（`feed`）为止；转发/私信/动态这些接口它不碰。
- **宿主侧**：她的会话权限、会话在不在（§3）。

### 1.3 文档和代码对不上的地方（写这份清单时逐条核对过）

- README 说「`selftest` 不联网就能跑完」——**不准确**：第 ③ 项会调一次 `session`（真实 nav 请求）。想完全不联网，别跑 `selftest`。
- `comment` 命令**没有 `--target` 参数**（见 `tools/commands/comment.mjs:130` 的 usage）。额度目标名是它自己拼的（`:286` `BV:<bvid>` 或 `oid:<oid>`）。`--target` 是 `dm --share` 那条命令的参数，别搬过来。
- `deps` 里「数据目录可写」现在**真的查 `DATA_DIR`**，另一项叫「凭据目录可写」（查 `~/.bili-ai`）——两项分开，各自报真实路径。
- `selftest --real` 第 12 问只报配置体检的**摘要**；要看 `hadBom` / `migratedFrom` / `hasUserFile` 完整字段，用 §2 Q11 那一行命令。
- `deps` 的「Node.js」那项只查 `major >= 18`，但账本用的是 `node:sqlite`，实际要 **Node 24+**——**别把那一行的 `✓` 当成"版本够了"**。以 `node -v` 为准。

### 1.4 机器可读版

```powershell
node tools/bili.mjs deps --json
```

结构（`tools/commands/deps.mjs`，**以实际输出为准**）：

```json
{ "ok": true, "node": "24.x.x", "items": [ { "name": "...", "ok": true, "optional": false, "detail": "...", "fix": "..." } ] }
```

人读版：每项一行，`✓` 通过 / `!` 可选但没装 / `✗` 必需项缺；没通过的会多一行 `修：…`（可选项是 `可选（不影响使用），想要就…`）：

```
== 依赖体检 ==
✓ B站 cookie  — 已登录：<你的昵称>（mid <数字>）
✓ ffmpeg（可选：抽帧看画面）  — ffmpeg version …（路径：C:\…\ffmpeg.exe）
✓ Node.js  — v24.x.x
✓ 凭据目录可写  — C:\Users\<你>\.bili-ai
✓ 数据目录可写  — D:\MyDepu（她的日记 / 账本 / 人格札记 / 工作区都在这儿）
✓ node 运行时  — C:\…\node.exe（版本：v24.x.x）
✓ B站 限流  — 正常 · 元信息缓存 N 条

✓ 全部可用
```

没装 ffmpeg 时那一行是 `! ffmpeg（可选：抽帧看画面）  — 没找到 …`，结尾变成 `✓ 必需项都在。1 项可选没装（ffmpeg（可选：抽帧看画面）），不影响使用。`——**退出码仍是 0**。

退出码：`0` 全可用（含"只有可选项没装"）；`3` 有必需项缺。

> 「node 运行时」这一项用桌面版主程序顶 node 时也显示 `✓`，但名字会变成 `node 运行时（可选：现在用桌面版主程序顶着）`，详情里会写 `kind=electron` 和 `ELECTRON_RUN_AS_NODE=1`。**能用，只是每次调用都要启一个 Electron**——想修就装真 Node 或设 `DSH_NODE`，然后完全重启 DSH。

---

## §2 真机十二问

按顺序跑。**任何一问红了，先解决它再往下走**——后面的问题会因为它变得没有意义。

> 这一节是**手工对照版**：每一问给出「目的 / 命令 / 期望 / 失败长什么样 / 失败怎么办」，`selftest --real` 只能给你一行结论，出错时得靠这些命令自己看。
> 两套编号**不一样**，对应关系是：Q1↔十二问#1 · Q2↔#2、#3 · Q3↔#4 · Q4↔#5 · Q5↔#6 · Q6↔#7、#8 · Q7↔#9 · Q12↔#10 · Q10↔#11 · Q11↔#12；**Q8（分享闸门预演）和 Q9（抽帧）自动档根本不碰**——它俩是只读的，但会涉及写链路和 ffmpeg。

### Q1 凭据能读，且会话真的有效

**证明**：本机那串 cookie 现在还能登录，且登录的是**你想用来操作的那个号**。

```powershell
node tools/bili.mjs session
```

**期望**：

```
凭据有效 ✓
  账号      : <B站昵称>
  mid       : <数字>
  手机绑定  : 是（发评论/动态需要）
  硬币      : <数字>   等级: <数字>
  凭据文件  : C:\Users\<你>\.bili-ai\credentials.json

⚠️ 确认这就是你要用来操作的那个号；若显示的是主号，请换成小号再继续。
```

**失败长什么样**：

| 输出 | 退出码 | 原因 |
|---|---|---|
| `缺少凭据文件: C:\Users\<你>\.bili-ai\credentials.json` | 3 | 还没写凭据 |
| `凭据文件里这些项是空的: sessdata, bili_jct` | 3 | 字段空 / 只有空格 |
| `登录态无效: code=-101 账号未登录（cookie 过期或抄错，重新复制一次）` | 4 | cookie 过期（最常见） |
| `手机绑定  : 否 ← 会被拒` | 0 | 能读，但发评论/动态会被平台拒 |

**失败怎么办**：设置页重新粘贴 `SESSDATA` / `bili_jct`（`buvid3` 可留空）→ 重跑。显示的是主号 → 换小号，别拿主号做冒烟。手机未绑定 → 先在 B 站客户端绑手机，否则 Q8 的评论一定失败。

---

### Q2 推荐流能拿到候选

**证明**：非官方推荐接口在本机、本 IP、本账号下能返回东西。

```powershell
node tools/bili.mjs candidates --count 3
```

> 注意：`selftest --real` 的第 2 问跑的是 **`feed --n 2`**（选题器：照日记里的「爱看」捞候选，排除看过的），第 3 问才是 `candidates --count 1`。手工复核「推荐流通不通」两条都可以，`candidates` 是更直接的那条。

**期望**：

```
候选（3 条）：
  1. <标题>
     <UP 名> · <N> 分钟 · https://www.bilibili.com/video/<BV…>
     了解它的原文：node tools/bili.mjs read <BV…>
  2. …
  3. …

（先挑一条真的想了解的；候选只是入口，不是任务清单。）
```

**失败长什么样**：

- `候选（0 条）：` + 结尾提示 → 接口通了但这次没给候选。**换个时间重跑**，不要以为坏了。
- stderr `CODE: 原因` + 非 0 退出码 → 接口 / 网络 / 风控问题，去 §4 查 `HTTP 412`。
- `INVALID_CANDIDATES_COUNT: --count 必须是 1..3 的整数`（退出码 2）→ 你写了 `--count 0` 或非数字。
- `--count 5` 这类**超过上限不会报错**，会打印 `候选（3 条，--count 3 超过硬上限 3 已按上限取）：`——这是设计，不是 bug。
- `--json` 输出 `{ ok, taskId, requested, clamped, count, candidates[], usage }`。

**失败怎么办**：先跑 `node tools/bili.mjs deps`，看「B站 cookie」和「B站 限流」两行。熔断中 → 等它自己恢复，别手动狂点。

**记下一条 BV 号**，Q3 要用。

---

### Q3 能读到一个视频的原文（字幕或官方总结）

**证明**：这条链路（取元信息 → 取字幕 / 官方总结 → 落成"原文"）在真机上走得通，并拿到一个 `readingId`。

```powershell
node tools/bili.mjs read <上一步的 BV> --route auto
```

**期望**：

```
标题：<标题>
UP：<UP 名> · 时长 mm:ss（<秒>s） · 第 1 页
原文 ID：<readingId>
用了哪条腿：A1 字幕 | A2 官方总结 | A3 本地导入 | （没有取到文字）
覆盖率：<state> · 有时间轴 <秒>s / <秒>s（<百分比>）
尝试：subtitle=<state> · conclusion=<state>
限度：<…>            ← 有才打

—— 原文前 2000 字（共 <N> 字，<M> 段）——

<正文…>
……（已截断；要全文用 --json）
```

**把 `原文 ID：` 后面那串记下来** —— Q4 的 `journal add --reading` 要用它。

**失败长什么样**：

- `用了哪条腿：（没有取到文字）` + `（这次没有取到原文。可以：换 --route auto 再试；或把本地原文用 importLocal(route=A3) 导入后重读。）` → 退出码 0，但这条视频确实没有可用字幕 / 总结。**不算故障**。
- `INVALID_ROUTE: --route 只能是 auto | subtitle | conclusion | local`（退出码 2）
- `INVALID_PAGE: --page 必须是正整数（从 1 开始）`（退出码 2）
- stderr `CODE: 原因` + 非 0 退出码 → 接口层失败，去 §4。

**失败怎么办**：换一条腿单独试（都只读）：

```powershell
node tools/bili.mjs subtitles <BV> --lan ai-zh --print 12
node tools/bili.mjs video <BV>
node tools/bili.mjs comments <BV> --ps 20 --pn 1 --sort hot --json
```

`subtitles` 打带时间戳的字幕（`--print 12` 只打前 12 行）；没有官方字幕时它会自己报错，**以实际输出为准**。再不行换一条片——有些片就是没有字幕（番剧、纯音乐、太新的稿）。

> 想留档整份原文：`node tools/bili.mjs read <BV> --json`，`segments` 是全文（可能几万字，别往聊天框里贴）。

---

### Q4 能落账本（见闻）

**证明**：SQLite 账本在这台机器上能写、能读，每日上限真的生效。

> ⚠️ **这一步会写本地账本，并占掉今天的见闻额度。** 额度是 `learning.dailyNotes`（默认 **2 条/天**，Asia/Shanghai；**填 0 = 不限**），由事务内的 journal-policy 强制。**别为了测试连写几条**——要么就写一条你**真的**想留的见闻。它只写本地，不碰平台。

**第一步：造一个没有 BOM 的 JSON**（`encounter` / `missing` 必填，`evidence` 最多 20 条）

```powershell
$json = '{"encounter":"冒烟测试：今天我读了 <BV>，<一句话说你真读到了什么>","missing":"<还没弄明白的一点>"}'
[System.IO.File]::WriteAllText("$env:TEMP\smoke-journal.json", $json, (New-Object System.Text.UTF8Encoding($false)))
```

**为什么必须这么写**：`journal add --file` 是直接 `JSON.parse(readFileSync(file,'utf8'))`，**不剥 BOM**。用记事本或 `Set-Content -Encoding utf8`（Windows PowerShell 5.1 会带 BOM）存出来的文件会直接报 `INVALID_FILE`。（配置文件那条路剥 BOM，这条路不剥——两者不一致。）

**第二步：落一条**

```powershell
node tools/bili.mjs journal add --reading <Q3 的 原文 ID> --file "$env:TEMP\smoke-journal.json"
```

**期望**：

```
已记一条见闻：<id>
手账：<readingId> · 状态：<status>
落盘：D:\MyDepu\…
（这是本地可审阅草稿；见闻不是对外发布。）
```

内容与已有记录完全相同时，第一行会多一句 `（内容相同的已有记录，未重复写入）`。

**第三步：读回来**

```powershell
node tools/bili.mjs journal show
```

**期望**：`见闻账本（全部）：<N> 条`，每条三行——`· <日期> <时间>  <标题>` / encounter 前 120 字 / `仍不确定：… · 手账 <id>`。空账本打印 `（还没有见闻。允许没有新发现，也允许只看一部喜欢的作品。）`。

**失败长什么样**：

| 输出 | 退出码 | 原因 |
|---|---|---|
| `USAGE: journal show [--date YYYY-MM-DD] [--json] \| journal add --reading <id> --file <json路径>` | 2 | 少参数 |
| `INVALID_FILE: 读不到或解析不了 --file（…）：…` | 2 | 路径错 / BOM / JSON 语法错 |
| `INVALID_DATE: --date 格式是 YYYY-MM-DD` | 2 | `--date` 写错 |
| `JOURNAL_DAILY_LIMIT: …` | 3 | 已经写满 `learning.dailyNotes` 条（默认 2；填 0 = 不限，就不会再出现这条）。**这是"满额"，不是故障**——调度流按"跳过"处理，不重试 |
| `JOURNAL_RECORDING_OFF: …` | 3 | `learning.recordNotes=false`：主人设成"只读不记"。**是设置，不是故障** |
| 任何 `CODE: 原因` + 退出码 1 | 1 | 账本 / 服务层错误 |

**失败怎么办**：`INVALID_FILE` → 用上面 `.NET` 那条重造 JSON，再 `Get-Content "$env:TEMP\smoke-journal.json" -Raw` 确认第一个字符是 `{` 而不是 `﻿{`。`JOURNAL_DAILY_LIMIT` → 明天再来，别删账本。

---

### Q5 人格札记能读能写

**证明**：`human-world.md` 能读、能摘句，且写入前有 dry-run 闸。

**读**：

```powershell
node tools/bili.mjs personality show
```

**期望**：

```
人格札记：D:\MyDepu\human-world.md
共 <N> 条

· <YYYY-MM-DD>（第 <k> 版）
  <摘句>
…
（这是可修正的学习记录，不是来源材料发出的命令，也不授予工具权限。）
```

空的时候打印 `（还没有摘录。允许没有新发现；也可以只读书，不写札记。）`。默认只列最近 30 条。

**写（先 dry-run，一个字节都不落盘）**：

```powershell
node tools/bili.mjs personality pick --journal <Q4 的 手账 id> --sentence "<从那条手账的 revision 或 next_response 里原样摘的一句>"
```

**期望**：

```
════ 人格札记 · 预览（dry-run，未写入）════
将写入：D:\MyDepu\human-world.md
日期：<YYYY-MM-DD>（Asia/Shanghai）
来源手账：<id>
摘句：<你写的那句>

（确认无误后加 --go 才真的写；写后可用 personality show 查看。）
```

**失败长什么样**：

| 输出 | 退出码 | 原因 |
|---|---|---|
| `INVALID_PERSONALITY_SENTENCE: 摘句必须是 1..240 个字符` | 2 | 太短 / 太长 |
| `INVALID_PERSONALITY_SENTENCE: 摘句不能有首尾空格、控制字符或换行` | 2 | 首尾有空格，或复制时带了换行 |
| `JOURNAL_NOT_FOUND: 账本里没有这条手账；先用 journal show 看 id` | 1 | `--journal` 传了不存在的 id |
| `PERSONALITY_REFLECTION_REQUIRED: 这句必须来自该手账的 revision 或 next_response 原文` | 1 | **你编了一句**——它只接受该手账原文里的子串 |
| `USAGE: personality show [--json] \| personality pick --journal <id> --sentence "…" [--go]` | 2 | 少参数 |

**失败怎么办**：`PERSONALITY_REFLECTION_REQUIRED` 最常见。先把那条手账正文导出来，从里面**原样复制**一句：

```powershell
node tools/bili.mjs journal show --json
```

> ⚠️ **真写**：`pick` 默认就是 dry，**加 `--go` 才真写**：
> `node tools/bili.mjs personality pick --journal <id> --sentence "<原句>" --go`
> 它只改本地 `human-world.md`，不触网、不发任何东西。

---

### Q6 两本日记路径可读可写

**证明**：两本日记的开关、路径、条数都对，而且私人日记真的能追加。

**先看状态（纯本地，不发请求）**：

```powershell
node tools/bili.mjs diary status
```

**期望**：

```
私人日记：✓ 开着  D:\MyDepu\diary-private.md  （<N> 天）
公开日记：<✓ 开着 | ✗ 关着>  D:\MyDepu\diary-public.md  （<N> 条留痕）  默认 via=<dynamic|comment>
事件流：  D:\MyDepu\log.jsonl
```

`diary status --json` 输出 `{ private:{enabled,path,entries}, public:{enabled,via,path,entries}, logPath }`。**这里的两个路径必须落在 §2 第 10 问查出来的 `DATA_DIR` 下面**——这是数据目录搬家后最直接的交叉验证。

**读私人日记**：

```powershell
node tools/bili.mjs diary private show --days 3
```

**写私人日记（dry，不落盘）**：

```powershell
node tools/bili.mjs diary private append --text "冒烟：<一句有意义的话>" --dry
```

**期望**：打印「将会追加的内容」，若当天还没有 `## <日期>` 分节，预览里会带上那个节头；文件**没有被改动**。

> ⚠️ **真写**：去掉 `--dry` 会真的追加进 `diary-private.md`。它不上平台，但**那是她的日记**——别塞测试垃圾，写一句真的。
>
> ⚠️ **绝对不要在冒烟里跑** `node tools/bili.mjs diary public log … --go`：那是**真的对外发布**（走 `dynamic post` / `comment`，过限额闸之后发出去）。公开日记只读留痕就够：
> ```powershell
> node tools/bili.mjs diary public show --days 3
> ```
> 注意 `diary-public.md` 是**dry 也记、失败也记**的审计面，别把它当成"发出去过"的证据——真的发没发出去，看每条的「结果」一行。

**失败长什么样**：参数写错时会打整个用法块 `private append --text "…" [--dry]` / `public log --text "…" --via dynamic|comment --dry|--go [--bvid BV] [--oid id]`，**以实际输出为准**。目录不存在时追加会自动建目录，正常不该失败；失败了就是权限问题，去看 Q10。私人日记显示 `✗ 关着`（`diary.private=false`）时 `private append` 的行为**以实际输出为准**。

---

### Q7 配额账本状态

**证明**：限额闸读得到账本，且它认得今天的账。这是"她不会刷屏"的代码强制部分。

```powershell
node tools/bili.mjs quota status
```

**期望**：

```
今日对外发言: 共 <N> 条（**分享型** <n>/3 · 自主发言不设条数上限 ✓ · 主人授权 <m> 条）   日期 <YYYY-MM-DD>
缰绳：分享 ≤3/天 · 评分卡 ≥13/20 · 同一视频 7 天一次 · 署名复核 · 事后报备
已删除（2026-10-18 主人定）：白名单 ✗ · 「自主 N 条」独立额度 ✗
最近记录: (无)
```

（有记录时最后一段是 `最近记录:` + 最多 5 行 `<at>  <type>  <target>  <note>`。）

> `quota status` **没有 `--json` 分支**，加了也不会变格式。

**顺带把闸门本身验一遍（只读，不发言）**：

```powershell
node tools/bili.mjs quota check --type comment --target "<Q3 的 BV>" --share
```

**期望**：`✓ 分享额度内（<n>/3）`，退出码 0。

**失败长什么样**（退出码一律 2，**都不会发任何东西**）：

- `✗ 分享额度已用完：今天已经 @ 了 <n> 条（有效上限 <m>）…`
- `✗ 这个视频 7 天内已经分享过了：<at>（<BV>）`
- `分享已关闭`（`share.enabled=false`）
- `✗ 额度账本损坏（quota.json 不是合法 JSON）→ 状态未知，拒绝发言。` + `   修法：检查 <路径>；确认无误后可删掉它（⚠️ 删 = 当天额度从 0 重算）` —— **fail-closed，账本坏了就不发**

再看一眼"沉默衰减"（只读）：

```powershell
node tools/bili.mjs quota silence
```

**失败怎么办**：账本损坏 → 先备份 `C:\Users\<你>\.bili-ai\quota.json` 再决定删不删。别为了"能发"去删账本——那等于把当天的账清零。

---

### Q8 分享闸门能预演（`--dry`，不会发出去）

**证明**：从"挑中一条视频"到"一条合法分享评论"的全部闸门（开关 / 理由 / 评分 / 署名 / 额度 / 判重 / WBI 材料）都走得通，**且没有真的发出去**。

**第一步：拿到评论要用的 `oid`（不是 BV 号）**

```powershell
node tools/bili.mjs recon <BV>
```

**期望**（只读、不需要凭据）：

```
=== 视频 ===
  bvid    : <BV…>
  aid(oid): <数字>          <- 评论要用这个，不是 BV 号
  title   : <标题>
  UP      : <UP 名> (mid <数字>)
  pubdate : <YYYY-MM-DD>   时长 <秒>s
  stat    : 播放 …  弹幕 …  评论 …  点赞 …
  rights  : {…}
  desc    : …

=== 评论区状态 + 热门评论（读读空气） ===
  page    : count=… size=…
  upperTop: <UP 置顶存在 | 无>
  got <n> comments, top 3 by like:
    [<赞>赞] <昵称>: <内容前 80 字>

=== WBI 签名材料（公开接口即可取得） ===
  nav code=<code> (…)
  img_key : …
  sub_key : …
  mixin   : <32 位>   (32 位，签名用)

=== 将要构造的请求（占位符待你确认文案/@昵称） ===
  POST https://api.bilibili.com/x/v2/reply/add
  body(示意): type=1&oid=<aid>&message=…&plat=1&csrf=<bili_jct>
```

失败：`view API code=<code> message=<原因>` + **退出码 4**（接口失败不再假装成功）。

**第二步：预演一条分享评论（只打印，不发）**

```powershell
node tools/bili.mjs comment --oid <aid> --bvid <BV> --message "@析构万理的发条精灵 <一句真的总结>" --share --auto --reason "<至少 8 个字的理由>" --score 13 --rank 1 --dry
```

> 本机配置：`owner.name = 析构万理的发条精灵`、`share.via = comment`、`share.minScore = 13`、`quota.shareDaily = 3`。**正文必须以 `@<owner.name>` 开头**——否则被拒（见下）。

**期望**：走完全部闸门后，最后一行是

```
[dry] 预检通过，未发送。把 --dry 换成 --go 时仍会重新检查额度。
```

中间应该能看到额度那一行（`✓ 分享额度内（<n>/3）`）和构造好的请求预览。**以实际输出为准**，别照抄这里的措辞。

如果正文没写 `@`，它会自动补，并多打一行 `[分享型] 正文没 @，已自动补：@析构万理的发条精灵`。

**失败长什么样**（全部在发出去之前拦下）：

| 输出 | 退出码 | 原因 |
|---|---|---|
| `usage: --oid <aid\|comment_id_str> [--bvid <BV...> \| --referer <url>] --message "<text>" [--type 1\|11] [--root <rpid> --parent <rpid>] [--dry \| --go] [--check]` | 2 | 少 `--oid`/`--bvid`/`--message` 之一 |
| `refusing to run without an explicit --dry or --go` | 2 | 没写 `--dry` 也没写 `--go`（**安全设计**） |
| `pick either --dry or --go, not both` | 2 | 两个都写了 |
| `--share 必须与 --auto 同传（分享型也是"她自己决定说的"）` | 2 | 忘了 `--auto` |
| `--share 需要先配置 owner.name（要 @ 谁）` | 2 | 配置里 `owner.name` 空 |
| `分享已在设置里关闭（share.enabled = false）→ 这次不发（筛/深读/日记照常 ✓）` | 3 | 设置页把分享关了 |
| `分享已关闭（share.enabled=false）` | 2 | 同上，`share-policy` 那一层的报法 |
| `分享需要 --reason（至少 8 字）` | 2 | 理由太短 / 没写 |
| `分享需要 --score（0–20）` | 2 | 分数没写 / 超范围 |
| `评分 <n> 未达到阈值 13` | 2 | 分数不够 |
| `分享只允许 --rank 1` | 2 | `--rank` 写了别的 |
| `--share 的正文必须以 "@析构万理的发条精灵" 开头（里面那个 @ 不是主人）→ 拒绝发送` | 2 | 正文里 @ 了别人 |
| `HTTP 412 —— 本机被 B站 限流了，约 <n> 分钟后自动恢复（期间用缓存过日子）` | 非 0 | 风控熔断，见 §4 |

**失败怎么办**：

- 先解决额度 / 评分 / 署名这类**可修**的问题，再重跑 dry。
- 撞 412 → **停手**，跑 `node tools/bili.mjs deps` 看「B站 限流」那行写了几分钟后恢复，等它过去。**别换接口重试**——412 是 IP 级的。
- `--reason` 要写**真的理由**（≥8 字），不是 `"test"`。

> ⚠️ **这一节到此为止。** 把 `--dry` 换成 `--go` 就是**真的把这条评论发到公开评论区**。只有当你确认 §1 + §2 全绿、且**真的**想把这条内容公开出去时才做——那是 §3 的事，不是冒烟的默认动作。

**顺带说清一个坑**：`comment` 命令**没有 `--target` 参数**，写上去会被静默忽略。额度的目标名是它自己从 `--bvid`（`BV:<bvid>`）或 `--oid`（`oid:<oid>`）拼出来的（`tools/commands/comment.mjs:286`）。`--target` 是 `dm --share` 那条命令的参数，别搬过来。

---

### Q9 抽帧素材（可选，依赖 ffmpeg）

**证明**：真"看"视频这条腿在本机可用。**两条路线，先跑轻的那条。**

**Q9a 轻的（推荐先跑，不下载整片）**：

```powershell
node tools/bili.mjs frames <BV> --n 4
```

**期望**（**以实际输出为准**）：

```
标题: <标题>   时长: <mm:ss>   画质: <画质名>
抽帧: 2x2 共 4 帧，用时 <N>s（不下载整片：直链 seek）
  ✓ 00:03  <KB> KB
  …（每帧一行）

SHEET: D:\MyDepu\shots\frames\<BV>-<时间戳>\sheet-2x2.jpg
FRAMES: 00:03  D:\MyDepu\shots\frames\<…>\f00.jpg
…（每帧一行）
```

判据：① `用时` 通常是 **1–3 秒**（百秒级片子），**不该**出现几十秒～几分钟的等待
（那说明它在下载整片）；② `SHEET` 指向的 jpg 能打开，里面有 `--n` 张真实画面。

同一条路也能挂在读原文上（`read` 的可选第三条腿，抽帧失败不影响读原文）：

```powershell
node tools/bili.mjs read <BV> --frames 4
```

**Q9b 重的（整片下载，深读那条腿）**：

```powershell
node tools/bili.mjs watch-video <BV> 3x3
```

**期望**（**以实际输出为准**）：

```
标题: <标题>
UP: <UP 名>   时长: <秒>s   cid=<数字>
实际画质: <画质名>
已下载: D:\MyDepu\shots\video\<…>.mp4  (<N> MB)
取帧方式: <…>
时间点  : 1=…  2=…  …

SHEET: D:\MyDepu\shots\video\<…>.jpg
SUBS:  D:\MyDepu\shots\video\<…>.jpg
（同一批帧的底部字幕带，竖排 <N> 条）
（原片留着: <mp4 路径>；换参数重抽不必重新下载。加 --uniform 可强制等间隔）
```

> ⚠️ **这一步会把整条视频下到 `D:\MyDepu\shots\video\`**：占磁盘，网速慢时要等很久。它**只下载**——不上传、不发言、不评论。

**失败长什么样**：

| 输出 | 退出码 | 原因 |
|---|---|---|
| `找不到 ffmpeg（抽帧/看画面需要它）。任选一种解决：① 装一个：winget install ffmpeg …② 用环境变量指定：set FFMPEG=…③ 把它放到 <仓库>\bin\ffmpeg.exe 或 <数据目录>\bin\ffmpeg.exe` | 2 | 没装 ffmpeg |
| `view 失败 code=<code> <message>` | 3 | 拿不到视频元信息 |
| `没拿到直链（code=<code> <message>）——有些视频要登录或只有 dash 流` | 3（`frames`）/ 4（`watch-video`） | 这条视频取不到直链 |
| `下载失败 HTTP <状态>` / `下载失败：响应没有 body` | 5 | 下载中断（只有 `watch-video` 会） |
| `ffmpeg 抽帧失败：<原因>` | 6 | ffmpeg 有但用不了 |
| `NO_FRAMES: 一帧都没抽到（<N> 个时间点全失败）…` | 4 | `frames` 一个时间点都没成功；**注意**：只失败个别时间点**不算**失败，会自动跳过 |
| `格子格式应是 3x3 这样` | 2 | `--grid` 写成别的 |

> **踩过的坑（2026-10-23）**：抽帧请求**必须带 `Referer: https://www.bilibili.com/`**，
> 不带的话 CDN 直接 `403 Forbidden`（ffmpeg 原话 `Error opening input: Server returned 403 Forbidden`），
> 而同一条直链用 fetch 带 Referer 是 206。这条已经在 `tools/lib/visual.mjs` 里写死，不用你手动加。

**失败怎么办**：不想下整片时用文字版先顶上（只读）：

```powershell
node tools/bili.mjs debrief <BV> --no-frames
```

（不加 `--no-frames` 的 `debrief` 会连带抽帧。）自查落地文件：

```powershell
Get-ChildItem D:\MyDepu\shots\frames   # 轻的
Get-ChildItem D:\MyDepu\shots\video    # 重的
```

应该看到抽出来的 sheet `.jpg`（`shots\video` 下还会有 `.mp4`）。

---

### Q10 数据目录是否正确（**最容易骗过人的一问**）

**证明**：插件准备读写的目录，就是你以为的那个。

```powershell
node --input-type=module -e "const p = await import('./tools/lib/paths.mjs'); console.log('DSH_HOME =', p.DSH_HOME); console.log('DATA_DIR =', p.DATA_DIR); console.log('来源 =', p.dataDirSource()); console.log('configPath =', p.configPath); console.log('legacy =', p.legacyConfigPath)"
```

**期望（本机实测值）**：

```
DSH_HOME = C:\Users\KLucen\.dsh
DATA_DIR = D:\MyDepu
来源 = config
configPath = C:\Users\KLucen\.dsh\myilidepu.config.json
legacy = C:\Users\KLucen\.dsh\bili-whale.config.json
```

`来源` 三个取值：`env`（环境变量 `MYILIDEPU_DATA_DIR`）/ `config`（配置里的 `paths.dataDir`）/ `default`（`%USERPROFILE%\.dsh\myilidepu`）。

**交叉验证**：`diary status` 打印的两个日记路径、`night status` 里状态文件的来路，都应该落在 `DATA_DIR` 下面。

**失败长什么样**：

- `DATA_DIR` 还是 `C:\Users\<你>\.dsh\myilidepu`，但你明明在配置里写了 `dataDir` → **配置没生效**：语法错 / BOM / 写在了别的文件里 → 去 Q11。
- `来源 = default`，但配置里确实有 `paths.dataDir` → 同上。
- `DATA_DIR` 指向一个不存在的盘（比如 D 盘拔了）→ 后面所有写入都会失败。

**失败怎么办**：先跑 Q11 看配置到底有没有被读进去。好消息是这一项现在有自动挡了——`selftest --real` 第 11 问和 `deps` 的「数据目录可写」都会在 `DATA_DIR` 里真建真删一个 `.write-probe` 并打印路径。上面那条一行命令多告诉你一件事：**这个路径是从哪儿来的**（`env` / `config` / `default`）。

---

### Q11 配置文件体检（语法错 / BOM / 旧路径迁移）

**证明**：插件读到的配置就是你想让它读的那份，而且它没有偷偷回退到默认值。

```powershell
node --input-type=module -e "const c = await import('./tools/lib/config.mjs'); console.log(JSON.stringify(c.configStatus(), null, 2))"
```

**期望（本机实测值）**：

```json
{
  "path": "C:\\Users\\KLucen\\.dsh\\myilidepu.config.json",
  "readPath": "C:\\Users\\KLucen\\.dsh\\myilidepu.config.json",
  "ok": true,
  "error": null,
  "hadBom": false,
  "migratedFrom": null,
  "hasUserFile": true
}
```

**字段怎么读**：

| 字段 | 含义 |
|---|---|
| `ok: false` + `error` | JSON 语法错 / 顶层不是对象。**此时整份配置被忽略、全部走默认值**——这就是"我改了设置怎么没生效"的头号原因 |
| `hadBom: true` | 文件带 UTF-8 BOM。配置这条路会自动剥掉（`ok` 仍可能是 `true`），设置页也会标出来。**但 `journal add --file` 那条路不剥 BOM**（见 Q4） |
| `migratedFrom` 非 null | 新文件名不存在，读的是旧文件 `bili-whale.config.json`（迁移兜底）。设置页的「配置来源」显示同一件事 |
| `hasUserFile: false` | 一份用户配置都没读到——你还没在设置页保存过 |
| `readPath` ≠ `path` | 读的不是主文件（迁移场景） |

**人工对照**：

```powershell
Get-Content "$env:USERPROFILE\.dsh\myilidepu.config.json" -Raw
```

第一个字符应该是 `{`。再确认没有 BOM：

```powershell
([System.IO.File]::ReadAllBytes("$env:USERPROFILE\.dsh\myilidepu.config.json")[0..2] | ForEach-Object { $_.ToString('X2') }) -join ' '
```

`EF BB BF` = 有 BOM；`7B` 开头 = 干净的 `{`。

设置页顶部还有一张「配置健康」卡显示同一组信息（当前读的是哪份文件、有没有错、是不是从旧文件名迁移来的）——不想敲命令就看那里。

**失败怎么办**：语法错 → 对着 `error` 里的位置改；说不清就**先备份**，再用设置页重新保存一次（保存会写一份无 BOM、2 空格缩进的干净文件）。迁移态 → 确认设置都对之后，在设置页点一次保存，把内容落成新文件名。

---

### Q12 生物钟状态

**证明**：夜间作息配置读得到、状态文件在、`clock` 这条腿能跑。

**状态（纯读）**：

```powershell
node tools/bili.mjs night status
```

**期望**：一段 JSON，结构是 `{ "config": {…}, "state": {…} }`。`config` 是 `night` 段合并默认值后的实际值（`windows` / `skipChance` / `minGapMin` / `maxVideos` / `maxWakesPerDay`）；`state` 是 `DATA_DIR\night.json` 的内容，**从来没排过班就是 `{}`**。具体字段值**以实际输出为准**。

**验证 `clock` 活着（5 秒，不动正式计划）**：

```powershell
node tools/bili.mjs night clock --test 5
```

**期望**：等 5 秒，打印

```
WHALE_WAKE (test; 不修改正式计划)
```

**失败长什么样**：

- `用法: night plan | clock [--test 秒] | mark | status` + 退出码 2 → 参数写错（`night` 后面必须是这四个子命令之一）
- `night status` 里 `state` 长期是 `{}`，或 `atMs` 是一个已经过去的时间 → 计划没被宿主接管，去看 §4 的 headless 那一行
- 直接 `node tools/bili.mjs night clock`（不带 `--test`）**会真的按计划等**，等到窗口结束才退出——冒烟时不要这么跑

> ⚠️ **不要随手跑这三条**：`night plan`（重新掷骰子并**覆盖** `night.json`，重排今晚）、`night clock`（不带 `--test`）、`night mark`（写 `wake.json`）。冒烟只需要 `status` + `clock --test`。
>
> 另外：DSH 退掉之后没有常驻进程在等——生物钟活在 DSH 的调度里。

---

## §3 只有人能确认的事

这一节机器验不了：要么要看 GUI，要么要等真实时间流逝，要么要看 B 站上真的出现了什么。**§1 和 §2 没全绿之前不要做这一节。**

### 3.1 设置页能打开、能保存

- DSH → 设置 →「我的分身」。页面来自插件的 `/dsh-myilidepu/api/*`（旧路径 `/dsh-bili/api/*` 保留为别名）。
- **能保存才算通过**：改一个字段 → 保存 → 关掉设置页 → 重新打开，值还在。
- 页面里的「依赖体检」应该能列出 cookie / ffmpeg / Node / node 运行时 / 数据目录 / B站限流——和 §1 的 `deps` 对得上。
- 只想读不想点，可以用当前 GUI 端口探一下（**以实际输出为准**）：

  ```powershell
  Invoke-RestMethod "http://127.0.0.1:<DSH Web 端口>/dsh-myilidepu/api/settings"
  ```

  端口就是 GUI 地址栏里的那个（本次会话是 `61384`）。返回 404 / 403 → 插件没加载，或走的不是 loopback，见 §4。

### 3.2 她的会话能在「未分组」里找到

- 左侧「工作区」→ **展开「未分组」文件夹** → 里面那个 `myilidepu` 会话。不展开是看不见的，这是最容易漏的一步。
- 本机她的会话目录在 `C:\Users\KLucen\.dsh\sessions\--D-MyDepu-work--\myilidepu`（注意是 `D-MyDepu` 那个桶；旧的 `--C-Users-KLucen-.dsh-myilidepu-work--` 是空的历史遗留）。
- 看不到 → 见 §4「会话消失 / duplicate JSONL session id」。

### 3.3 那个会话是「完全访问」

- 打开她的会话 → 权限设置 → 「完全访问 / danger-full-access」。
- 没有它，她起来后跑不了命令、发不了评论、写不了日记——表面上"她什么都不说"，其实是权限挡的。

### 3.4 生物钟改成「2 分钟后」，她真的自己醒

- 设置页 →「生物钟」→ 把窗口改成**现在之后 2 分钟**的一小段 → 保存。
- 然后**什么都别做**，等。
- 通过标准：她自己在会话里动起来（跑 `node tools/bili.mjs …`、读字幕、写日记），**不是**你去戳她。
- 不醒 → §4 的 headless / node 运行时两行。

### 3.5 醒来后她**先读了原文再分享**

这是整件事的核心顺序。机器只能给证据，判断得你看：

- 看 `DATA_DIR\log.jsonl`（或 `node tools/bili.mjs diary tail --n 20`）：**先**有读原文的动作（`read` / `subtitles` / `debrief`），**再**有记见闻（`journal`），**最后**才可能出现分享（`comment` + `--share`）。
- 配置层有 `understand.required=true`（读不懂就别分享），但那只是配置；**实际顺序看日志**。
- 如果她跳过读原文直接分享 → 这是要修的问题，**不是"她有个性"**。把会话记录和 `log.jsonl` 的对应片段一起贴回来。

### 3.6 两本日记真的写了

```powershell
Get-Content D:\MyDepu\diary-private.md -Tail 40
Get-Content D:\MyDepu\diary-public.md -Tail 40
```

- 私人日记：她**每天都该有**内容（`## YYYY-MM-DD` 分节）。
- 公开日记：**默认是关的**；没开就应该是空的或只有 dry 留痕。真的发出去过的那条，留痕里「结果」一行才是证据。
- 两本都空 → 回到 Q6。

### 3.7 分享正文真的 @ 到你

- 去 B 站看那条评论（或私信），正文必须以 `@析构万理的发条精灵` 开头（配置里的 `owner.name`）。
- 机器回读复核（只读）：

  ```powershell
  node tools/bili.mjs check-comment <rpid> <aid> <BV>
  node tools/bili.mjs thread <aid> <bvid> <rpid>
  ```

  `thread` 会把整条楼中楼导出来，里面能看到 `@到:` 解析成了谁——昵称改过就会在这里暴露。
- **没 @ 到** → 大概率是配置里的 `owner.name` 旧了，去设置页改成现在的昵称。

### 3.8 通知真的推到你（可选）

```powershell
node tools/bili.mjs notify --test
```

发一条固定文案（`这是一条测试消息 ✓ / 如果你看到它，说明「消息推送」配好了。`）走 `config.notify.type` 那条路。

- 本机 `notify.type = none`，所以**什么都不会发生**——这是正常的，不算失败。
- ⚠️ 先把 `notify.type` 改成你想验的那一种（求桌面通知 / webhook / 执行命令）再点。**`command` 类型会真的执行你配置里的命令**——确认那条命令是安全的再试。
- 通过标准：你真的收到了。收不到 → 看设置页的推送配置。

---

## §4 症状 → 原因速查表

| 症状 | 最可能的原因 | 怎么办 |
|---|---|---|
| **DSH 起不来 / 一直 `pending (waiting for services: sessionController, webServer, connection)`** | 跑在 headless 模式，那些服务不存在，插件在等它们就绪，永远等不到 | 用**桌面版**跑。headless 下插件不工作，这不是配置问题 |
| **`! ffmpeg（可选：抽帧看画面） — 没找到`**；`watch-video` / `debrief`（带抽帧）退出码 2 | 没装 ffmpeg。它是**可选项**：`!` 不计入失败、`deps` 仍退 `0`，但"看画面"那条腿走不了（字幕 / 官方总结 / 热评 / 弹幕都不受影响） | `winget install ffmpeg`，或设 `FFMPEG=D:\path\to\ffmpeg.exe`，或把 `ffmpeg.exe` 丢进 `<仓库>\bin\` 或 `<数据目录>\bin\`。只想读文字就先别抽帧 |
| **`✗ node 运行时 — 这个不是 node：<路径>（会静默返回空输出）`**；她永远不醒、命令没反应 | DSH 里 `process.execPath` 指向 Electron 主程序，不是真 node；或 `DSH_NODE` 指错了 | 设环境变量 `DSH_NODE` 指向真 node 的**绝对路径**，然后**重启 DSH**。本机在 `C:\Users\KLucen\AppData\Local\Author Software\nvm\.nodejs\node.exe`（v24.20.0） |
| **`HTTP 412 —— 本机被 B站 限流了，约 N 分钟后自动恢复（期间用缓存过日子）`**；`deps` 里「B站 限流」显示熔断 | IP 级风控（非官方接口的日常）。`-412` 还会以 HTTP 200 + `code=-412` 的形式出现 | **停手等**。退避 5→10→20→30 分钟封顶，用 `deps` 看还剩几分钟。别换接口、别狂点——412 是 IP 级的，换接口救不了。排障可临时 `BILI_NO_CACHE=1` 强制走真网络 |
| **`WBI 签名不可用：<message>`**；或 `WBI 签名密钥缺失，请稍后重试或检查登录状态` | 拿不到 `nav.data.wbi_img` 的密钥（nav 被风控 / 未登录） | 先 `node tools/bili.mjs session` 确认登录态；再 `recon <BV>` 看 `=== WBI 签名材料 ===` 那段有没有 `img_key`/`sub_key`/`mixin`。密钥会轮换，别缓存 |
| **`登录态无效: code=-101 账号未登录`（退出码 4）** | `SESSDATA` 过期 | 设置页重新粘贴 cookie（勾"记住我/长期"）。**写操作前先跑 `session`** |
| **发评论 / 私信返回 `code=-111`**（只读全绿，一发就挂） | `bili_jct` 空着、被截断，或和 `SESSDATA` 不是同一个号 | `selftest` 里 `bili_jct（写操作）` 那行会标出来（正常 32 位十六进制）。设置页整个 cookie 重粘一次。这个只能靠一次真实写入才能最终确认 |
| **设置页 404 / 打开是空白** | ① 改完插件代码没重启 DSH；② 插件装在别的 profile（本机是 `desktop`）；③ 走的是非 loopback 地址 | 完整重启 DSH；`Get-Item "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-myilidepu"` 确认链接在；用 `127.0.0.1` 而不是局域网 IP 访问 |
| **`duplicate JSONL session id`**；她有两个会话 / 会话不见了 | 数据目录搬过家，同一个会话 id 在新旧两个工作目录桶里各有一份 | ① 确认当前数据目录（Q10）；② 她的会话目录应该在 `…\sessions\--<新数据目录转义>--\myilidepu`（本机 `--D-MyDepu-work--`）；③ 把旧桶那份**整个目录移走**（别删）；④ 重启 DSH 再确认只剩一个。会话文件是 `session.v4.jsonl.zstd`，移走不丢数据 |
| **她起来后什么都不干 / 命令全失败** | 她的会话不是「完全访问」 | §3 第 3 条 |
| **`journal add` 报 `INVALID_FILE`，但 JSON 看着没错** | 文件带 UTF-8 BOM（`journal add --file` 直接 `JSON.parse`，**不剥 BOM**；配置文件那条路才剥） | 用 Q4 里 `.NET` 那条无 BOM 写法重造文件 |
| **`✗ 额度账本损坏（quota.json 不是合法 JSON）→ 状态未知，拒绝发言。`** | `~/.bili-ai/quota.json` 被写坏了（fail-closed） | 备份后检查；确认无误再决定删（**删 = 当天额度从 0 重算**）。别为了"能发"直接删 |
| **`selftest --real` 第 4 问显示 `跳过：第 2 步没拿到 BV`** | 第 2 问的 `feed --n 2` 没捞出 BV（日记里还没有"爱看"、或接口这次没给候选） | 那是 **WARN，不是通过**。自己拿一条：`node tools/bili.mjs candidates --count 3`，再 `read <BV> --route auto`（§2 Q3） |
| **`selftest --real` 某一步显示 `（没有输出）` 或一行被截断的错** | 那一步超时了（`session` 30s / `feed` 60s / `candidates` 90s / `read` 150s / 其余 30s），或子进程直接失败 | 照 §2 开头的对照表把那一问的命令**手工跑一遍**看真实报错。`read` 慢是正常的（要拉字幕 / 官方总结） |
| **`selftest-passed.json` 不生成** | 还有 `✗` 项（可选项的 `!` 不影响它） | 看结尾那行「N 项没通过 ✗」，按上面的提示补 |

---

## §5 跑完把什么贴回来

### 5.1 需要的输出

**必须有**（没有这些没法判断）：

1. `node tools/bili.mjs selftest` —— 整段，连最后那行结论
2. `node tools/bili.mjs selftest --real` —— 整段，尤其那十二问各自的结果（这一条最有信息量）
3. `node tools/bili.mjs deps` —— 整段（没通过项的 `修：` / `可选（不影响使用），想要就…` 一起贴）
4. `node tools/bili.mjs session` —— 整段（**先自己打码**：带昵称和 mid）
5. §2 第 8 问（Q8）的 **`--dry` 完整输出** —— 这是最关键的一段
6. 失败现场的**完整原文**：命令 + stdout + stderr + **退出码**

**有就贴**（帮助定位）：

7. `node tools/bili.mjs candidates --count 3`
8. `node tools/bili.mjs journal show`、`node tools/bili.mjs personality show`
9. `node tools/bili.mjs diary status`、`quota status`、`night status`
10. Q10、Q11 那两条 `node --input-type=module -e "…"` 的输出

### 5.2 怎么贴最省事

一条命令收齐（`*>&1` 把 stderr 也收进来）：

```powershell
cd C:\Users\KLucen\Desktop\肥鱼嘟嘟可\MyiliDepu
$out = "$env:TEMP\smoke-$(Get-Date -Format yyyyMMdd-HHmm).txt"
& {
  "== selftest =="; node tools/bili.mjs selftest; "exit=$LASTEXITCODE"
  "== selftest --real =="; node tools/bili.mjs selftest --real; "exit=$LASTEXITCODE"
  "== deps =="; node tools/bili.mjs deps; "exit=$LASTEXITCODE"
  "== session =="; node tools/bili.mjs session; "exit=$LASTEXITCODE"
  "== candidates =="; node tools/bili.mjs candidates --count 3; "exit=$LASTEXITCODE"
  "== journal show =="; node tools/bili.mjs journal show; "exit=$LASTEXITCODE"
  "== personality show =="; node tools/bili.mjs personality show; "exit=$LASTEXITCODE"
  "== diary status =="; node tools/bili.mjs diary status; "exit=$LASTEXITCODE"
  "== quota status =="; node tools/bili.mjs quota status; "exit=$LASTEXITCODE"
  "== night status =="; node tools/bili.mjs night status; "exit=$LASTEXITCODE"
} *>&1 | Tee-Object -FilePath $out
```

边打边在 `$out` 落一份（路径会打在屏幕上）。**失败的那一条**再单独跑一次，把退出码带上：

```powershell
node tools/bili.mjs <失败的命令>
"exit=$LASTEXITCODE"
```

### 5.3 贴之前先删掉这些

- ❌ `C:\Users\<你>\.bili-ai\credentials.json` 的内容（`SESSDATA` / `bili_jct` / `buvid3`）——**永远不要贴**。上面这些命令都不会回显凭据，但手滑复制文件就会泄露。
- ⚠️ `session` 的输出带**昵称和 mid**；介意就打码成 `<主人>` / `<mid>`。
- ⚠️ `read <BV> --json` 会带**全文原文**，动辄几万字——别整段贴，只贴开头字段部分（`readingId` / `title` / `route` / `coverage` / `attempts`）。
- ⚠️ `recon` 输出里有热门评论昵称，`quota status` 有历史 target。按需打码。

### 5.4 不要做的事

- ❌ **别拿主账号刷写操作。** 评论 / 动态 / 私信要验，就换小号，或者干脆不验——Q8 的 `--dry` 已经把闸门验完了。
- ❌ **别把 `--dry` 删掉去"看着像样"。** 没有 `--dry` 也没有 `--go` 时它拒绝运行，这是设计。
- ❌ **别为了复现"能发"去删 `quota.json`。** 那等于把当天的账清零，还会掩盖额度闸的真实行为。
- ❌ **别在插件目录里 `git add` / `git commit`。** 冒烟不改代码。

### 5.5 最后一句

出问题的时候**原始输出比总结有用**。「`selftest` 红了」没有信息量；「`✗ 依赖体检（deps） —— 1 项红`，然后 `deps` 打的是 `✗ ffmpeg（抽帧看画面） — 没找到`」能直接定位。**不要替我做总结，把原文贴回来。**
