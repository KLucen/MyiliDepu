## v1.2.2（2026-10-23）修「用指定模型」勾不上

设置页「模型与密钥」里那个「用指定模型」的勾**怎么点都勾不上**，provider / 模型 / 推理档选了也白选。

### 事故：路径写法两套，`setPath` 只认一套

- 设置页的配置读写有两个入口：FIELDS 表单传的是**数组**路径 `["diary","push"]`，
  模型区传的是**点号字符串** `pick("model.enabled")`。
- 而 `setPath()` 里写的是 `path[i]` —— 它把点号字符串当成数组用，
  于是 `"model.enabled"` 被**逐字符**拆开，写成了
  `cfg.m.o.d.e.l["."].e.n.a.b.l.e.d`。
- 结果：`cfg.model` 永远不存在，`checked={!!m.enabled}` 永远是 `false`，
  勾点下去值写到了垃圾键上 —— 表现就是「点不动」，而且**不会报错**。

### 修复

- `lib/client.js` 新增 `toPath(path)`：`Array.isArray(path) ? path : String(path).split(".")`，
  在 `getPath()` / `setPath()` 这一处统一归一化（唯一真相），数组与点号两种写法都收。
  模型区 8 个调用点（`model.enabled` / `provider` / `model` / `reasoningEffort` /
  `applyOnWake` / `apiKeyEnv` / `service` / `effort`）一次性全好。
- 新增 `tests/client-paths.test.mjs`（6 例）：把 `lib/client.js` 里
  `toPath`/`getPath`/`setPath` 那段**真实源码**抽出来在 `vm.runInThisContext` 里跑，
  逐个验证源码里真实出现过的所有 `pick("…")` 路径都落到顶层首段
  —— 以后再写错写法，测试直接红。

全量回归 **134 tests / 134 pass**。

> 改的是设置页前端，**不用重启 DSH**：刷新一下设置页就是新版（约 0.5 秒热更新）。

## v1.2.1（2026-10-23）修「重启后会话全没了」

v1.2.0 让数据目录能搬家，副作用是一个**致命启动错误**（真事故，已在本机复现并修掉）。

### 事故：`duplicate JSONL session id ... appears in multiple project directories`

- DSH 的会话按 **cwd** 分桶存放：`$DSH_HOME/sessions/--<工作目录>--/<会话 id>/session.v4.jsonl.zstd`。
  她的会话 id 是固定的 `myilidepu`，而 v1.2.0 把工作目录从
  `C:\Users\KLucen\.dsh\myilidepu\work` 换成了 `D:\MyDepu\work`。
- 结果：同一个 id 在两个 project 目录里各有一份。**下一次** DSH 启动时 `dsh-workspace`
  扫描全部会话头、撞见重复 id 直接抛错 →
  `workspaceRegistry` 永不激活 → `workspaceController` / `sessionController` 全部 `pending`，
  界面上表现成「会话全没了」，并且连带 `dsh-myilidepu` 自己也起不来（`pending (waiting for services: …)`）。
- 触发窗口很阴：重复是**上一次运行**造出来的，所以改完配置当时一切正常，重启才炸。

### 修复：启动即去重（只搬不删）

- 新增 `lib/session-home.js`：读会话文件**第一帧**（zstd 流的首帧就是 header，里面带 `id` 和 `cwd`），
  扫描所有 project 桶，找出同名会话的全部副本。
- `lib/scheduler.js` 的 `ensureSession()` 现在在建会话**前后各查一次**：
  留下 `cwd` 与当前工作目录相符的那一份（都对不上时留 mtime 最新的），
  其余**移动**到 `<数据目录>/.orphan-sessions/<时间戳>/<原桶>/<会话 id>/` ——
  绝不删除，随时可以搬回；每次动作都写进 `log.jsonl`。
- 顺带把 `findSessionFile()` 的判定从「路径里含 `myilidepu`」收紧成
  「父目录名 == 会话 id」，搬家后旧桶不会再被误认成"她的会话文件"。
- 新增 `tests/session-home.test.mjs`（6 例，用真 zstd 帧）：首帧解析、单份不动、
  两份重复留 cwd 相符者、cwd 都对不上时退化留最新、三份（含坏文件）收敛成一份、
  `sessions/` 不存在时安静返回。

### 测试

- 全量 `node --test "tests/*.test.mjs"` → **128 个用例全过**（v1.2.0 是 122）。

---

## v1.2.0（2026-10-23）数据目录可搬家

她的「整个生活」不再被钉死在 C 盘的 `~/.dsh/myilidepu/` 下。

### 新增：`paths.dataDir`（数据目录可配置）

- 优先级：`$MYILIDEPU_DATA_DIR`（环境变量）→ 配置里的 `paths.dataDir` → 默认 `$DSH_HOME/myilidepu`。
- 一个键搬走**全部**数据：两本日记、见闻账本（SQLite）、人格札记 `human-world.md`、阅读原文 `readings/`、抽帧 `shots/`、收件箱、`night.json` / `listen.json` / `log.jsonl`、以及她的**会话工作区 `work/`**。
- 解析集中在 `tools/lib/paths.mjs` 的 `resolveDataDir()`；`lib/index.js`、`lib/scheduler.js`、`tools/*` 此前各自拼 `path.join(DSH_HOME, 'myilidepu', ...)` 的 7 处已全部改成 `dataPath(...)`，不存在"改一处漏一处"。
- 设置页「工具链」新增 **数据目录** 一格（留空 = 默认；填绝对路径 = 搬家），`GET /api/settings` 同时返回 `paths.dataDirSource`（`env` / `config` / `default`），排查"为什么还写在 C 盘"用。
- ⚠️ **改完要重启 DSH**：宿主在启动时算路径。`tools/` 下的子进程每次现读配置，所以命令行工具会立刻跟着走，可能出现"命令行已经写 D 盘、插件还在写 C 盘"的短暂不一致，属预期。
- ffmpeg 的放置提示也随之指向 `<数据目录>/bin/`。

### 会话迁移（手动一步，文档已写）

DSH 的会话记录在 `$DSH_HOME/sessions/--<cwd 归一化>--/<会话 id>/`，桶名由会话 cwd 决定。数据目录搬家后她的 cwd 变成 `<新数据目录>/work`，**旧会话要挪到新桶并改头行的 `cwd`**（否则 DSH 当成全新会话）。`docs/ARCHITECTURE.md` 写清了这件事；`lib/work-dir.js` 的 `resolveWorkDir()` 会跟着 `DATA_DIR` 走，不需要手改代码。

### 测试

- 新增 `tests/paths.test.mjs`（6 例）：默认值 / 配置生效 / 环境变量优先级 / BOM 配置 / 坏配置静默回落 / 相对路径解析。
- 全量 `node --test "tests/*.test.mjs"` → **122 个用例全过**。

---

## v1.1.0（2026-10-22）模型与密钥

新增「模型与密钥」：可以给她单独指定模型，也可以填自己的 API 密钥（SK）。

### 新增：会话级换模型（不动全局默认）

- 设置页新增 **模型与密钥** 一组：用指定模型（开关）、模型服务（provider）、模型、推理档、「每次醒来重新应用」。
- 走 DSH 原生 `sessionController.selectModel()` —— **会话级、热生效**，只影响她自己那个会话（`myilidepu`），不改 DSH 的全局默认模型。
- 模型目录是**动态的**：provider 列表和模型列表来自宿主已挂载的 `llm` 服务（`listProviders` / `listModels`），不是写死的枚举；推理档来自 `resolveModelInfo(...).reasoning.efforts`，拿到什么就显示什么。
- 点「保存并应用」立刻切过去；开着 `model.applyOnWake` 时，每轮唤醒前会再应用一次（换了模型/密钥不用重启 DSH）。
- 宿主缺 `llm` 服务时：下拉灰掉并在页面标「宿主不支持」，不白屏、不 500。

### 新增：SK 密钥（只写不读回）

- 设置页「模型与密钥」里填写**引用名**（环境变量名，如 `TENCENT_API_KEY`）+ 密钥值 → 写入 DSH 自己的凭据库（`~/.dsh/.credentials.yaml`，走 `ctx.credentials.set/unset/describe`）。
- **安全约定**：密钥值只在写入那一刻经过内存；接口响应不回声、页面不显示、插件配置文件里只记引用名，永远不会有密钥值。
- 删除密钥走 `unset`，同时清掉配置里的引用名。

### 新增：配置项

- `model.enabled`（默认 `false`）/ `model.provider` / `model.model` / `model.reasoningEffort` / `model.apiKeyEnv` / `model.applyOnWake`（默认 `true`）。
- `model.*` 是「改完即生效」的例外：不重启 DSH，点保存并应用就切。

### 接口

- `GET /dsh-bili/api/model`（别名 `/dsh-myilidepu/api/model`）：provider 目录、模型列表、推理档（可用 `?provider=&model=` 查指定组合）、`suggestedRefs`、凭据「配没配」、各服务可用性。
- `POST /dsh-bili/api/model`：保存 `model.*`；`apply: true` 时立刻应用，返回 `applied` / `applyError`。
- `POST /dsh-bili/api/model/key`：`{ref, value}` 写入，`{ref, action:"unset"}` 删除；支持 `credentialRef` 格式校验。

### 测试

- 新增 `tests/model.test.mjs`（12 个用例，含假宿主 llm/credentials/sessionController）：验证目录透出、参数校验、只动自己的会话、密钥不回声也不落配置文件、旧路径别名、宿主缺服务时的降级。
- 套件总数 100 → **112**，全过。

## v1.0.0（2026-10-22）合并版：MyiliDepu

这一版把两个项目合成一个插件：**dsh-bili-whale**（身体：生物钟 / 看片 / 分享 / 两本日记 / 设置页 / 统一 CLI）与 **dsh-bili-humanism**（灵魂：读原文 → 理解 → 记见闻 → 长人格的 reading / ledger 引擎与提示词）。

包名、插件 id、设置页路径统一为 `dsh-myilidepu`（显示名「我的分身」）；版本号从 1.0.0 重新起算，不沿用任一前身的版本线。

### 新增：学习链路（candidates → read → journal → personality → inbox）

- `candidates [--count N] [--json]`：给几条「值得了解」的候选（默认 3，硬上限 3；只读）。
- `read <BV|URL> [--page N] [--route auto|subtitle|conclusion|local] [--json]`：读一条视频的原文。三条腿：A1 官方字幕 / A2 官方总结 / A3 本地导入，附覆盖率（有字幕覆盖了多少秒、缺多少秒）；默认打印标题、时长、用了哪条路、原文前 2000 字。
- `journal show/add`：见闻账本。`add` 必须有 `encounter`（遇见了什么）与 `missing`（哪里没弄懂），证据最多 20 条；**≤2 条/天（Asia/Shanghai），限额检查与写入在同一个 SQLite 事务里**，超了退出码 3 / `JOURNAL_DAILY_LIMIT`，调度流把今天当「已学完」跳过，不当作失败。
- `personality show/pick`：人格札记 `human-world.md`。`pick` 从某条见闻里摘一句（≤240 字）写进去，**默认 dry-run，`--go` 才写入**；只写这份本地札记，不改 `AGENTS.md`、不写任意路径。
- `inbox [--json]`：见闻收件箱导出（刷新 `inbox.md` / 网页版 / 索引），只读账本。

### 新增：调度流合并成 ①–⑨

醒来后固定九步：① 学习（candidates → read → journal add）② 注入人格（读 `human-world.md` 最近几句）③ 看片（feed → debrief → 深读 2–3 条）④ 理解（先读原文，写自己的总结到 `shots/summaries/<BV>.md`，写不出就如实说）⑤ 分享 @ 主人（评分卡 / 额度 / 同一视频 7 天 / 同一个人 30 天）⑥ 公开日记（默认关，开了也要 `--dry` → `--go`）⑦ 私人日记 ⑧ 推送（`diary.push`）⑨ 收工（`diary log`）+ 8 分钟硬冷却。

### 新增：阅读引擎与本地账本

- 移植 humanism 的 reading / ledger 引擎到 `lib/reading/*`：`node:sqlite` 账本（阅读结果、见闻、人格、收件箱、任务），6 小时读缓存，请求预算与 token 门，缺凭据 fail-closed。
- 数据统一落到 `$DSH_HOME/myilidepu/`：`diary.md`（公开日记）、`diary-private.md`（私人日记）、`human-world.md`（人格札记）、`ledger.sqlite`（账本）、`readings/<id>.json`（原文）、`shots/`（字幕与总结）、`work/`（专用会话目录）。

### 新增：设置与配置统一

- 设置页新增四组：**学习**（总开关 / 每次醒来都学 / 每天见闻上限 / 候选条数 / 读原文走哪条路）、**人格**（开关 / 注入 / 注入字数 / 每天摘录几句）、**日记**（私人 / 公开 / 公开走动态还是评论 / 推送）、**足迹**（是否 @ 主人 / 每天分享上限 / 分享评分门槛）。
- 配置文件统一为 `$DSH_HOME/myilidepu.config.json`；旧的 `bili-whale.config.json` 自动兜底并标记迁移来源。手动改 JSON 时 **UTF-8 BOM 会被自动剥掉**，语法错 / 顶层不是对象会在设置页顶部显示路径与原因（不再「改了配置没生效」）。
- 接口路径迁到 `/dsh-myilidepu/api/*`；旧的 `/dsh-bili/api/*` 保留为别名。

### 工程

- **零 npm 依赖**：不依赖 `@deepseek-ai/dsh-tools` / schemastery，用内置 `node:sqlite`；`engines`: `node >= 24`、`dsh >= 0.2.1-rc.2 < 0.3.0`；没有 `prepare` / `postinstall` 等生命周期脚本，`link:` 装完即可用。
- 测试入口改为 `node --test "tests/*.test.mjs"`（当前 7 个测试文件、84 个用例全过；临时目录、虚构凭据、模拟网络，不登录真实账号、不发真实消息）。注意：在 Node 24.20 上 `node --test tests/`（传目录）会报 `Cannot find module …\tests`，所以脚本用 `*.test.mjs` 通配。

### 合并时的取舍（明确没做的）

- **不移植** humanism 的视觉抽帧（`visual-*`）、本地音频 ASR（`media.py` 那条 Python 链路）与平台写执行器（`writer.mjs`）：合并版阅读引擎**只读**，只做「读原文 → 落账 → 人格札记 → 收件箱」。
- **不移植** humanism 的 DSH 工具注册（`bili_humanism_*`）：改为统一 CLI 入口 `tools/bili.mjs`，不扩大模型可调用的工具面。
- **保留** whale 自己的 ffmpeg 抽帧与「真看画面」（`debrief` / `watch-video`）——这与上面 humanism 侧被去掉的抽帧是两回事。
- **不保留** whale 的独立设置页（`lib/settings.html`）与旧插件 id/路径：唯一入口是 DSH「设置」里的「我的分身」。
- **不做**多账号、代理 / 指纹轮换、自动解验证码、任意转发、任意调度、跨插件共享账号锁 / 配额 / 暂停。
- **沿用 humanism 上游 `AGENTS.md` 的人类约束**：评论端点保持关闭、不新增评论开关/工具/端点，不共享凭据，公开测试与文档只用合成数据 / 占位符；平台风控（412 / 429 / -352 / -799 / -509 / -10403）一律停手退避，不自动重试，持久化的风控暂停不会被程序自动清除。

---

以下是前身项目 **dsh-bili-whale** 的历史条目（v0.4.5 → v0.3.0，原文保留；v0.2.0 与 v0.1.x 见文末说明）。

## v0.4.5（2026-10-22）

这一版是「抗限流 + 交付可靠性」两件事，加上社区 review 挑出的几处真 bug。

### 新增：抗限流三件套（`tools/lib/bili-api.mjs`）

社区实测指出：B站 的 412 是 **IP 级限流** ✗ —— 连着打一阵之后
`view` / `detail` / `playurl` / `reply` 会**一起挂**，停 25 秒都不恢复。
而我们的请求模式正好在招它：一轮要打 25~30 次，同一条视频的 `view` 被 6 个命令各查一遍。

1. **缓存** —— 元信息 24 小时只问一次
   - 只缓存「静态一点」的：`view` / `acc/info`（`nav` 10 分钟）
   - **短期授权链接绝不缓存**：`playurl` / `player/wbi/v2`（缓存了就是死链 ✗）
   - **会变的不缓存**：评论 / 收件箱 / 动态流 / 点赞 / 关注关系
   - 缓存键**按账号隔离**（换号不会看到旧号的数据 ✓）且对参数做哈希（避免 `&` 歧义）
2. **熔断** —— 撞到 HTTP 412/429 或风控码（-352 / -799 / -509 / -10403）就停
   退避 5 → 10 → 20 分钟封顶；期间**只吃缓存**、不硬闯；退避按端点记（一个接口成功不重置另一个的）
   - 例外：`playurl` 的 `-412` 是「大会员专属 / 地区限制」，**不熔断** ✓（实测过：否则一个会员视频会把整机停 5 分钟 ✗）
3. **节流** —— 两次请求至少隔 300ms，**跨进程共享时间戳**（并行跑命令也不会贴脸）

配套：
- `deps` 多一行「B站 限流」（正常显示缓存条数 / 熔断显示还要等几分钟）
- `~/.bili-ai/api-requests.log` 请求日志：每行 `时间 HIT|NET 路径`（2000 行封顶）
- `BILI_NO_CACHE=1` 可完全关掉缓存与熔断（测试与排障用）

### 新增：`comment --check` 只读预检

回答「这条回复到底能不能发」—— 解析出被回复者（含 `root == parent` 的顶层评论），
给出 `✓ 能发 / ✗ 会被 fail-closed 挡`，**不发文、不占额度**。

### 修：评论回复的几个坑

- `parentAuthor` 只翻楼中楼 → **顶层评论（`root == parent`）永远查不到作者** → fail-closed
  修：用响应里就带着的 `data.root`
- `root=0` 同样查不到 → 入口处规范化：`root` 为 0/空时视作 `parent`
- `parentAuthor` 硬编码 `type=1` → **动态评论（type=11）永远查不到作者** → 修成按 `--type` 传
- 「同一个人 30 天只回一条」对主人不生效（判定放行 + 不记入 `replied.json`）

### 修：`dm-await` 的交付回执

以前监听命中了、但 `prompt` 发送失败 → 那条消息就**丢了** ✗
新增 `--peek`（持久化待交付消息 + 返回 receipt）/ `--ack <receipt>`（宿主收到后确认）
→ 调度器改成 `r.ok && j.hit && j.receipt` 才算收到 ✓

### 修：唤醒提示

- **每次看几条**不再写死 5 条 ✗ → 读 `night.maxVideos`（`readCfgNow()` 每次现读 ✓）
- **回复要挂在对方那条评论下面** → 提示里直接给【坐标】清单（oid / root / parent）
- **提示里写死了旧插件目录名** ✗ → 改成 `<插件目录>`（她照着旧路径跑到 0.2.0 的副本上 ✗）

### 修：抽帧超时

`debrief` 调 `bili-watch` 的默认超时是 120 秒 ✗
而「场景检测空跑整片 + 下载 + 拼九宫格」按时长线性长 →
一条 **25 分钟**的视频必然 `ETIMEDOUT` ✗
修：超时改成 `120s + 每秒 1.5s`（1492 秒的片子 → 2358 秒），场景检测那跳 600 秒；
超过 20 分钟会先提醒一句（不拦）。

### 修：设置页

- 分组顺序曾因「按字段出现顺序推」而乱掉（工具链跑到第一位）→ 改成显式 `GROUP_ORDER`
- `buvid3` 校验太严（真实值结尾是 `infoc`）→ 放宽 + **只警告不拦**
- 那个警告后端返回了但前端没接 → 现在会显示
- `.blw-err` 补 `white-space: pre-line`（多行报错不再塌成一行）

### 清理

删掉死文件与死配置：`lib/settings.html`（早就不挂路由）、`tools/verify/verify-reply.mjs`、
`examples/`、`share.decayPerDay`（换算法后没人读）。88 → 88 个文件（新增了 review 测试与 dm 回执辅助）。

### 测试

- 58 → **67 个用例全过**
- 新增覆盖：缓存按账号隔离 / 短期链接不缓存 / `noCache` 不回落旧数据 /
  缓存键转义 / 并行请求最小间隔 / 一个接口成功不重置另一个的退避 /
  连续风控第三次退避 20 分钟 / `wakePrompt` 跟着 `maxVideos` 走 / `--check` 四种情况 / 顶层评论作者
- 真机验证：58 次请求日志（16 HIT / 29 NET 分接口统计）· 熔断 5→10→15 分钟 ·
  `playurl -412` 不熔断而 `HTTP 412` 仍熔断 · 短片子抽帧 7.2 秒

---

## v0.4.3（2026-10-22）

三个 issue + 一个 PR。第一个最要紧：**旧端点被判 412 时，六个读命令会直接崩**。

### 修：旧 `view` 端点 412 → 六个命令全崩（#18）

`debrief` / `fav` / `comments` / `subtitles` / `video` / `quota` 的第一步都打旧端点
`/x/web-interface/view`。对部分网络环境，B站 会直接返回 **HTTP 412 + HTML** ✗
—— 于是崩在 `JSON.parse`，报错是：

```
<anonymous_script>:1
<!DOCTYPE html
SyntaxError: Unexpected token '<'
```

完全看不出真实原因 ✗

**修法**：新增中间件 `tools/lib/bili-api.mjs`（42 行），`apiGet()` 自动处理：

```js
const signedPaths = {
  '/x/web-interface/view':  '/x/web-interface/wbi/view',
  '/x/player/playurl':      '/x/player/wbi/playurl',
}
```

- 旧路径 → 自动换成 WBI 端点 + 自动签名 ✓
- 签名密钥缺失 → 返回「WBI 签名不可用」而不是 SyntaxError ✓
- 任何失败都返回 `{ code, message }`，**不再抛 JSON.parse 异常** ✓
- 10 个命令都改成走它（不是逐个改调用点）

> 这个 412 不是所有人都会遇到（我们这边两个端点都 200），是按 IP / 账号 / 地区判的。
> 改成 WBI 之后两条路都能走 ✓

### 修：`dm` 互关要求和「不关注人」红线互相卡死（#19）

新装用户 `attribute=0` 时，**分享和推送两条路都是死的**，
而提示只说了「去关注主人」—— 单向关注只有 `attribute=2`，拿不到互关的 `6`，
还得主人也回关，这一步 README 没写 ✗

**修法**：
- `dm --status` **分方向显示**：
  ```
  她 → 主人：未关注
  主人 → 她：未知（请在主人账号确认）
  → 请登录她的账号，在 https://space.bilibili.com/<owner> 手动关注主人。
  → 请登录主人账号，在 https://space.bilibili.com/<self> 确认并手动回关。
  ```
- 单独识别拉黑关系（`attribute=128`）
- README 写明是**双向**，并把「谁在哪一步点哪里」写清楚

**没有加** `follow --target` 命令：那是主人明确的红线，
「只允许 owner.mid」的边界太容易被改宽，不值得为省一次手动点击承担这个风险。

### 修：`diary show` 对 CRLF 日记解析失败（#20）

Windows 上手写日记（记事本 / Python 文本模式）是 CRLF，
`split('\n')` 之后每行末尾留着 `\r`，`^##\s+(.+)$` 一个标题都匹配不到 →
「看过 0 条」✗ 而文件本身完全正常 ✓

**修法**：三处 `split('\n')` → `split(/\r?\n/)`
（读日记 69 行、读 `whale-log.jsonl` 48 和 111 行）

验证：把现有日记在内存里转 CRLF，两种写法各跑一遍 ——
`split(/\r?\n/)` → 44 段 ✓ / `split('\n')` → **0 段** ✗

### 收：PR #21 诊断输出转义（by anupamme）

`dynamic-image.mjs` 打印「用 Python 转换图片」的示例命令时，`imagePath` 是直接拼进去的。
这行日志是**给人复制去跑的** —— 路径里带引号就不该拼出第二条命令。
按他的写法落地 3 行（对路径做引号/反斜杠转义）。

### 测试

- 39 → **57 个用例全过**
- 新增覆盖：#18（412 时干净失败且不写）、#19（分方向判定）、#20（CRLF）、
  以及 A4–A9 / B1–B6 / C1 / C3 / D2–D3 那批（补测清单里的条目）
- 68 个 JS/MJS 文件全部通过 `node --check`
- 命令：`node --test tests/planner.test.mjs tests/integration.test.mjs tests/updates.test.mjs tests/supplement.test.mjs`

### 真机验证

- 设置页顺序正常（她是谁 → 你 → 口味 → 作息 → 分享 → 监听 → 日记与推送 → 消息推送 → 工具链 → cookie）
- 真实唤醒一次：08:35 叫醒 → 写两本日记 → 分享 1 条（18 分）
- 人设生效：15 个「喵」、0 个「本小姐」、0 个感叹号
- 她自己在私密日记里认了「前面那几段天亮了/鸟在吵是我编的」

---

## v0.4.2（2026-10-22）

在 v0.4.1 基础上补上三个真修改，外加两个新功能（默认关闭）。

### 修：最小唤醒间隔在重排后会失效（v0.4.1 的漏洞）

v0.4.1 给「同一窗口的多次醒来」加了 10 分钟硬下限，靠 `state.wokeAt` 算「上次什么时候醒的」。
但 `historyOf()` 在重排时会**丢掉 `wokeAt`** —— 凡是走重排的路径（保存设置、投递后重置、
done 判定）都会让它变成 0，下一次 tick 就绕过了间隔。

**修法**：`historyOf()` 保留 `wokeAt`，让间隔在所有重排路径上都成立。

### 修：设备 ID 保存失败时不该继续发

v0.4.1 把私信的 `dev_id` 改成固定值（`~/.bili-ai/dev_id`）。但如果**写文件失败**，
旧实现会退回「随机 UUID 继续发」—— 风控漏洞又回来了。

**修法**：保存失败就**停止发送并报错**，不拿随机 ID 顶上去。

### 修：私信投递失败时 notify 仍返回成功

`notify` 的私信后端在子进程失败时，退出码仍是 0 —— 调用方会以为「已经通知到了」。

**修法**：私信投递失败就返回失败退出码。

### 新：主人 @ 请求总结（默认关闭）

可选功能：主人在评论区 **@ 她并说「总结」**，她把最近的动态整理成一段推送到配置的通道。

- 默认**关闭**；启用需要同时开启评论监听、监听范围包含 `@`、并配置 `owner.mid`
- **只认主人的 mid** —— 别人 @ 她不会触发 ✓
- 投递走设置页「消息推送」的通道（私信 / webhook / 自定义命令）

### 新：会话工作目录可配置

v0.4.0 把她的会话 cwd 从用户主目录改成了固定目录 `~/.dsh/whale-work`。
现在可以自定义（多智能体 host 想让不同实例各有目录时有用）。

- 留空 = 仍然是 `~/.dsh/whale-work` ✓
- 自定义时要求：**绝对路径** + 目录**必须已存在**（不会替你创建 ✗ 免得写错路径到别处）
- 配合「在那个目录里放一份她自己的 AGENTS.md」= 身份与作用域分离 ✓

### 内部整理

- `tools/lib/capture.mjs`：子进程输出用文件句柄捕获（Windows 沙箱禁用管道的问题）
- `tools/lib/cli-args.mjs`：命名参数 → 位置参数的翻译收成一份（原来散在 `bili.mjs` 里）
- `tools/lib/feedback.mjs`：判「有没有新回复」改成**按事件 id 计数 + 时间水位**，
  不再对「整段结果窗口的摘要」做判断（避免窗口滑动导致的重复计数）

### 测试

- 上游 25 个用例先跑通，再改
- 本版 **39/39** 通过（新增：配置目录 / PATH 与 Electron 分支 / 文件捕获 / 命名参数 /
  设备 ID 持久化失败停发 / notify 失败返回码 / digest 部分失败时的干净 JSON）
- 64 个 JS/MJS 文件全部通过 `node --check`
- 命令：`node --test tests/planner.test.mjs tests/integration.test.mjs tests/updates.test.mjs`
- 测试用临时目录 + 虚构凭据 + 模拟网络；不登录真实账号、不发真实消息

---

## v0.4.1（2026-10-22）

四个 bug 修复。最上面那个很重要 —— 它会让小号私信被 B站 风控。

### 修：私信被风控（最重要）

`dm.mjs` 每发一条私信都会生成一个**随机的设备 ID**（`msg[dev_id]`）：

```js
body.set('msg[dev_id]', 'WEB-' + crypto.randomUUID().toUpperCase())
```

B站 靠这个字段识别「这条消息是哪台设备发的」。正常人不会每发一条就换一台设备 ✗
—— 于是风控看到的是「同一个账号在不同设备之间高频切换」，小号私信容易被限制。

**修法**：生成一次、存到 `~/.bili-ai/dev_id`、之后永久复用 ✓
（真浏览器里这个值本来就是固定的 ✓ 固定了才像同一台设备）

> 已经发过一批私信的账号，历史记录改不了。如果已经被限制，建议申诉时说明是客户端的问题
> （每条消息的 device id 都不同），现已修复。

### 修：「主人回复」检测不再做子串匹配

`quota react --auto` 判断「主人回没回我」时，是把 `comment-digest` 的**整段人类可读输出**
拿去做 `out.includes(主人昵称)` / `out.includes(主人 mid)` ✗
—— 统计行、标签行、占位文本里只要出现主人的名字或 mid 就会命中 ✗
结果：明明没人回，却记一次反馈 → **沉默衰减被清零** ✗（沉默机制失真）

**修法**：`comment-digest` 新增 `--json`，输出结构化结果：
`{ ok, hours, count, reply, at, ownerMid, ownerReplies, ownerReplyItems, items }`
`ownerReplies` 是**按 mid 精确比对**出来的数字 ✓ 没有任何子串匹配。
`quota` 改读这个数字，命中详情也从 `ownerReplyItems` 打印。

实测：最近 1 小时（无回复）→ `ownerReplies=0` → 没有误记；
最近 72 小时（确有一条）→ `ownerReplies=1` → 正确记一次反馈 ✓

### 修：密集计划会连着醒

同一个窗口里要醒多次时，每次的时刻是「从现在到窗口结束」里均匀随机抽的，
两个相邻的醒来之间**没有任何间隔约束** ✗ 实测出现过 22:53 / 22:59 / 23:11 挤在 18 分钟里。

**修法**：相邻两次之间加一个 **10 分钟硬下限**（`cfg.minGapMin`，默认 10）：

```
earliest = max(now, 窗口开始, 上次醒来 + 10 分钟)
```

窗口里放不下下一次就不排 —— **少醒几次，而不是挤在一起** ✓
实测：04:34 醒过一次，下一次自动排到 04:57（间隔 23 分钟）。

### 修：「不看」会把整个窗口作废

`wakes: 5` 的窗口，掷到一次「不看」之后整段窗口就被拉黑了 ✗
—— 那一夜只醒了 1 次就收工，剩下 4 次机会全没了。

**修法**：「不看」和看视频一样只消耗**一次**机会（`usedCount +1`），
窗口是否用完由「还剩几次」自然判定，不再用黑名单。

### 测试

- 新增一条用例：「skip 只消耗一次机会，wakes>1 的窗口不会被整段作废」
- 两条断言旧机制（`skippedWindows`）的用例改成断言行为
- 25 个用例全过 ✓

## v0.4.0（2026-10-21）

这一版以「人设版」（2026-10-21）为基础，把第三方审查报告里剩下的四条修完，
并补上了一套 24 个用例的自动测试。

### 新增：她专属的人设

- 设置页「她是谁」那三个字段下面新增 **人设正文** 输入框 + **注入人设** 按钮
- 存在 `~/.bili-ai/persona.md`（和凭据、账本放一起，换机器拷 `.bili-ai` 就带着走）
- 每次唤醒 / 私信 / 评论 / 弹幕 / 直播间提示都会附上（前 3000 字）
- **人设文件优先**：和设置里的「名字 / 自称」冲突时以人设文件为准

### 修：审查报告剩余四条

- **分享总开关管住了私信**：评论和私信走同一套校验（`share.enabled` / `minScore` / `--reason` / `--rank 1`）。
  以前关掉分享，`dm --share` 照样能发出去。
- **凭据路径统一**：插件和工具链都从用户目录 `.bili-ai/credentials.json` 读写，
  自定义 `DSH_HOME` 不再导致设置页显示新账号、工具却还在用旧账号。
- **跨午夜不再出错**：生物钟改用绝对时间戳。以前 23:00–01:00 的窗口里抽到次日 00:30，
  会被"修正"成当天 23:00。
- **不再每分钟重抽签**：未触发的计划保留原时刻和「看 / 不看」的决定。
  以前每 tick 重排一次，`skipChance` 等于失效。

### 修：多窗口

- 只有作息字段变了才重排（改推送、改人设不会重置待执行计划）
- 已跳过的窗口按「窗口起始日期 + 窗口名称」记账，重启、跨午夜、保存设置都不会复活
- 按真实截止时刻排序窗口，窄窗不会再被静默跳过
- 一次「不看」只作废那一个窗口，不再连累当天后面的窗口

### 修：调度器与生命周期

- Node 运行时初始化失败 → 不再启动调度器，并在状态接口里明确报错
  （以前是静默失效，界面上一切正常，但它永远不会醒）
- 唤醒投递失败可以在下一轮重试；只有投递成功才进入冷却
- 停止插件时清理启动定时器
- 「生物钟」状态在依赖体检和设置页可见：正常显示「已启动」，坏了显示「没起来：<原因>」

### 修：此前累积的一批

- `notify` 的私信后端忽略 `--dry`，预演会真的发出私信
- 批准待审回复时引用未定义的 `cfg`，草稿在发送前就被删除
- 「推送日记摘要」开关存不进配置（字段白名单漏了 `diary`）
- 跨午夜窗口里的评论监听始终判定为窗口外
- 工具链 11 处 `process.execPath`（在 Electron 派生进程里那是主程序，spawn 它不执行脚本）
- `buvid3` 不再必填（以前缺它连评论都发不出）
- 评论/私信分享之外的写操作：三条动态命令调了 `gate()` 却没导入
- `mention-check` 不再用调试残留的假 mid / 假昵称
- `video-content` 不再写死拉无关的 GitHub 仓库
- 命令表清掉三个悬空条目
- `stop()` 补上私信轮询的 `clearInterval`
- 视频下载改流式写盘（两小时 720p 不再吃 1–2 GB 内存）
- 失败的命令改为非 0 退出码（以前 agent 会误判成成功）
- `diary` 的时区分歧（凌晨 0–8 点的发言被算到昨天）
- 动态图片的限额闸门提到上传之前（以前图传上去了才拦）
- `fav` 缺文件不再裸崩

### 测试

- 新增 `tests/`：`node --test tests/planner.test.mjs tests/integration.test.mjs`，24 个用例全过
- 测试使用临时目录、虚构凭据、模拟网络与宿主接口；不登录真实账号、不发送真实消息

### 升级注意

1. 停止 DSH，备份旧插件目录和 `~/.bili-ai`
2. 用新的插件目录替换旧的，重启 DSH
3. 到设置页跑一次「依赖体检」
4. 旧版计划没有可靠的绝对日期，首次读取会重算待执行时间
5. 如果你以前用自定义 `DSH_HOME`，请在设置页重新保存一次 cookie 并核对账号

---

## v0.3.0 —— 会感觉的一版（2026-10-20）

> 这一版的主题：**把"机制"变成"她的反应"**。
> 沉默不再只是被代码拦住，而是她**先感觉到安静**、再自己决定少说；
> 收藏不是低配的分享，而是「这个我想留着」。

### 新增

- **她学会了"收藏"** `bili.mjs fav`
  - `fav <BV> --reason "…" --dry|--go` · `fav --list [--json]` · `fav --check <BV>`
  - **五条判据写死在代码里**（不是提示词）：
    ① 理由 ≥6 字（说不清为什么留 = 不收）② 每天 ≤3 条 ③ 同一视频 30 天一次
    ④ 同类 ≥2 条要 `--better` ⑤ 必须先 `--dry`
  - 收藏**不占分享额度**，但会成为她下次选题的**口味信号**（feed 会读）
  - 收藏分四类：想学 / 想再看 / 和我有关 / 以后要提
- **沉默从"代码拦住"变成"她自己感觉到"**
  - 唤醒提示里会告诉她「主人已经 N 天没有回应你了」——**只给事实**，情绪留给她自己写
  - 三档：0–2 天正常 · **3–6 天安静**（最多分享 1 条，可主动问一次「在忙吗」）· **7 天+ 心慌**（不分享，只写心情）
  - `quota silence` 现在也显示档位；新增 `quota ask` 记"已经问过一次"（只问一次，不追问）
  - **恢复转折**：她沉默很久后又等到你，会看到「他回来了」——不是若无其事
- **启动测试** `bili.mjs selftest`
  - 一条命令列出：配置 / 凭据 / 登录态 / 数据目录 / 依赖体检
  - 最后直接告诉用户**最容易卡的两件事**：会话在「工作区 → 未分组」里、要给它「完全访问」
  - 设置页会显示首次安装横幅，`selftest` 全绿后自动消失
- **选题器大改**（`feed`）
  - 默认来源从"只搜索"改成 **搜索 + 热门 + 排行 + 关注**（更像人在刷 B 站）
  - **彻底去掉播放量权重**（以前大 UP 的爆款永远霸榜）
  - 新公式：`log10(1+弹幕密度)×3 + 偏好命中×4 + 反馈学习×2.5`
  - 多样性：同一类别最多 2 条，完全没命中的最多 1 条
  - **不再推荐她自己的视频**（以前真的会刷到自己 ✗）
- **反馈回流**：被赞过的视频会存下 BV + 标题 + 评论原文，`feed` 从里面**学主题词**给自己的候选加权
- **推送可关**：设置页「写两本日记」改成「推送日记摘要」——日记本身**不可关**，只决定推不推

### 修复

- **掷到「不看」会立刻叫醒她**（社区反馈，修了 8 层）
  1. skip 分支没有 `at` → 挑时刻挪到掷骰子之前
  2. scheduler 不等 `at` → 加 `nowMin() >= st.at` 判断
  3. `?? 0` 让旧状态立刻触发 → 改成 `?? st.endAt`
  4. `fired` 是 `undefined` → 显式写 `false`
  5. `at` 每 tick 重随机（永远追不上 `now`）→ 已有计划时沿用
  6. `keepSkipAt` 里 `> now` 太严 → 去掉（at 过了也沿用）
  7. 投递后没标记 → 写 `done: true`，`makePlan` 认 `done`
  8. `done` 状态写回时丢了 `done` 字段 → 所有 done 返回都带 `done: true`
- **沉默衰减形同虚设**：`react --auto` 每轮把同一个赞重记一次 → `last` 永远刷新 →
  实际要 5 天才开始衰减。改为按 `like_time` 去重（回复按内容哈希）
- **`dm --dry` 会真发**：dry 被塞进 `if (SHARE)` 里 → 推送型 dry 直接发出去了 ✗
  顺带修：dry 在"闸门失败"之前就退出，看不到拒绝原因
- **Desktop 版 DSH 找不到 node.exe**（社区 PR #2）：`process.execPath` 是 Electron，
  改为显式解析真实 node；补 PATH / ProgramFiles 候选 + `ELECTRON_RUN_AS_NODE`
- **DSH 会话内系统性失效**（社区 PR #3）：会话 cwd 在主目录、stock Windows TEMP 也在主目录
  → DSH 沙箱拒绝 → pwsh 起不来 → 整条工具链死。插件加载时把宿主 TEMP 重定向到
  `%PUBLIC%\dsh-whale-temp`；跨午夜窗口按 `[start, 1440+end)` 比较；沙箱内捕获式子进程改 `stdio: 'inherit'`
- **桌面通知永远发不出**（社区 Issue #1）：`.ps1` 里写 `template=\"ToastGeneric\"` 是非法转义
  → PowerShell ParserError；`stdio: 'ignore'` 把错误吞了。改 `template=""`（PS 双写）+ 捕获 stderr
- **假开关清理**：`diary.public/private/pushDaily` 没人读 → 删；「同一个人只回一条」写死 → 按配置；
  `self.mid/name` 只有默认值没人写 → 从 cookie 体检里回填

### 已知限制

- **主人的私密收藏夹读不到** ✗（B 站不给，这是设计边界）。想让她读你的口味，得建一个**公开**收藏夹。
- 「反馈 → 偏好」这一环是**软**的：她读到日记里的「偏好校准」自己调整，
  代码只保证"数据在"和"feed 会读被赞/收藏过的主题词"。

---

> 更早的 v0.2.0（私信版，2026-10-19）与 v0.1.x 系列（2026-10-18）条目从略，完整原文见上游仓库 `CHANGELOG.md`：<https://github.com/Alterssss/dsh-bili-whale>。
