# 架构：四个面，四种生效方式

这个插件不是「一个脚本」，而是**四块代码分别跑在四个地方**。改错地方最常见的症状是「我明明改了，怎么没反应」——因为每一块要生效的方式不同。

| 面 | 代码 | 跑在哪 | 改完怎么生效 |
|---|---|---|---|
| ① 宿主插件 | `lib/index.js` | DSH 进程内（cordis 插件，`inject: sessionController / webServer / connection`） | **完全退出 DSH 再启动**（bundle 只在启动时组装） |
| ② 设置页前端 | `lib/client.js` | 浏览器（DSH Web GUI 的设置页） | 重开设置页；不确定就重启 DSH |
| ③ 生物钟 | `lib/scheduler.js` + `tools/lib/night-plan.mjs` / `night-config.mjs` | DSH 进程内（常驻，每 60 秒 tick） | **完全退出 DSH 再启动**；但**配置**改动不用重启（每次现读） |
| ④ 每次 spawn 的 CLI | `tools/bili.mjs` + `tools/commands/` + `tools/verify/` + `tools/lib/` + `lib/reading/` + `prompts/` | 独立 node 子进程（每次命令新起一个） | 改完下一次 spawn 就生效，**不用重启 DSH** |

## 模块图

```
DSH 宿主进程
└─ lib/index.js                      ① 宿主半边（唯一入口，package.json 的 "main"）
   ├─ lib/client.js                  ② 设置页 section（浏览器里跑，经 __ModuleLoader__ 注入）
   │     └─ fetch /dsh-myilidepu/api/*（旧路径 /dsh-bili/api/* 是别名）
   ├─ HTTP 路由（全部过信任栅栏 + 只认本机回环）
   │     settings / cookie / persona / deps / pending / pending/reject /
   │     pending/approve / notify-test / status / learn-status / model / model/key
   │     （model / model/key：查模型目录 + 会话级换模型 + 写 SK 到 DSH 凭据库）
   ├─ lib/scheduler.js               ③ 生物钟
   │     ├─ tools/lib/night-plan.mjs  掷骰子 → 计划（何时醒 / 醒几次 / 看不看）
   │     ├─ tools/lib/night-config.mjs 读作息配置（每次重读，不吃缓存）
   │     ├─ sessionController.prompt(...)  叫醒会话 "myilidepu"
   │     │     cwd = <数据目录>/work（默认 $DSH_HOME/myilidepu/work）
   │     └─ 监听器：评论区（tools/commands/comment-await.mjs）、
   │                私信（dm-await.mjs）、直播间弹幕（danmaku-await.mjs）
   └─ 数据：<数据目录>/（默认 $DSH_HOME/myilidepu/；会话工作目录 work/ + SQLite 账本）

被叫醒的 agent 每一轮自己 spawn 命令（④）：
node tools/bili.mjs <命令> ...
 ├─ tools/lib/      配置 / 路径 / 凭据 / B 站 API / 额度闸 / 通知 / node 运行时
 ├─ tools/commands/ 每个命令一个脚本（read / candidates / journal / personality / inbox /
 │                 feed / debrief / share / diary / notify / selftest / deps / …）
 ├─ tools/verify/   只读复核脚本（session / thread / check-* / recon …）
 ├─ lib/reading/    【移植自 humanism】读原文引擎（只读）
 │     index.mjs     门面：接配置 + 路径，惰性单例
 │     service.mjs   读 / 候选 / 见闻 / 人格 / 收件箱（不含任何平台写操作）
 │     reader.mjs    路由 A1 字幕 / A2 官方总结 / A3 本地导入 + 覆盖率
 │     network.mjs   B 站 API + 凭据（复用 ~/.bili-ai/credentials.json）
 │     store.mjs     node:sqlite 账本（readings / notes / personality / inbox / tasks）
 │     budget.mjs / token-gate.mjs / errors.mjs
 ├─ lib/ledger/     【移植自 humanism】账本策略
 │     journal-policy.mjs  见闻额度（同一 SQLite 事务内强制；默认 ≤2 条/天，配置 0 = 不限）
 │     personality.mjs     人格札记 human-world.md 的读写与修订
 │     inbox.mjs           见闻收件箱导出（有界导出）
 └─ prompts/humanistic-reading.md  读原文时的提示词
```

## 数据落在哪

| 数据 | 位置 |
|---|---|
| 配置 | `$DSH_HOME/myilidepu.config.json`（旧 `bili-whale.config.json` 兜底） |
| 凭据 | `~/.bili-ai/credentials.json`（只写不回显；reading 引擎复用同一份） |
| 数据目录 | 默认 `$DSH_HOME/myilidepu/`；可被 `paths.dataDir`（配置）或 `$MYILIDEPU_DATA_DIR`（环境变量）改写 —— 解析在 `tools/lib/paths.mjs` 的 `resolveDataDir()`，所有数据路径都从它派生 |
| 会话工作目录 | `<数据目录>/work/`（可用 `home` 改，但必须是已存在的绝对路径） |
| 见闻 / 人格 / 收件箱账本 | 数据目录下的 SQLite（`ledger.sqlite`，见 `lib/reading/store.mjs`） |
| 原始阅读结果 | 数据目录下的 `readings/<id>.json` |
| 日记 / 收藏 / 额度等旧状态 | 沿用 whale 的位置（`~/.bili-ai/`、`~/.dsh/` 下的 md / json / jsonl 文件） |

> **搬家注意**：DSH 的会话记录在 `$DSH_HOME/sessions/--<按 cwd 归一化的目录名>--/<会话 id>/`，目录名由会话 cwd 决定。数据目录搬家后 cwd 变成 `<新数据目录>/work`，**旧会话文件要跟着挪到新桶并改掉头行里的 `cwd`**，否则 DSH 认不出来（会当成一个全新会话）。插件本身不替用户做这步。

> 以上目录都在本机；除了你在设置里明确开启的公开动作（分享、公开日记、评论/动态/私信），没有数据上传到第三方。

## 一次「醒来」的时序（③ → ④）

1. `lib/scheduler.js` 每 60 秒 tick 一次，读 `night-plan` + 状态文件，判断是否到点。
2. 到点 → `sessionController.prompt({ sessionId: "myilidepu", cwd: <工作目录>, ... })`，把 `wakePrompt()` 生成的提示词投进会话。
3. 会话里的 agent 按提示词自己 spawn 命令：`bili.mjs candidates` → `read` → `journal add`（学习）→ `personality show`（人格）→ `feed` / `debrief`（看片）→ 分享（评论或私信）→ 写两本日记 → `diary public log`（默认关）→ `notify` → `diary log` 收工。
4. 进入 **8 分钟硬冷却**（`COOLDOWN_MS`），期间不再叫醒；唤醒投递失败会在下一轮重试，成功才进冷却。
5. 插件停止时清掉定时器与监听器（`ctx.effect` 的 disposer）。

## 设置页与 API（① + ②）

- 设置页是 DSH 的 `settings.section`（`lib/client.js` 注册，`order` 见该文件），**手写源码、无构建步骤**；改文案/分组/控件只动 `lib/client.js`。
- 前端调 `lib/index.js` 挂的路由。规范路径 `/dsh-myilidepu/api/*`；旧路径 `/dsh-bili/api/*` 保留为别名（设置页前端、书签、用户脚本可能还用它）。
- 安全边界（改路由时必须保持）：
  - `connection.requestRejection` 信任栅栏，**fail-closed**：服务缺失/抛错 → 503，不静默放行；
  - 只接受本机回环 `Host`（127.0.0.1 / localhost / [::1]），否则 403；
  - 写配置只接受白名单顶层键，且后端再钳一遍范围；
  - 凭据只写不读回，接口只返回「有没有」。
- `GET /dsh-myilidepu/api/settings` 同时返回 `health`（`configStatus()`：`path` / `ok` / `error` / `hadBom` / `migratedFrom`）——这是「改了配置没生效」的排查入口。

## 模型与密钥（v1.1.0）

- **换模型走 DSH 原生服务，插件不发模型请求**：`ctx.sessionController.selectModel({ sessionId, provider, model, reasoningEffort })`。
  - `sessionId` 固定是她自己的会话 `myilidepu` → **只影响她**，不改 profile 的全局默认模型。
  - `ctx.get('sessionController')` 缺失 / 没有 `selectModel` 时：保存配置照常成功，但 `applied=false` + `applyError` 说明原因（降级而不是 500）。
- **模型目录是动态的**：`ctx.get('llm').listProviders()` / `listModels(id)` / `resolveModelInfo(provider, model).reasoning.efforts`。所以设置页的 provider / 模型 / 推理档都是下拉，不是写死枚举；`llm` 缺失时返回 `catalogError`、下拉灰掉。
- **SK 只写不读回**：`ctx.get('credentials').set(ref, value)` / `unset(ref)` / `describe(ref)` → DSH 凭据库（`~/.dsh/.credentials.yaml`）。
  - 插件配置里**只存引用名** `model.apiKeyEnv`（如 `TENCENT_API_KEY`），永不存值；
  - 接口响应只回 `{configured, source}`，不回值；`tests/model.test.mjs` 里有「响应体与配置文件都不能出现密钥」的断言。
- **生效时机**：设置页「保存并应用」→ 立即 `selectModel`；`model.applyOnWake !== false` 时 `lib/scheduler.js` 的 `applyModelOnWake()` 在每轮唤醒前再应用一次（失败只记日志、不阻断整轮）。

## 为什么改不同地方要用不同方式生效

- **①③ 在 DSH 进程里**：DSH 启动时把 bundle 的 `cordis.patch.yml` 组装进配置树、`apply()` 一次。进程内模块不会自己「重新 import」，所以改 `lib/index.js` / `lib/scheduler.js` 必须重启 DSH。
- **② 在浏览器里**：`lib/client.js` 由 DSH 作为客户端插件收集后交给前端模块加载器；改它不涉及 Node 进程，但要等前端重新加载这个 section 才看得到。
- **④ 每次都是新进程**：`tools/bili.mjs` 是 `spawnSync(node, [脚本, ...])` 起子进程，改完脚本下一次命令就是新代码，无需重启。
- **配置是数据不是代码**：`tools/lib/config.mjs` 的 `config()` 有进程内缓存，但 `saveConfig()` 会清缓存，`tools/lib/night-config.mjs` 与 `lib/scheduler.js` 的 `cfgNow()` 每次也先 `resetConfig()` 再读盘——所以保存配置后作息会重排，而不用重启。

## 阅读引擎（humanism 部分）的边界

- **只读**：`lib/reading/` 只做「读原文 → 落账 → 人格札记 → 收件箱导出」，**没有**平台写操作（评论/点赞/投币/发动态的执行器不在这一层）。
- **无 Python、无抽帧/ASR**：v1.0 不移植 humanism 的 `media.py` / 抽帧 / 本地 ASR 与 `writer.mjs`；`lib/reading/index.mjs` 明确不再需要 `pythonPath` 与视觉工具。
- **评论端点保持关闭**：humanism 上游 AGENTS.md 的硬约束继续有效——不新增评论开关/工具/允许的端点，不新增任意转发、任意调度、共享凭据或自动外部安装/排程。
- **见闻额度**：默认 ≤2 条/天（`learning.dailyNotes`，**0 = 不限**——2026-10-25 主人要求取消上限），额度检查与插入在**同一个 SQLite 事务**里（`lib/ledger/journal-policy.mjs`）；时间按 Asia/Shanghai 算。超额返回 `JOURNAL_DAILY_LIMIT`（CLI 退出码 3）；`learning.recordNotes=false` 时返回 `JOURNAL_RECORDING_OFF`（同样退出码 3）。
- **判重**：同一视频/同一目标/同一视频 7 天等判重由 `tools/lib/share-policy.mjs` 与 `tools/commands/quota.mjs` 执行；分享还要求打分 ≥ `share.minScore`、`--reason` ≥8 字、`--rank 1`。
