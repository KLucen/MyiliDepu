# MyiliDepu · 我的 B 站分身

给 DSH 装一个**会自己过日子的分身**：它白天学习人类世界，晚上按自己的生物钟去看 B 站、把视频真看懂、写两本日记，遇到值得的就在视频下面总结一句并 @ 你。

它不是「定时任务 + 关键词搜索」，而是**生物钟 + 偏好 + 克制**：一天只醒一两次，筛几条、深读两三条、最多 @ 你三次；看不懂就承认看不懂，不想看就说今晚不想看。

这个插件合并自两个项目：

- **身体** — [dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale)（作者 ALTERSSSS，MIT）：生物钟、看片、分享、两本日记、设置页、统一 CLI 工具链；
- **灵魂** — [dsh-bili-humanism](https://github.com/InariNGT-Ofiicial/dsh-bili-humanism)（作者 InariNGT-Ofiicial，MIT）：读原文 → 理解 → 记见闻 → 长人格的 reading / ledger 引擎与提示词。

来源与许可证说明见 [NOTICE.md](NOTICE.md) 和 [NOTICE-humanism.md](NOTICE-humanism.md)。

## 一、它每天做什么

默认作息是**晚上 20:00–24:00 之间醒一次**（可以改，见第五节）。醒来之后大概是这样：

1. **先学习人类世界**：在候选里挑一条真的想了解的视频（最多 3 条候选），读它的原文（官方字幕 / 官方总结 / 你导入的本地原文），然后记一条「见闻」——**今天最多 2 条，这是硬上限**。没读出名堂就不记，跳过不算失败。
2. **想起自己长成了什么样**：读一遍人格札记 `human-world.md` 里最近的几句，带着它看今晚的东西。
3. **翻今晚的首页**：按日记里的「爱看 / 不爱看」选题，最多看 5 条，先只看文字（标题、简介、热评）快速筛；再挑 2–3 条深读——官方字幕 + 弹幕热区 + 热评，装了 ffmpeg 还能抽帧看画面。
4. **写自己的总结**：先读原文，再写一段不超过 200 字的总结（结构/论点 + 只有看了原文才知道的细节 + 自己的看法）。写不出来就如实说，不硬编。
5. **决定要不要 @ 你**：只对最想分享的那一条打分，按评分卡 ≥ 阈值（默认 13/20）才发；分享方式二选一——评论区 @ 你，或私信你。两条通道共用同一本额度。
6. **写公开日记**（默认关）：开了才会写，而且写之前必须 `--dry` 预演、你看过效果再 `--go`；发出去是动态或评论。
7. **写私人日记**（永远写）：只有你能看，记今天真正想留下的东西，顺便校准「爱看 / 不爱看」。
8. **把最想说的话推给你**（默认开）：通过设置里的通知后端发给你。
9. **收工**：记一条 `diary log`，然后进入 **8 分钟硬冷却**，不再自己加戏。

另外：如果连续 3–6 天你都没理它，它会少分享、最多主动问一次「在忙吗」；超过 7 天就完全不分享，但仍然看片、仍然写两本日记。这些是代码里的衰减，不是模型自己决定的。

## 二、安装

**前提**

- **Node.js ≥ 24**（插件用内置 `node:sqlite` 记账，不需要装任何 npm 依赖）；
- **DSH ≥ 0.2.1-rc.2，且 < 0.3.0**（插件按这个宿主版本契约写的）；
- ffmpeg 可选：只有「抽帧看画面」这一路需要它，不装也能用字幕/热评/弹幕理解视频。

**装插件**

```bash
dsh plugin --profile <你的配置档> add "link:<插件源码目录绝对路径>"
```

Windows 例子：

```powershell
dsh plugin --profile desktop add "link:C:\Users\<你>\.dsh\plugins\dsh-myilidepu"
```

**装完必须完全退出 DSH，再重新启动。**
只关窗口不算——`cordis.patch.yml` 是 bundle 层，只在 DSH 启动时组装；不重启的话会出现「装上了但设置页 404 / 设置页没有我的分身」。

**打开设置页**

DSH → 设置里的「我的分身」。它背后的接口路径是 `/dsh-myilidepu/api/*`，旧的 `/dsh-bili/api/*` 保留为别名；日常用不着手敲 URL。

在设置页里做三件事：

1. 填 **B 站 cookie**：浏览器 F12 → Application → Cookies → `bilibili.com`，手动复制 `SESSDATA` / `bili_jct` / `buvid3`。**不要用 `document.cookie` 取**，`SESSDATA` 是 HttpOnly，取不到。
2. 填**主人 mid 和昵称**（用来认「谁回过它」，@ 你时写进正文）。
3. 点「**保存**」（输入框只是本地改动，不点保存等于没改），再点「**依赖体检**」——它会真的请求一次 B 站验证登录态，并检查 Node / 数据目录 / ffmpeg。

**跑一次启动测试**（在会话里、或在插件目录下）：

```bash
node <插件目录>/tools/bili.mjs selftest
```

看最后两行：

1. **找到它的会话**：左侧「工作区」→ 展开「未分组」文件夹 → 里面那个 `myilidepu` 会话（不点开也能看见它的名字）。
2. **给会话「完全访问」权限**：会话设置 → 权限 →「完全访问 / danger-full-access」。她需要自己跑 node 命令（读字幕、写日记、发评论），普通权限会被拦。

**常见卡点**

| 现象 | 原因 |
|---|---|
| 设置页找不到「我的分身」 | 没重启 DSH；或插件装在了别的 profile |
| 设置页存完还是红的 | 没点保存；或 cookie 不完整 |
| 会话什么都不干 | 会话没给「完全访问」 |
| 登录态显示未登录 | cookie 是用 `document.cookie` 取的（拿不到 HttpOnly 的 SESSDATA） |
| 找不到可用的 node 运行时 | 宿主是 Electron 主程序，插件找不到真 node；装 Node 24+，或用 `DSH_NODE` 指定 |
| 想立刻看一轮 | 把生物钟窗口改成「现在之后 2 分钟」的一小段，保存，等它醒 |

## 三、每天到底会不会乱发

下面这些是**代码里的硬约束**，不是提示词里的一句请求，改配置也绕不过去：

- **见闻 ≤ 2 条/天**：按 Asia/Shanghai 日期算，限额检查和写入在同一个 SQLite 事务里；超了直接失败（退出码 3，`JOURNAL_DAILY_LIMIT`），调度流会把今天当成「已学完」跳过。
- **分享 ≤ N 条/天**：默认 `quota.shareDaily = 3`。设置页能调 0–20，但填超过 3 会警告「看起来会像刷量」。
- **同一视频 7 天只分享一次**：按 BV 号判重，评论区和私信共用这一本账。
- **同一个人 30 天只回一次**（`listen.oncePerPerson`，默认关；开了才会限制）。
- **公开日记默认关**：`diary.public = false`。开了也必须先 `--dry` 预演、再 `--go`，不会自己发。
- **一次一条**：评论、动态、私信都是单条发送，没有批量、没有定时群发、没有「多账号铺量」这种功能。
- **撞风控立刻停**：遇到 412 / 429 / -352 / -799 / -509 / -10403 这类信号，立即停手并退避，**不会绕过、不会自动重试**；持久化的风控暂停不会被程序自动清除。
- **分享有门槛**：评分 ≥ `share.minScore`（默认 13/20）、理由 ≥ 8 个字、`--rank 1`，`share.enabled=false` 时所有分享通道一律拒绝。
- **沉默就衰减**：3–6 天没互动，最多分享 1 条、最多主动问一次；7 天以上不分享，只看看、写日记。

## 四、你能改什么

设置页（改完点保存，**保存即生效**；只有换插件代码/版本才需要重启 DSH）：

**新增的四组**

- **学习**：学习总开关；每次醒来都学吗；每天见闻上限（0–2）；候选条数（1–3）；读原文走哪条路（`auto` / 字幕 / 官方总结 / 本地导入）。
- **人格**：学习总开关；醒来是否注入人格；注入多少字（默认前 3000 字）；每天最多摘录几句（0–2）。
- **日记**：私人日记开关；公开日记开关（默认关）；公开日记走动态还是评论；要不要推送给你。
- **足迹**：分享时是否 @ 你；每天分享上限；分享评分门槛。

**原有的设置**

- **她是谁**：角色名、她怎么称呼你、她怎么自称。默认中性，不内置人格。想要更完整的「人设正文」，可以写在 `~/.bili-ai/persona.md`（只影响她，不影响别的会话；前 3000 字会被注入，最长 20000 字；换机器时连 `.bili-ai` 一起拷就走）。
- **你（主人）**：主人 mid、昵称；她自己的 mid 只读（来自 cookie）。
- **口味**：爱看什么、不爱看什么（逗号分隔的一列）。
- **作息**：晚上的时间窗口、每段醒几次、最小唤醒间隔、一次最多看几条、今晚不想看的概率。
- **分享**：开关、通道（评论 / 私信）、评分门槛、沉默几天后降档。
- **监听**：评论区监听开关与间隔、是否监听私信、是否监听直播间弹幕、只听你或所有人。
- **日记与推送**：要不要推送日记摘要、主人 @ 请求总结（默认关）。
- **工具链**：专用会话目录（必须是已存在的绝对路径）、**数据目录**（可把她的全部数据搬到别的盘）、工具目录、cookie 写入、依赖体检、待审回复。
- **通知**：`notify.type` 选 `none` / `desktop` / `webhook` / `command`，`template` 选 `text` / `markdown`。
- **模型与密钥**：给她指定一个模型（provider + 具体模型 + 推理档），以及填 API 密钥（SK）。换模型走 DSH 原生的**会话级**切换 —— **只影响她自己那个会话**，不动 DSH 的全局默认，也不用重启 DSH（点「保存并应用」立刻换；开着「每次醒来重新应用」还会每轮再确认一次）。密钥由 DSH 自己的凭据库保存（`~/.dsh/.credentials.yaml`），**写后永不回显**，插件配置里只留一个引用名（如 `TENCENT_API_KEY`），配置文件里不会有密钥值。

**配置文件在哪**

- 配置：`$DSH_HOME/myilidepu.config.json`（`DSH_HOME` 默认 `~/.dsh`）。旧名 `bili-whale.config.json` 仍会自动兜底。
- 凭据：`~/.bili-ai/credentials.json`（只写不回显，接口只告诉你「有没有」）。
- 数据目录：默认 `$DSH_HOME/myilidepu/`（两本日记、人格札记、见闻账本、阅读结果、抽帧、状态 JSON、她的会话工作区都在这里）。
- **数据目录可以搬家**：在设置页「工具链 → 数据目录」填一个绝对路径（例 `D:\MyDepu`），或设环境变量 `MYILIDEPU_DATA_DIR`（优先级更高）。搬家后所有数据路径都跟着走，**改完要重启 DSH**（宿主在启动时算路径）。
- 想换配置文件位置：设环境变量 `MYILIDEPU_CONFIG`（旧 `BILI_WHALE_CONFIG` 也认）。
- 会话记录（`.jsonl.zstd`）仍由 DSH 自己保管在 `$DSH_HOME/sessions/`，子目录名由会话 cwd 决定 —— 数据目录搬家后她的会话 cwd 变成 `<数据目录>/work`，所以历史会话要跟着挪一次（插件不替你做这件事，见下）。

**带 BOM 的坑已兼容**：手动改 JSON 时如果编辑器加了 UTF-8 BOM，读配置会自动剥掉并在设置页顶部标 `hadBom`；JSON 语法错、顶层不是对象也会在设置页顶部显示错误路径与原因，不会静默用默认值。设置页顶部还有一张「配置健康」卡：当前读的是哪份文件、有没有错、是不是从旧文件名迁移过来的。

## 五、命令清单

所有工具都从同一个入口调：`node tools/bili.mjs <命令> [参数]`（下文用 `bili` 代指 `node tools/bili.mjs`）。跑 `bili help` 看在线清单。

约定：

- **写操作必须显式给 `--dry`（只打印请求）或 `--go`（真的发）**，不给就不写；
- 写操作前先 `session` 确认是哪个号，写完用 `check-*` / `thread` / `diary` 回读复核；
- 一次一条。批量、定时、多账号不是这套工具的用途。

**学习与阅读（全部只读，不写平台）**

| 命令 | 做什么 |
|---|---|
| `bili candidates [--count N] [--json]` | 给几条值得了解的视频候选（默认 3，最多 3） |
| `bili read <BV\|URL> [--page N] [--route auto\|subtitle\|conclusion\|local] [--json]` | 读一条视频的原文（字幕 / 官方总结 / 本地导入），输出标题、时长、用了哪条路、覆盖率、原文前 2000 字 |
| `bili journal show [--date YYYY-MM-DD] [--json]` | 看今天的见闻账本 |
| `bili journal add --reading <id> --file <json>` | 把一条见闻记进账本（必须有 `encounter` 和 `missing`；证据最多 20 条；≥2 条/天会被拒） |
| `bili personality show [--json]` | 看人格札记（`human-world.md`） |
| `bili personality pick --journal <id> --sentence "…" [--go]` | 从一条见闻里摘一句写进人格札记（默认 dry-run，`--go` 才写入；一句 ≤240 字） |
| `bili inbox [--json]` | 导出见闻收件箱（刷新 `inbox.md` / 网页版 / 索引，只读账本） |

**看片**

| 命令 | 做什么 |
|---|---|
| `bili feed [--n 6] [--per 2]` | 选题器：照日记里的口味捞候选，排除看过的 |
| `bili debrief <BV> [--bucket 30] [--top 5] [--grid 3x3] [--no-frames]` | 一条龙看懂：封面 + 简介 + 官方字幕 + 弹幕热区 + 热评 + 抽帧 |
| `bili watch-video <BV> [3x3\|4x4] [--uniform]` | 真「看」画面：取直链、下载、ffmpeg 抽帧拼九宫格 |
| `bili subtitles <BV> [--lan ai-zh] [--print N]` | 拉官方字幕全文（带时间戳） |
| `bili video <BV>` | 不点开视频，靠文字还原它讲什么 |
| `bili comments <BV> [--ps 20] [--pn 1] [--sort hot\|time] [--json]` | 热评 / 最新评论（只读，匿名可读） |
| `bili search "<关键词>"` | 按关键词搜视频 |
| `bili covers <BV>…` | 抓视频元信息 + 封面图存到 `covers/`（可一次给多个） |

**分享、互动与额度**

| 命令 | 做什么 |
|---|---|
| `bili comment --oid <aid> --bvid <BV> --message "…" [--root/--parent] --dry\|--go` | 发一条视频评论（带 `--root/--parent` 就是二级回复） |
| `bili comment --oid <aid> --bvid <BV> --message "@主人 …" --share --auto --reason "…" --score N --rank 1 --dry\|--go` | 正式的「分享 @ 你」通道（受评分/额度/判重约束） |
| `bili reply-draft add/list/show/drop/take` | 待审回复队列（发前审核） |
| `bili comment-del <rpid> --dry\|--go` | 删除自己发的一条评论 |
| `bili dm --status` / `bili dm --msg "…" [--share --target <BV> --reason "…" --score N --rank 1] --dry\|--go` | 私信专属通道：一天锁定一个收信人、只发主人、必须互关；带 `--share` 时占分享额度 |
| `bili dynamic list` / `bili dynamic post --text "…" --dry\|--go` / `bili dynamic rm --id <dyn_id> --dry\|--go` | 动态的列表 / 发布 / 删除 |
| `bili dynamic-image --image <图片路径> [--text "…"] --dry\|--go` | 发图文动态 |
| `bili dynamic-edit <dyn_id> <文本文件> [--go]` | 编辑已有动态（id 不变） |
| `bili fav <BV> --reason "…" --dry\|--go` | 收藏（有判据；不占分享额度；同一视频 30 天一次） |
| `bili likes --hours 24 [--owner] [--json]` | 谁赞了它（只读通知流） |
| `bili quota status/check/record` | 限额闸：今天还能发多少、检查、记账（`set`/`allow` 已删除） |
| `bili notify "消息正文" [--title 标题] [--dry]` | 把「自主发言后的报备」推给你（后端由 `notify.type` 决定） |

**监听与直播**

| 命令 | 做什么 |
|---|---|
| `bili comment-await --minutes N --interval N [--only-owner]` | 评论版「叫我起床」：有新回复/新 @ 就退出并叫醒 agent（0 token 空等） |
| `bili comment-digest --hours 24 --pages 2 [--only-unread]` | 今天谁找过它（回复 + @ 汇总，只读） |
| `bili dm-await` | 私信监听（只认主人） |
| `bili watch --aid --root --bvid [--uid] [--minutes]` | 盯一条评论的楼中楼等新回复 |
| `bili danmaku pre/send/history/live --room <房间号>` | 直播间弹幕：预检 / 发送 / 回读 / 实时流 |
| `bili await` | 直播间「叫我起床」：出现该回的弹幕就退出 |

**运维与排查**

| 命令 | 做什么 |
|---|---|
| `bili selftest` | 装完先跑：配置 / 凭据 / 登录态 / 目录 / ffmpeg + 下一步两件事 |
| `bili deps [--json]` | 依赖体检：cookie / ffmpeg / Node / 数据目录 |
| `bili session` | 确认凭据属于哪个号 |
| `bili thread <aid> <bvid> <rpid>` | 导出一条评论的完整楼中楼结构 |
| `bili check-comment <rpid> <aid> [bvid]` | 复核评论是否存在 |
| `bili check-dynamic <id>` | 看动态的结构化内容 |
| `bili check-mention <id>` | 确认动态里的 @ 是不是真提及 |
| `bili recon <BV>` | 发评论前的侦查：BV→aid + 评论区状态 + WBI 材料 |
| `bili whois <mid>` | 按 mid 查昵称 |
| `bili night plan/clock/mark/status` | 生物钟：掷骰子定今晚 / 到点退出叫醒 / 兜底标记 / 看计划 |
| `bili diary show/log/tail` | 她的一天：人读摘要 / 记结构化事件 / 最近事件 |

## 六、隐私

- **数据都在本地**：配置在 `$DSH_HOME/myilidepu.config.json`，日记 / 人格札记 / 账本 / 阅读结果在数据目录（默认 `$DSH_HOME/myilidepu/`，可用 `paths.dataDir` 搬走），凭据在 `~/.bili-ai/credentials.json`。
- **会上传的只有你明确开启的公开动作**：视频下 @ 你的评论、私信、动态、公开日记。读接口会带着本机 cookie 访问 B 站，除此之外不往任何地方发数据。
- 凭据只写不读回：设置页接口只返回「有没有 SESSDATA / bili_jct / buvid3」，不会回显内容；错误日志也不会打印凭据、签名 URL 或平台原始响应。
- 没有云端、没有统计上报、没有第三方服务。公开仓库和测试只用合成数据与占位符，不含真实账号、真实视频 ID、个人项目故事或截图。

## 七、归属与许可

- 合并版本身：**MIT**，见 [LICENSE](LICENSE)。
- 来自 [dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale)（© 2026 ALTERSSSS，MIT）的部分：见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。
- 来自 [dsh-bili-humanism](https://github.com/InariNGT-Ofiicial/dsh-bili-humanism)（© 2026 InariNGT-Ofiicial，MIT）的部分：见 [LICENSE-humanism.txt](LICENSE-humanism.txt) 与 [NOTICE-humanism.md](NOTICE-humanism.md)。
- 第三方：B 站 API 是非官方接口，本仓库不含 B 站代码或数据；`bilibili-API-collect` 只作为接口文档参考、不随包分发；ffmpeg 是 LGPL v2.1+，只由 `tools/lib/ffmpeg.mjs` 定位和调用，不随包分发；Node.js 是 MIT。完整免责见 [NOTICE.md](NOTICE.md)。

## 八、已知限制 / 没做的事

- **没有在你的真实账号和真实 DSH 环境里做过回归**：仓库里的测试全部是临时目录 + 虚构凭据 + 模拟网络，验证的是逻辑不是真机兼容。B 站接口是非官方的，可能哪天就变（WBI 签名、412 等都遇到过）。
- **抽帧看画面依赖 ffmpeg**：不装就少一路「看画面」，字幕 / 热评 / 弹幕仍在。
- **humanism 侧的抽帧、本地 ASR、平台写执行器没有合并进来**：移植到本仓库的阅读引擎是**只读**的，只做「读原文 → 落账 → 人格札记 → 收件箱导出」。
- **评论端点不新增、不开放新的写入口**：只保留原有的分享通道；不提供任意转发、任意调度、共享凭据或自动外部安装/排程。
- **没有多账号、代理/指纹轮换、自动解验证码**：这些都不会做。
- **生物钟只在 DSH 开着、插件加载着的时候跑**：DSH 退了它就不活动；没有独立守护进程、没有云服务。
- **必须用真 node 运行时**：宿主主程序是 Electron 时不能用它跑命令，插件会自己找 node（找不到在 `deps` / 设置页报错，可用 `DSH_NODE` 指定）。
- **无界面（headless）DSH 不工作**：缺 `sessionController` / `webServer` / `connection` 时插件会一直 pending。
- **没做的还有**：人格的模型权重训练（当前学习只落本地札记）、跨插件共享账号锁/配额/暂停、真实账号的公开演示。公开测试和示例永远是合成数据。

## 九、出事了怎么救

### 「重启后会话全没了」

症状：DSH 一启动，左侧会话列表空的；日志里 `workspaceController is unavailable`，
`dsh-myilidepu` 显示 `pending (waiting for services: sessionController, webServer, connection)`。

原因：DSH 的会话按 **cwd** 分桶（`$DSH_HOME/sessions/--<工作目录>--/<会话 id>/`），
她的会话 id 是固定的。**数据目录搬过家**（改了 `paths.dataDir`）之后，同一个 id 在两个桶里各有一份，
`dsh-workspace` 扫描到重复 id 直接抛 `duplicate JSONL session id ... appears in multiple project directories`
→ `workspaceRegistry` 不激活 → 下游全 pending。注意它是**上一次运行造出来、下一次启动才炸**。

现行版本（v1.2.1+）已自动处理：`ensureSession()` 在建会话前后各查一次，
留下 cwd 相符的那一份，其余**搬**进 `<数据目录>/.orphan-sessions/`（只搬不删）。

万一还是撞上了（比如重复是在旧版本里造出来的），手动救：

1. 在 `$DSH_HOME/sessions/` 下找出所有叫这个 id 的目录：
   `Get-ChildItem "$env:USERPROFILE\.dsh\sessions" -Recurse -Directory -Filter myilidepu`
2. 看**新数据目录对应的那个桶**（桶名就是工作目录编码，`D:\MyDepu\work` → `--D-MyDepu-work--`）留着，
   其余整目录**移动**（别删）到别处。
3. 重扫一遍确认全局唯一，再启动 DSH。

数据本身不会丢：会话文件是 `session.v4.jsonl.zstd`，搬走的那份随时能搬回。
