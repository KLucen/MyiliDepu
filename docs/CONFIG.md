# 配置速查（`myilidepu.config.json`）

本页是 `tools/lib/config.mjs` 中 `DEFAULTS` 的逐项说明：每个键的默认值、取值范围、被谁读取。
默认值就是「什么都不配也能跑」的中性值，**不含任何作者的个人信息**。

## 1. 配置文件在哪

查找顺序（先命中先用，见 `tools/lib/config.mjs` 顶部注释与 `tools/lib/paths.mjs`）：

1. 环境变量 `MYILIDEPU_CONFIG` 指向的路径
2. 环境变量 `BILI_WHALE_CONFIG` 指向的路径（旧名兼容）
3. `$DSH_HOME/myilidepu.config.json`（正式位置；`DSH_HOME` 默认 `~/.dsh`）
4. `$DSH_HOME/bili-whale.config.json`（**旧版文件名兜底**：从旧插件升级过来不用手动搬配置）
5. 都没有 → 全部用内置默认值

几个配套位置：

| 东西 | 位置 |
|---|---|
| 凭据（cookie） | `~/.bili-ai/credentials.json`（本插件只写不回显；与配置分开存放） |
| 数据目录 | 默认 `$DSH_HOME/myilidepu/`（会话工作目录在其中的 `work/`）；可用 `paths.dataDir` 或 `$MYILIDEPU_DATA_DIR` 搬家 |
| 旧数据目录 | `$DSH_HOME/whale-work`（从旧插件升级时沿用或迁移，取决于旧配置） |
| 配置的只读接口 | `GET /dsh-myilidepu/api/settings`（返回 `config` + `health` + `configPath` + `paths`） |

## 2. 三种改法

1. **设置页**：DSH 设置 →「我的分身」。保存后写入上面第 3 项那个文件，并清掉进程内缓存 → 立即生效（作息类改动会重排唤醒计划）。
2. **手改 JSON**：直接编辑配置文件。写回时保持「无 BOM、2 空格缩进、行尾 `\n`」最稳妥；已有 BOM 也能读（见下）。
3. **环境变量**：`MYILIDEPU_CONFIG` 换整份配置文件的位置（多实例 / 测试用）。

### 「改了配置没生效」的两个坑（已兼容）

- **UTF-8 BOM**：记事本 / PowerShell 5.1 存出的 JSON 带 BOM，旧版会整份静默作废。现在会先剥 BOM 再解析，并在设置页顶部报 `hadBom: true`。
- **JSON 语法错 / 顶层不是对象**：现在不会静默吞掉，而是把错误文本放进 `health.error`，设置页直接显示。

`configStatus()` 返回的体检字段（设置页顶部、`deps` 命令都会用）：

| 字段 | 含义 |
|---|---|
| `path` | 实际读到的文件路径 |
| `ok` | 文件能被正常解析 |
| `error` | 解析失败时的错误文本（截断 300 字） |
| `hadBom` | 文件是否带 UTF-8 BOM |
| `migratedFrom` | 正在读旧文件名时，这里给出旧路径 |
| `hasUserFile` | 用户是否真的写过配置文件 |

## 3. 全量配置项

「钳制」= 设置页保存（`POST /dsh-myilidepu/api/settings`）时后端会再收一遍范围，防止直接调 API 写离谱值。

### 人设（`persona`）

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `persona.name` | `"<角色名>"`（占位符，建议改） | 字符串 | 她叫什么；出现在唤醒提示、日记、称呼里 |
| `persona.ownerTitle` | `"你"` | 字符串 | 她怎么称呼使用者 |
| `persona.selfClaim` | `"我"` | 字符串 | 她怎么自称 |
| `persona.diaryTitle` | `"今日摘要"` | 字符串 | `diary show` 的标题 |

> 另外有一份**人设正文**文件 `~/.bili-ai/persona.md`（设置页「她是谁」里可编辑）：存在时优先于上面三个字段，唤醒时只带前 3000 字。它和配置分开，换机器时拷 `.bili-ai` 一起带走。

### 口味（`preferences`）

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `preferences.like` | `["AI 工具与插件","鬼畜与怀旧向剪辑","猫咪","Live2D/模型"]` | 字符串数组 | 选题器（`feed`）的正向信号 |
| `preferences.dislike` | `["带货","擦边","标题党","纯搬运"]` | 字符串数组 | 排除 / 降权的信号 |
| `preferences.publishedAfter` | `""` | `""` 或 `YYYY-MM-DD` | 「只看这天（含）之后发布的视频」。空 = 不限 |

`publishedAfter` 同时管两条**她自己发起**的通路 —— 选题（`feed`）与学习候选（`candidates`）—— 两边共用同一个判断（`tools/lib/pubdate.mjs`），不会出现「一个入口过滤了、另一个没过滤」的静默不一致。

语义（故意保守）：

- **含当天**：填 `2026-09-01` = 2026-09-01 00:00（本地时区）及之后发布的都算。
- **拿不到发布日期的条目会被丢掉**，但在输出里会念出条数（`日期过滤「… 之后」：109 条里留下 81 条，更早丢掉 28 条`）——不是静默丢。
- **写法非法会在命令里当场报错**（`INVALID_DAY`，退出码 2）。宁可当场停下，也不要让人以为「设上了」其实一条都没过滤。
- **只管「她自己挑什么看」**：评论区/私信里别人直接递到她面前的视频不受这条约束。
- **主人点名不受这条限制**（2026-10-23 补）：`node bili.mjs feed --topic "<关键词>"` 是主人直接要看某个话题/类型，
  这一轮**不套** `publishedAfter`（等价于临时放开；也可以用 `--any-date` 显式放开而不给话题）。
  判断在 `scopeOfDate(configured, { ownerPicked })` 里，输出会写明「主人点名（--topic / --any-date）：这一轮不套…限制」，
  不会静默跳过。

### 通知（`notify`）

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `notify.type` | `"none"` | `none` \| `desktop` \| `webhook` \| `command` | 推送通道；旧配置里的 `stdout` / `file` / `dm` 仍兼容 |
| `notify.url` | `""` | URL 字符串 | `webhook` 时必填（按域名自动适配飞书/钉钉/企业微信等报文） |
| `notify.template` | `"text"` | `text` \| `markdown` | webhook 报文模板 |
| `notify.cmd` | `""` | 字符串 | `command` 时要执行的命令（参数后面追加正文） |

### 使用者本人（`owner`）与历史昵称（`aliases`）

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `owner.mid` | `""` | 数字字符串 | 主人（你）的 B 站 mid；分享 `@` 的就是这个人 |
| `owner.name` | `""` | 字符串 | 主人昵称（正文里 `@昵称` 用；查询会风控，所以缓存一份） |
| `aliases` | `[]` | 字符串数组 | 历史昵称兜底（当前昵称仍从登录态动态读） |

### 额度与分享闸门（`quota` / `share`）

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `quota.shareDaily` | `3` | 0–20（钳制） | 每天最多分享几条；`>3` 时设置页会警告「看起来像刷量」 |
| `share.enabled` | `true` | `true` / `false` | 分享总开关（评论与私信共用同一套校验） |
| `share.via` | `"comment"` | `comment` \| `dm` | 分享方式：视频下评论 `@` / B 站私信 |
| `share.minScore` | `13` | 0–20（钳制） | 打分门槛；不到就是「今天没有值得发的」（合法结果） |
| `share.silentAfterDays` | `3` | 正整数（天） | 沉默几天后开始「降档少说」 |

### 倾听（`listen`）

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `listen.comment` | `true` | 布尔 | 是否监听评论区（回复 / `@`） |
| `listen.commentIntervalSec` | `300` | 秒 | 轮询间隔 |
| `listen.scope` | `"both"` | `both` \| `reply` | 直接回我的 + `@`我的 / 只回直接回我的 |
| `listen.oncePerPerson` | `false` | 布尔 | 同一个人 30 天只回一条（由 `comment.mjs` 执行） |
| `listen.allDay` | `false` | 布尔 | 全天守（不只在作息窗口内） |
| `listen.dm` | `false` | 布尔 | 是否监听主人私信 |
| `listen.live` | `false` | 布尔 | 是否监听直播间弹幕 |
| `listen.liveRoom` | `""` | 房间号字符串 | 要守的直播间 |
| `listen.liveScope` | `"owner"` | `owner` \| `mention` | 只回主人 / 只回艾特她的 |

### 作息（`night`）

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `night.windows` | `[{"start":"20:00","end":"24:00","wakes":1}]` | 数组，至少 1 个；`start`/`end` 为 `HH:MM`，`end` 可写 `24:00` 表示跨到午夜 | 每天允许醒来的时段；每个窗口是一批机会 |
| `night.windows[].wakes` | `1` | 非负整数 | 这个窗口醒几次 |
| `night.maxWakesPerDay` | 不设 = 窗口数 | 0–12（钳制） | 一天总醒来次数上限 |
| `night.skipChance` | `0.3` | 0–0.95（钳制） | 「今天不想看」的概率（醒来仍照写日记） |
| `night.minGapMin` | `10` | ≥1（钳制） | 相邻两次醒来至少隔几分钟 |
| `night.maxVideos` | `5` | 1–20（钳制） | 一轮最多筛几条候选 |

### 学习（`learning`）—— 合并新增

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `learning.enabled` | `true` | 布尔 | 是否学习人类世界（给条数时后端会自动置 true） |
| `learning.everyWake` | `true` | 布尔 | 每次醒来先学一条，再去看片 |
| `learning.dailyNotes` | `2` | 0–99（**0 = 不限**） | 每天最多记几条见闻（额度由账本事务强制；2026-10-25 起取消了写死的 ≤2） |
| `learning.recordNotes` | `true` | 布尔 | `false` = 只读不记：照样读原文，但不往见闻账本里写 |
| `learning.candidates` | `3` | 1–3（钳制） | 一次给几个候选 |
| `learning.maxChars` | `16000` | 500–200000（钳制） | 单条原文最多读多少字符（按页切） |
| `learning.maxSessionTokens` | `600000` | 50000–10000000（钳制） | 一个会话累计 token 闸门 |
| `learning.route` | `"auto"` | `auto` \| `subtitle` \| `conclusion` \| `local` | 优先走哪条腿拿原文 |

### 人格（`personality`）—— 合并新增

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `personality.enabled` | `true` | 布尔 | 是否从见闻里提炼人格札记（`human-world.md`） |
| `personality.inject` | `true` | 布尔 | 是否把最近几句带进唤醒提示 |
| `personality.maxChars` | `3000` | 200–20000（钳制） | 注入的人格札记最多多少字 |
| `personality.pickPerDay` | `0` | 0–20（钳制） | 每天最多提炼几句。**0 = 不限**（默认）—— 只有设成大于 0 才会卡；"宁缺毋滥"由手册约束她，不由条数卡 |

### 双日记（`diary`）—— 合并新增

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `diary.private` | `true` | 布尔 | 私人日记（本地 md，只有主人可读） |
| `diary.public` | `false` | 布尔 | **公开日记默认关**；开了才会真的发到 B 站 |
| `diary.publicVia` | `"dynamic"` | `dynamic` \| `comment` | 公开日记走动态还是视频评论 |
| `diary.push` | `true` | 布尔 | 写完是否把「给他的信」推送给你 |

### 足迹（`footprint`）—— 合并新增

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `footprint.mentionOwner` | `true` | 布尔 | 分享时是否 `@` 主人 |
| `footprint.minChars` | `2` | 1–200（钳制） | 署名/正文的最低字数要求 |

### 视频理解（`understand`）

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `understand.required` | `true` | 布尔 | 分享前必须先真读过原文（不是先看弹幕热度） |
| `understand.shareSummary` | `true` | 布尔 | 分享前必须有一份自己写的总结 |
| `understand.viaHumanism` | `true` | 布尔 | 读原文走 humanism 的阅读引擎（`read` / `journal`） |

### 模型与密钥（`model`）—— 合并后新增

| 键 | 默认值 | 取值 | 作用 |
|---|---|---|---|
| `model.enabled` | `false` | 布尔 | 是否给她指定模型。`false` = 沿用 DSH 当前默认模型（与以前完全一样） |
| `model.provider` | `''` | provider id，如 `tencent` | 模型服务。列表来自 DSH 已挂载的 provider |
| `model.model` | `''` | 模型 id，如 `deepseek-v4.1-flash` | 具体模型 |
| `model.reasoningEffort` | `''` | `''` / `off` / `low` / `medium` / `high` / `max` | 推理档；空 = 用该模型自己的默认档。不在白名单的值会落成空 |
| `model.apiKeyEnv` | `''` | 凭据引用名，如 `TENCENT_API_KEY` | **只记名字，不记值**。值在 DSH 凭据库（`~/.dsh/.credentials.yaml`） |
| `model.applyOnWake` | `true` | 布尔 | 每次醒来前重新应用（换了模型/密钥不用重启 DSH） |

三个要点：

1. **换模型是会话级的**，走 DSH 原生 `sessionController.selectModel()` —— 只影响她自己那个会话（`myilidepu`），不动 DSH 的全局默认，也不影响你其他会话。
2. **密钥永不落在这个文件里**。`model.apiKeyEnv` 只存「引用名」，值是设置页「模型与密钥」里写进 DSH 凭据库的；写入后不回显、也不出现在任何接口响应里。
3. **不需要重启**：设置页点「保存并应用」会立刻调一次；`applyOnWake` 开着的话，每轮唤醒前还会再应用一次。

### 不写在 `DEFAULTS` 里、但会被读取的键

| 键 | 用处 |
|---|---|
| `toolsPath` | 覆盖 `bili.mjs` 的位置（默认用插件自带的 `tools/bili.mjs`） |
| `home` | 会话工作目录；留空 = `<数据目录>/work`，自定义时必须是已存在的绝对路径 |
| `paths.dataDir` | **数据目录**（默认 `''` = `$DSH_HOME/myilidepu`）。填绝对路径即整体搬家：两本日记、见闻账本、阅读结果、抽帧、状态 JSON、会话工作区全跟着走。环境变量 `MYILIDEPU_DATA_DIR` 优先级更高。**改完要重启 DSH** |
| `self.mid` / `self.name` | 她自己的 mid / 昵称（设置页只读展示，由登录态体检回填） |
| `watchups` | **重点关注的 UP**：`[{ name, topics }]`（`name` 必填，`mid` 可省 → 按昵称查一次）。命中 `topics` 的稿子额外加权；她 at 主人时也照这几条讲。**不是"去关注他"**——按 mid 直拉公开投稿，不产生任何对外动作。可以手写，也会被 `follows` 自动追加 |
| `follows.enabled` | `true`（默认）= 主人**用她的账号**在 B 站关注了谁，她每轮醒来前自动追加进 `watchups`（只读 `x/relation/followings`，插件从不点关注/取关）。`false` = 名单只认手写的 |
| `follows.topics` | 自动加进来的**新条目**套的默认汇报重点（如 `["DeepSeek","国产大模型"]`）。**只动新条目**，已存在条目一个字都不改 |
| `follows.maxAdd` | 单次最多写几条（默认 10）。超出的下一轮继续 —— 防某天关注了几百人把配置撑爆 |
| `listen.dmWake` | `true` = 每次生物钟醒来**先看一封主人的私信**再去看片（只读 `--peek`，投递成功才 `--ack`）。与 `listen.dm`（20 秒常驻轮询）二选一或同时开 |
| `preferences.publishedAfter` | `'YYYY-MM-DD'` = 只看这天（含）之后发布的；`''` = 不限。管 `feed` 与 `candidates` 两条**她自己发起**的通路，拿不到日期的条目会被丢掉并报数。**主人点名不算**：`feed --topic "<关键词>"` / `--any-date` 这一轮不套限制 |
| `quota.daily` | 限额闸默认每天 2 条自主发言（读取处 `tools/commands/quota.mjs`，实际记录在 `~/.bili-ai/quota.json`） |

## 4. 哪些改动要重启

| 改的东西 | 生效方式 |
|---|---|
| 配置文件（设置页保存 / 手改 JSON） | 下一次命令、下一次醒来就读到；作息类改动会重排唤醒计划 |
| `lib/**`（宿主插件代码、生物钟、设置页后端） | **完全退出 DSH 再启动**（bundle 启动时组装） |
| `lib/client.js`（设置页前端） | 设置页对应 section 重新加载后生效；不确定就重启 DSH |
| `tools/**`（CLI 命令脚本） | 下一次 spawn 即生效（子进程每次新起） |
| `cordis.patch.yml` | 完全退出 DSH 再启动 |

> `model.*` 是例外：改完在设置页点「保存并应用」就**立刻生效**（DSH 原生会话级换模型），
> 不用重启 DSH；`model.applyOnWake` 开着时每轮醒来前还会再应用一次。

> 完整链路见 `docs/ARCHITECTURE.md`。
