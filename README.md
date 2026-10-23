# MyiliDepu · 我的 B 站分身

给 DSH 装一个**会自己过日子的分身**：它白天学习人类世界，晚上按自己的生物钟去看 B 站、把视频真看懂、写两本日记，遇到值得的就在视频下面总结一句并 @ 你。

它不是「定时任务 + 关键词搜索」，而是**生物钟 + 偏好 + 克制**：一天只醒一两次，筛几条、深读两三条、最多 @ 你三次；看不懂就承认看不懂，不想看就说今晚不想看。

这个插件合并自两个项目：

- **身体** — [dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale)（作者 ALTERSSSS，MIT）：生物钟、看片、分享、两本日记、设置页、统一 CLI 工具链；
- **灵魂** — [dsh-bili-humanism](https://github.com/InariNGT-Ofiicial/dsh-bili-humanism)（作者 InariNGT-Ofiicial，MIT）：读原文 → 理解 → 记见闻 → 长人格的 reading / ledger 引擎与提示词。

来源与许可证说明见 [NOTICE.md](NOTICE.md) 和 [NOTICE-humanism.md](NOTICE-humanism.md)。

## 更新了什么

> **每次推送到本仓库，这一节都会写上「这一版改了什么」**；逐版本完整记录（含每一条的命令、行号与实测结果）见 [CHANGELOG.md](CHANGELOG.md)。

**v1.3.11（2026-10-23）· 评论 / 回复也能带图了（上一版说「只能纯文本」是错的）**

- **你指出来的**：v1.3.10 我在 README、命令输出和她的手册里都写了「评论 / 回复接口只收纯文本，
  配图只可能出现在动态里」—— **这句是错的**。B 站评论确实能带图，我去查实了。
- **接口真相**（两份独立实现互证：`seiuna/bilibili-api` 的 `CommentArea.add()` 与
  `pa-jesusf/Ibili` 的 `interaction.rs`）：评论带图**和动态用同一个上传接口**
  `POST /x/dynamic/feed/draw/upload_bfs`，拿到 `image_url/img_width/img_height/img_size` 之后，
  在 `POST /x/v2/reply/add` 的表单里多带一个字段 `pictures` =
  `[{"img_src":…,"img_width":…,"img_height":…,"img_size":…}]`。
- **所以现在**：`node bili.mjs comment --oid <aid> --message "……" --pic shy --go`
  （`--pic` 可给多次，名字走你的图库 `D:\MyDepu\pics`，也收绝对路径）。
  上传发生在**额度闸之后** —— 闸没过，一张图都不会传上去 ✓。
- 修正的地方：`tools/lib/pics.mjs` 顶部注释、`bili pics` 的输出提示、
  `tools/bili.mjs` 的命令说明、**她的手册** `prompts/AGENTS.md` §1.3（她最容易照旧的那句
  「评论里塞不进图 ✗」已经删掉，防止她照着一份错的手册反复撞墙）。
- 新增可复用的 `uploadPic()` / `replyPicture()`（`tools/lib/pics.mjs`），
  动态与评论共用一个上传实现，不再各写一遍。

**v1.3.10（2026-10-23）· 草稿正文改回她自己发 + 她能配你图库里的图了**

两件事，都是你这轮定的：

- **① 责任交回她手里**（你的原话：「我不需要把责任从她身上挪到插件身上，我只需要她醒着的时候
  发给我她想回复什么内容，而不是给我像草稿【b3157e05】这样的编号」）。
  v1.3.9 那个「宿主每 60 秒自动代发」的 `announceDrafts()` **整块删掉**了 ——
  发不发由她决定，不由插件排班。现在是她敲 `reply-draft add` 的那一步，草稿全文就发进你私信
  （她醒着时发的、内容就是她想说的）；想再补一句、或你没收到，她用
  `reply-draft brief --dm` 把全文直接发进你私信（原来 `brief` 只能打印）。
- **② 图库能用上了**：你往 `D:\MyDepu\pics` 丢照片，她 `bili pics` 看有哪些（名字/尺寸/能不能上传），
  配图时 `bili dynamic-image --pic happy --text "…" --at <你的 mid> --at-name 主人 --go`。
  新增 `tools/lib/pics.mjs`（按文件头认类型，webp 会提前标出「不能上传」）+ 新命令 `bili pics`。
  ~~**诚实边界**：评论 / 回复接口只收纯文本，所以**配图只可能出现在动态里**~~
  → **这条写错了**：评论也能带图，v1.3.11 已实现（见上）。当时它被写进命令输出和她的手册，
  反而会让她在评论区反复撞墙 —— 教训是「接口能力别靠推断，要去查实」。
- 她的手册（`prompts/AGENTS.md`）跟着改口：§1.3 新增「想配一张图的时候」（选图要贴题、
  先 `--dry` 看、别自己上网找图），§2.2 改成「她自己发」＋「你回复之后她怎么接着做」。

**v1.3.9（2026-10-23）· 草稿正文由插件直接发给你，不再靠她复述**
（→ 这一版的宿主代发已在 v1.3.10 撤销，理由见上）

- 你上一条的反馈很准：「我是需要她不要告诉我 b3157e05 这个东西……我需要她能直接将草稿的内容发给我」。
  v1.3.8 只是**要求她**贴全文 —— 那是靠她记得，不够。
- 现在**宿主自己发**：`lib/scheduler.js` 的 `announceDrafts()` 每 60 秒看一次待审队列，
  发现新草稿就把**正文**（`【id】→ 对方` / `他说：…` / `我想回：…`）直接用 `notify`
  （你的配置是 `type=dm` → B 站私信）发给你。
- **不重复打扰**：已发过的 id 记在 `dataPath('drafts-announced.json')`。
  发送失败不记账 + 10 分钟冷却 → 会重试，又不会把风控逼出来。
- **不再一稿收两条**：`reply-draft add` 里那次自发推送去掉了，改由宿主统一负责。
- 提示词里那句「`notify "有 N 条回复待你审核"`」（只报数、容易退化成只报 id）删掉了。
- 你只需要在私信里回：`b3157e05 发` / `812edadc 不发` / `812edadc 第二句太软，改成…`。

**v1.3.8（2026-10-23）· 待审草稿：把正文递到你手里**

- **问题**：她要回别人的评论得先排队等审，草稿存在 `~/.bili-ai/pending-replies.json` 里 ——
  而她私信只发一句「有 2 条回复待你审核：新草稿 b3157e05」。
  **你在 B 站看不到草稿正文**，手里只有一个 8 位 id，根本没法批注。
- **宿主每轮把队列连正文摆进她的唤醒提示**（最多 5 条，每条含 `他说了什么` + `你要回什么` 全文），
  并硬性要求「通知主人时必须把全文原样贴上，只给 id ✗」。
- **新增 `bili reply-draft brief`**：打印一段可以直接整块贴给你的文本（含全文 + 一句怎么批注）。
  她用这条命令，你就不需要任何额外工具了。
- **你要怎么批注**：直接在私信里带 id 回一句 —— 「b3157e05 发」「812edadc 第二句太软，改成…」。
  她下次醒来第一件事就是看私信（`listen.dmWake`），按你的批注改一版，先 `reply-draft add` 新的再
  `reply-draft drop` 旧的。说「发」她就 `comment --go`，说「不发」她就丢掉。
- 顺带补上 `reply-draft show <id>` 的说明（只读看全文）与命令表描述。

**v1.3.7（2026-10-23）· 她不再躺在侧栏的「未分组」里**

- **根因不是权限，是没人给她登记**：侧栏分组**不按 cwd 猜**，只看工作区记录里的
  `sessionIds`（DSH 客户端 `owningGroupKey()` 就是 `workspaces.find(w => w.sessionIds.includes(id))`）。
  她的会话是插件用 `sessionController.create({ sessionId, cwd })` 直接建的 —— 宿主从头到尾没登记过，
  所以**即使你把 `D:\MyDepu\chat` 加成工作区，她照样在「未分组」里**。
- **插件每次启动补登记一次**：找 path 与她会话 cwd 相同的那个工作区，调宿主的
  `Workspace#attachSession()` 把她登记进去（宿主会校验 header.cwd 确实等于工作区 path 才放行）。
  登记成功日志里会多一行：`已把她的会话登记进工作区「D:\MyDepu\chat」`。
- **没登记工作区也不报错**：找不到相符的工作区就写一行提示让你去侧栏「添加工作区」，
  不影响她醒不醒（服务用惰性 `ctx.get('workspaceRegistry')` 取，拿不到也不会让插件卡在 pending）。
- 顺带修一个认知错误：v1.2.1 的去重与本节都跟**权限**无关 —— 她的会话一直是
  `danger-full-access`（会话头三条事件可查），"看不见"从来只是分组问题。

**v1.3.6（2026-10-23）· 人格札记不再限制每天条数**

- **一天想记几条就记几条**：以前 `personality pick` 是一天只收一句（同一天第二次会报
  `PERSONALITY_DAY_ALREADY_SELECTED`），现在取消了。第 1 条仍用原来的键
  `personality:day:<日期>`，第 2 条起顺延为 `<日期>:2`、`<日期>:3`…… —— **老数据不用迁移**，
  `human-world.md` 里同一天的多条合在一个 `## <日期>` 小节下。
- **仍然防重复**：同一条见闻的同一句今天再写一次会被幂等跳过（`already_selected`），
  同一句在任何一天写过都算 `already_known`，不会重复落盘。
- **"宁缺毋滥"改由提示词约束**：条数上限从代码里拿掉，但手册里那句「没有真发现就一个词都别写」
  一个字没松 —— 没有上限不等于要凑数。
- 顺带：`personality show` 现在会标出「这天第 N 条」，`pick` 会告诉你今天已经写到第几条。

**v1.3.5（2026-10-23）· 你在 B 站关注了谁，她自己知道（关注名单自动同步）**

- **关注即入列**：你**用她的账号**在 B 站点了关注，她会**在后台**每 5 分钟看一眼关注列表（最多 5 分钟延迟），把新关注按
  `{ name, mid, topics }` 自动追加进配置的 `watchups`（重点关注名单）—— 不用再手抄 mid。
  提示词里也会告诉她「重点关注名单刚更新：主人替你关注了 X」。
- **这一步永远不挡她醒来**：同步是后台跑的，她的唤醒不等网络（日志里只会多一行或少一行，不会卡住生物钟）。
  这一点是被回归测试逼出来的：第一版把网络请求 `await` 在唤醒路径上、又没有总时限，接口一卡住
  `waking` 标志就永远放不下 —— 症状是生物钟从此静默不再醒来。现在同步有 20 秒总时限，超时就放弃这一轮。
- **插件不碰关注关系**：只读 `x/relation/followings`，**从不点关注、从不取关**。取关了也只报告、
  **不会**把条目从 `watchups` 删掉（你可能还想让她继续看那位的稿子）。
- **只增不改**：已存在条目的 `topics` 一个字都不动；新条目才套 `follows.topics` 里的默认汇报重点。
  单次最多写 `follows.maxAdd`（默认 10）条，超出的下一轮继续。设置页「重点关注的 UP」里可开关、可改默认重点。
- 新命令：`bili follows list` / `bili follows sync [--dry|--go]`（跟其它会写东西的命令一样，**默认 dry**，
  真写要 `--go`；这一条由宿主在她醒来时自动跑，你不用手动执行）。
- 顺带：设置页「重点关注的 UP」那一块补上了「自动同步她的关注」开关、「新关注的默认汇报重点」和说明。

**v1.3.4（2026-10-23）· 主人 @ 她时分得清"想学 / 口味 / 其他" + 日期限制只管她自己的选题**

- **@ 她的三种意思，分开办**：主人在评论区 @ 她，现在会先分一次类，再把"这一类该怎么做"写进她的提示词 ——
  **① 想学**（「帮我总结 / 讲讲这条」）→ 真去读原文（`recon` / `debrief --no-frames` / `thread`），写一份带覆盖率说明的总结，`notify --dry` 预演后推给你；
  **② 口味**（「我很喜欢 / 不喜欢这个」）→ 记一笔 `feedback like|dislike --note "…" --bv BV`（喜欢给下一轮 `feed` 加权、不喜欢把那个 BV 拉黑），**不再**写成一篇长总结、也不发公开评论；
  **③ 其他**（提问、闲聊、让你去看某个话题）→ 按倾听规则回，让你看话题就走 `feed --topic`。
  分类只是按字面**猜的提示**（`hint`），提示词里明说"最后你自己判断"；三类不互斥，既说喜欢又要你讲讲时两件都做。
- **「只看某天之后发布的」收窄到只约束她自己选题**（`preferences.publishedAfter`）：她每轮醒来自己挑片时照旧过滤；
  但**主人点名要看某个话题 / 类型时不再套这个限制** —— 新命令 `feed --topic "<关键词>"`（另有 `--any-date` 强制放开）。
  输出里会写明「主人点名（--topic / --any-date）：这一轮不套『只看某天之后发布的』限制」，不再是静默跳过。
- 顺带：`feed` 尾部"全被日期滤掉了"的提示现在会告诉你`--topic` 这条路，不再让人以为源坏了。

**v1.3.3（2026-10-23）· 会话目录搬进数据目录 + 私信反馈闭环 + 重点关注某个 UP**

- **会话目录搬进数据目录**：设置里的「专用会话目录」可以指到数据目录下（本机用的是 `D:\MyDepu\chat`），历史会话也能整体搬过去——搬家脚本会逐帧改写会话头里的 `cwd`，不只改目录名。顺带修掉一个会让 DSH **启动直接失败**的坑：会话 id 是写死的，工作目录一搬家，同一个 id 就会出现在两个 project 目录里，DSH 抛 `duplicate JSONL session id`，症状是「所有会话全没了」。现在插件自己会扫一遍，把重复的旧副本挪进 `<数据目录>/.orphan-sessions/`（只挪不删，并在日志里报路径）。
- **私信反馈闭环**：新增 `bili feedback list | like | dislike --note "…" [--bv BV]`。你在私信里说"感兴趣 / 不感兴趣"，她记一笔，下一轮 `feed` 按主题加权（喜欢 +2.5/词、不喜欢 −2.5/词，各自封顶 7.5），你点名的那个 BV 直接拉黑不再推。同时把私信监听从"每 20 秒看一次"改成**每次醒来先看一次**（设置里的「醒来先看私信」，`listen.dmWake`）；**投递成功才标记已读**，投递失败下一轮再取，不吞消息。
- **重点关注某个 UP**：新增配置 `watchups`。**不是替你点关注**（那是改账号状态的动作），而是按 mid 直拉该 UP 的公开投稿；命中你指定的主题（如 `DeepSeek` / `国产大模型` / `codex`）额外加权，并在 `feed` 输出里打 `[重点:…]` 标记。
- 修：`feed` 里拿主人昵称拼正则时没有转义，昵称里带 `.` `(` 之类的字符会让整个选题器抛异常。

**v1.3.2（2026-10-23）** —— 口味新增「**只看某天之后发布的视频**」（`preferences.publishedAfter`），同时管她自己的选题（`feed`）和学习候选（`candidates`）；拿不到发布日期的条目按"不确定"丢掉并在输出里报数，日期写错当场报错。

**更早的版本**：v1.3.1 抽帧看画面（ffmpeg 轻量版，直链 seek 不下载整片）· v1.3.0 开机自启（让生物钟真的有人守）· v1.2.3 装完能自证、环境不对会直说 · v1.2.2 修「用指定模型」勾不上 · v1.2.1 修「重启后会话全没了」· v1.2.0 数据目录可搬家 · v1.1.0 模型与密钥 · v1.0.0 合并版（whale 的身体 + humanism 的灵魂）。

**v1.3.3 文档修订（2026-10-23）** —— 第八节重写：**只留真的没做的**；已经做完并在真机验证过的（真机十二问 12/12、抽帧两条路、写链路真的发出去过、一轮完整作息、开机自启、数据目录搬家）改成一张对照表列在最前面，本地 ASR 与平台写执行器明确写成「没做」。

## 一、它每天做什么

默认作息是**晚上 20:00–24:00 之间醒一次**（可以改，见第五节）。醒来之后大概是这样：

0. **先看有没有你的私信**（默认开，`listen.dmWake`）：有就先回你，并把你说的话记成口味反馈（"感兴趣 / 不感兴趣"→ 影响下一轮打分）。投递成功才标记已读，没投出去下一轮再取。
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
- ffmpeg 可选：只有「抽帧看画面」这一路需要它（`frames` / `read --frames` / `debrief`），不装也能用字幕/热评/弹幕理解视频。

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
node <插件目录>/tools/bili.mjs selftest --real    # 再加「真机十二问」：真账号真接口走一遍只读链路
```

`selftest` 不联网就能跑完；`--real` 会真的请求 B 站（只读，不发任何东西）。
装完想确认「真的能用」而不是「配置看起来对」，跑带 `--real` 的那条 ——
逐条判据和出问题怎么报都在 [docs/SMOKE.md](docs/SMOKE.md)。

看最后三行：

1. **找到它的会话**：左侧「工作区」→ 展开「未分组」文件夹（数据目录换过地方的话，会在按数据目录命名的工作区里）→ 里面那个 `myilidepu` 会话。
2. **给会话「完全访问」权限**：会话设置 → 权限 →「完全访问 / danger-full-access」。她需要自己跑 node 命令（读字幕、写日记、发评论），普通权限会被拦。
3. **如果设置页打不开、插件一直 pending**：那多半是 headless 模式，看 `selftest` 输出的第 ③ 条解释 —— 那是预期行为，不是装坏了。

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
- **口味**：爱看什么、不爱看什么（逗号分隔的一列）；**只看某天之后发布的视频**（填 `2026-09-01` 这种日期，留空 = 不限）。这一条同时管她自己的选题（`feed`）和学习候选（`candidates`），拿不到发布日期的条目会被当成「不确定」丢掉、并在输出里报数；日期写法错了会当场报错，不会静默失效。它只管**她自己挑什么看**，别人在评论/私信里递到她面前的片子不受约束。
- **作息**：晚上的时间窗口、每段醒几次、最小唤醒间隔、一次最多看几条、今晚不想看的概率。
- **分享**：开关、通道（评论 / 私信）、评分门槛、沉默几天后降档。
- **监听**：评论区监听开关与间隔、**醒来先看私信**（默认开：每次醒来先取一封你的私信，不再 20 秒轮询）、是否监听直播间弹幕、只听你或所有人。
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
- 会话记录（`.jsonl.zstd`）仍由 DSH 自己保管在 `$DSH_HOME/sessions/`，子目录名由会话 cwd 决定 —— 数据目录搬家后她的会话 cwd 会变成「专用会话目录」（默认 `<数据目录>/work`，也可以指到 `<数据目录>/chat` 这种地方），所以历史会话要跟着挪一次（插件不替你做这件事，见 九、出事了怎么救）。

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
| `bili personality pick --journal <id> --sentence "…" [--go]` | 从一条见闻里摘一句写进人格札记（默认 dry-run，`--go` 才写入；一句 ≤240 字，**每天条数不限**） |
| `bili inbox [--json]` | 导出见闻收件箱（刷新 `inbox.md` / 网页版 / 索引，只读账本） |

**看片**

| 命令 | 做什么 |
|---|---|
| `bili feed [--n 6] [--per 2]` | 选题器：照日记里的口味捞候选，排除看过的 |
| `bili debrief <BV> [--bucket 30] [--top 5] [--grid 3x3] [--no-frames]` | 一条龙看懂：封面 + 简介 + 官方字幕 + 弹幕热区 + 热评 + 抽帧 |
| `bili frames <BV> [--n 9] [--grid 3x3] [--at 12,45,90] [--json]` | 看一眼画面（**轻**：直链 seek，不下载整片）→ 一张九宫格 SHEET 交给 `read_image` |
| `bili feedback list\|like\|dislike --note "…" [--bv BV] [--title "…"]` | 反馈账：主人私信里说"感不感兴趣" → 她记一笔，下一轮 `feed` 按它加权/降权/拉黑 |
| `bili follows list` | 她的账号现在关注了谁（只读） |
| `bili follows sync [--dry\|--go] [--topics a,b] [--max N]` | 关注名单同步：新关注按 `{name,mid,topics}` 追加进 `watchups`（**默认 dry**；宿主每轮醒来前自动 `--go` 跑一次） |
| `bili read <BV> --frames 4` | 读原文的同时顺出一张 SHEET（抽帧失败不影响读原文） |
| `bili watch-video <BV> [3x3\|4x4] [--uniform]` | 真「看」画面：取直链、下载、ffmpeg 抽帧拼九宫格 |
| `bili subtitles <BV> [--lan ai-zh] [--print N]` | 拉官方字幕全文（带时间戳） |
| `bili video <BV>` | 不点开视频，靠文字还原它讲什么 |
| `bili comments <BV> [--ps 20] [--pn 1] [--sort hot\|time] [--json]` | 热评 / 最新评论（只读，匿名可读） |
| `bili search "<关键词>"` | 按关键词搜视频 |
| `bili covers <BV>…` | 抓视频元信息 + 封面图存到 `covers/`（可一次给多个） |

**分享、互动与额度**

| 命令 | 做什么 |
|---|---|
| `bili comment --oid <aid> --bvid <BV> --message "…" [--root/--parent] [--pic <名字>] --dry\|--go` | 发一条视频评论（`--pic` 可给多次 = 带图；带 `--root/--parent` 就是二级回复） |
| `bili comment --oid <aid> --bvid <BV> --message "@主人 …" --share --auto --reason "…" --score N --rank 1 --dry\|--go` | 正式的「分享 @ 你」通道（受评分/额度/判重约束） |
| `bili reply-draft add/list/show/brief/drop/take` | 待审回复队列（发前审核）；`add` 那一步就把全文发进主人私信，`brief [--dm]` 补发全文（`--dm` 直接发） |
| `bili pics [list\|path <名字>] [--json]` | 主人的图片库 `D:\MyDepu\pics`：有哪些图可用 / 取绝对路径 |
| `bili dynamic-image --pic <名字> …` | 发带图动态 |
| `bili comment … --pic <名字>` | 发带图评论 / 带图回复（2026-10-23 起；与动态共用上传接口） |
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
| `bili selftest [--real]` | 装完先跑：配置 / 凭据 / 登录态 / 目录 / 三本本子 + 下一步三件事；加 `--real` 再跑「真机十二问」（真账号真接口，全部只读） |
| `bili deps [--json]` | 依赖体检：cookie / 凭据目录 / **数据目录** / Node 运行时 / 限流，外加可选 ffmpeg |
| `bili session` | 确认凭据属于哪个号 |
| `bili thread <aid> <bvid> <rpid>` | 导出一条评论的完整楼中楼结构 |
| `bili check-comment <rpid> <aid> [bvid]` | 复核评论是否存在 |
| `bili check-dynamic <id>` | 看动态的结构化内容 |
| `bili check-mention <id>` | 确认动态里的 @ 是不是真提及 |
| `bili recon <BV>` | 发评论前的侦查：BV→aid + 评论区状态 + WBI 材料 |
| `bili whois <mid>` | 按 mid 查昵称 |
| `bili night plan/clock/mark/status` | 生物钟：掷骰子定今晚 / 到点退出叫醒 / 兜底标记 / 看计划 |
| `bili autostart status/on/off` | 开机自启：登录 Windows 后自动启动 DSH（生物钟才有人守）。只写 `HKCU`，不需要管理员，`off` 即撤销 |
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

**这一节只列「确实没做」的。** 已经做完、并且在本机真机验过的，先在这里备查，后面不再重复它们：

| 已经做完、真机验证过 | 怎么验的 |
|---|---|
| 真机十二问（真账号真接口，全只读） | `node tools/bili.mjs selftest --real` → **12/12 绿**（2026-10-23） |
| 抽帧看画面，轻、重两条路 | `frames` / `read --frames` 直链 seek；`debrief` 整片下载 + 场景检测。实测 182s / 24.8 MB 的片子抽 3 帧 ≈ 1.9 s |
| 写链路：评论 / 动态 / 私信 / 收藏 | 真实账号真的发出去过，运行记录（`log.jsonl`）里有 rpid / dyn_id，发完用 `check-comment` / `thread` 回读复核 |
| 一轮完整作息（学习 → 人格札记 → 选题 → 深读 → 打分 → @ 你 → 两本日记） | 按生物钟真的跑过，逐轮结果都在 `<数据目录>/log.jsonl` |
| 开机自启（Windows） | `autostart on` 写 `HKCU\...\Run` 并在真机确认（`deps` 显示「已开启」） |
| 数据目录搬家 + 会话跟着搬 | 本机从 `~/.dsh/myilidepu` 搬到 `D:\MyDepu`，会话桶同步迁移并逐帧改写 `cwd`，重扫 0 重复 id |

**仍然没做 / 已知限制**

- **自动化测试覆盖的是逻辑，不是真机**：仓库里 207 个用例全部跑在临时目录 + 虚构凭据 + 模拟网络下，验证的是逻辑自洽。真机这一段做成了**清单而不是 CI** —— 装完请自己跑一遍 `selftest --real`，步骤与判据见 [docs/SMOKE.md](docs/SMOKE.md)。B 站接口是非官方的，可能哪天就变（WBI 签名、412 等都遇到过）——真机那一次绿，不代表明天还绿。
- **写链路不在自动冒烟范围内**：评论 / 动态 / 私信真的发出去这件事无法无人值守验证，只能先 `--dry` 看预演、再人工确认（见 [docs/SMOKE.md](docs/SMOKE.md) §3）。自动测试里所有写操作都是假网络。
- **抽帧看画面依赖 ffmpeg**：不装就少一路「看画面」，字幕 / 热评 / 弹幕仍在。**缺 ffmpeg 不算故障**，`deps` 会以 `!`（可选）而不是 `✗` 报，也不会让退出码变红。
- **本地 ASR 没做**：没有「把语音转成文字」这一路，没人给字幕的视频只能靠弹幕 / 热评 / 抽帧推。humanism 原来那套 Python 抽帧与 ASR（`scripts/*.py`）没有移植——不值得为它引入 Python 依赖。
- **平台写执行器没合并**：humanism 的 history / favorite / like / coin 写操作器没移植过来，移植的阅读引擎是**只读**的（读原文 → 落账 → 人格札记 → 收件箱导出）。
- **评论端点不新增、不开放新的写入口**：只保留原有的分享通道；不提供任意转发、任意调度、共享凭据或自动外部安装/排程。
- **没有多账号、代理/指纹轮换、自动解验证码**：这些都不会做。
- **生物钟只在 DSH 开着、插件加载着的时候跑**：DSH 退了它就不活动；没有独立守护进程、没有云服务。建议顺手开一次开机自启：`node tools/bili.mjs autostart on`（`autostart off` 撤销，也可以去任务管理器 → 启动应用里禁用）。它**只解决「DSH 没开着」**——电脑关机或睡眠期间错过的那个窗口，它补不回来（生物钟 catch-up 还没做）。目前只实现了 Windows，macOS / Linux 上 `status` 会直说没做。
- **必须用真 node 运行时**：宿主主程序是 Electron 时不能用它跑命令，插件会自己找 node（找不到时 `deps` 会把它试过的候选和修法一起打出来，可用 `DSH_NODE` 指定）。拿 Electron 顶着**也能跑**，但每次调用都要启一个 Electron，更慢更吃内存 —— `deps` 会明说现在是哪种（`node` 还是 `electron`）。
- **无界面（headless）DSH 不工作**：缺 `sessionController` / `webServer` / `connection` 时插件会一直 pending。**这是预期行为，不是装坏了**：DSH 会打印 `dsh-myilidepu: pending (waiting for services: sessionController, webServer, connection)`，`selftest` 结尾也会解释这一条。纯 CLI 命令（`node tools/bili.mjs …`）不受影响，那是独立的一条腿。
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
2. 看**新工作目录对应的那个桶**（桶名就是工作目录编码，`D:\MyDepu\chat` → `--D-MyDepu-chat--`）留着，
   其余整目录**移动**（别删）到别处。
3. 重扫一遍确认全局唯一，再启动 DSH。

**搬家时想让历史会话跟着走**（避免上面这套）：把会话目录整体挪到新桶，并**逐帧改写会话头里的 `cwd`**——
会话文件是**多帧 zstd 流**（每追加一批就是一帧），只读第一帧只能拿到头和第一段正文；改 `cwd` 只需要动第一帧，但读全文必须逐帧解。
改完用 `node -e` 解一遍第一帧确认 `cwd` 已是新路径，再启动 DSH。

数据本身不会丢：会话文件是 `session.v4.jsonl.zstd`，搬走的那份随时能搬回。

### 「她在侧栏『未分组』里，不点开看不见」

**先确认一件事：这跟权限无关。** 她的会话一直是完全访问，会话文件开头三条事件就是证据：

```
$ node -e "..."   # 或直接看 $DSH_HOME/sessions/--D-MyDepu-chat--/myilidepu/session.v4.jsonl.zstd
{"type":"permission/preset","seq":0,...,"data":{"preset":"danger-full-access"}}
{"type":"sandbox/mode","seq":1,...,"data":{"mode":"danger-full-access"}}
{"type":"approval/policy","seq":2,...,"data":{"policy":"never"}}
```

**真正的原因**：侧栏分组**不按 cwd 猜**，只看工作区记录里的成员名单
（DSH 客户端 `owningGroupKey()`：`workspaces.find(w => w.sessionIds.includes(sessionId))`）。
正常路径是「在某个工作区里新建会话」时宿主顺手登记；而她的会话是插件用
`sessionController.create({ sessionId, cwd })` 直接建的，宿主从没登记过 ——
所以**把 `D:\MyDepu\chat` 加成工作区也没用**，她仍然在「未分组」里。

**v1.3.7+ 已自动处理**：插件每次启动时找 path 与她会话 cwd 相同的那个工作区，
调宿主的 `Workspace#attachSession()` 登记进去。需要**重启一次 DSH** 才生效（改的是 `lib/`）。
登记成功时日志里会出现一行：`已把她的会话登记进工作区「D:\MyDepu\chat」`。

手动救（不想等重启，或想立刻看到）：

1. 先**完全退出 DSH**。
2. 打开 `$DSH_HOME\storages\workspace.json`，找到 `path` 是 `D:\\MyDepu\\chat` 的那个工作区，
   把 `"myilidepu"` 放进它的 `sessionIds` 数组**第一位**（宿主会自己校验 cwd 是否相符）。
3. 启动 DSH —— 她会出现在 `chat` 这个分组下。顺手把她**置顶**，以后就不用再翻。

> 侧栏的「水位线」只会默认露前 5 行，分组里会话多了要把她的行往上拖或置顶；
> 折叠的分组不会点亮等待提示，所以别把 `chat` 这个分组折叠起来。

