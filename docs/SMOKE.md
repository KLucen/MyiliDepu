# 真机冒烟清单（SMOKE）

一句话：**单测全绿不等于能用。** 这份清单是「装完之后，用真账号、真接口，只读地走一遍」的最小验证。
跑完它大概 3～5 分钟，全部只读 —— 不会发评论、不会发动态、不会发私信。

> 为什么需要单独一份：`node --test "tests/*.test.mjs"` 的 134 个用例跑在临时目录里，用的是假 cookie、
> 模拟网络、假宿主。它证明的是**逻辑自洽**，不是**接口能通**。B 站接口是非官方的，WBI 签名、
> HTTP 412 风控、`-352 / -799 / -509` 这些码都真实遇到过 —— 所以「测试全绿而真机第一条就红」是完全可能的。

---

## 0 先确认插件是活的（不联网）

```bash
cd <插件源码目录>            # 本机：C:\Users\KLucen\Desktop\肥鱼嘟嘟可\MyiliDepu
node tools/bili.mjs deps
node tools/bili.mjs selftest
```

| 命令 | 看什么 | 不合格的样子 |
|---|---|---|
| `deps` | cookie / node 运行时 / 两处目录 / 限流 | 出现 `✗` 且**没有**「可选」字样 —— 那是必需项挂了，退出码 3 |
| `selftest` | 配置 / 身份 / 凭据 / 登录态 / 目录 / 本子 / deps | 出现 `✗`，或结尾不是「全部通过 ✓」 |

两条都绿，再往下走。**这一段不需要 DSH 在跑，也不需要重启任何东西**（`tools/` 是每次调用现起进程）。

### 两个容易误判的点

- `deps` 里 `! ffmpeg（可选：抽帧看画面）` 是**正常的**，不是故障。没有 ffmpeg 只是看不了画面帧，
  字幕 / 官方总结 / 热评 / 弹幕全都不受影响。
- `deps` 里 `node 运行时（可选：现在用桌面版主程序顶着）` 表示没找到真 node，只能拿 Electron 当 node 用：
  **能用，但每次调用都启一个 Electron，更慢更吃内存**。想修就装个真 Node 或设 `DSH_NODE`，然后重启 DSH。

---

## 1 真机十二问（只读，真账号真接口）

```bash
node tools/bili.mjs selftest --real
```

它会依次问 12 个问题，**全部只读**：

| # | 问什么 | 真的在验 |
|---|---|---|
| 1 | 凭据能用吗 | 真的拿 cookie 问了一次 B 站（不是只看文件在不在） |
| 2 | 推荐流出得来吗 | WBI 签名这条路通不通 |
| 3 | 学习候选挑得到片子吗 | 学习链路的入口 |
| 4 | 能真的读到原文吗 | `read <BV> --route auto`（字幕 / 官方总结哪条能用） |
| 5 | 见闻账本读得出来吗 | `journal show` |
| 6 | 人格札记读得出来吗 | `personality show` |
| 7 | 私人日记读得出来吗 | `diary private show` |
| 8 | 公开日记留痕读得出来吗 | `diary public show` |
| 9 | 额度账本能读吗 | `quota status` |
| 10 | 生物钟状态能读吗 | `night status` |
| 11 | 数据目录可写吗 | 真建真删一个探针文件 |
| 12 | 配置文件体检 | 有没有语法错 / BOM / 还在读旧位置 |

第 2 步没拿到 BV 时，第 4 步会显示「跳过」——那是跳过，不是通过。

**退出码**：全绿 0；有 `✗` 为 1。`!`（警告）不影响退出码。

### 单条复现

十二问里的每一条都能单独重跑，出问题时用这个缩小范围：

```bash
node tools/bili.mjs session
node tools/bili.mjs feed --n 2
node tools/bili.mjs candidates --count 1
node tools/bili.mjs read BV1xxxxxxxxx --route auto
node tools/bili.mjs journal show
node tools/bili.mjs personality show
node tools/bili.mjs diary private show
node tools/bili.mjs diary public show
node tools/bili.mjs quota status
node tools/bili.mjs night status
```

---

## 2 一轮完整醒来（端到端）

单条命令通，不代表**她一轮能跑完**。这一段验的是调度。

1. 打开设置页 →「生物钟」→ 把窗口改成**现在之后 2 分钟**，`wakes` 给 1。
2. 等她自己醒（也可以点设置页的「立刻醒一次」，如果当前版本提供）。
3. 醒来后看三处：

| 看什么 | 在哪 | 正常的迹象 |
|---|---|---|
| 这一轮的记录 | `<数据目录>\log.jsonl`（本机 `D:\MyDepu\log.jsonl`） | 新增一行，含本轮做了什么 |
| 生物钟状态 | `<数据目录>\night.json` | `lastWakeAt` 更新成刚才 |
| 她的工作区 | 左侧「工作区」→ 她的会话（`myilidepu`） | 会话里有新的一轮对话 |

本机数据目录是 `D:\MyDepu`（默认是 `<DSH_HOME>\myilidepu`）。想确认当前用的是哪个：

```bash
node tools/bili.mjs deps | findstr 数据目录
```

**这一轮失败最常见的原因不是插件，是权限**：她的会话默认没有完全权限，起来后跑不了命令。
打开那个会话 → 权限设置 → 选「完全访问 / danger-full-access」。

---

## 3 写操作冒烟（会真的发出去，先预演）

⚠️ **这一段和上面不一样：写操作有真实后果，而且有硬额度。** 不要为了测试连发几条。

规矩是代码强制的，不是靠自觉：

```bash
node tools/bili.mjs quota status                                  # 今天用了多少 / 上限 / 剩余
node tools/bili.mjs quota check --type comment --target BV1xxxx   # 超限或不在白名单 → 退出码 2
```

**任何写命令都必须显式带 `--dry` 或 `--go`**，两个都不带会被直接拒绝（这是故意的，防手滑）。
所以正确姿势永远是：**先 `--dry` 看预演，确认无误再 `--go`**。

以分享型评论为例：

```bash
# 1) 先预演：不发出任何东西，只打印将要发的内容
node tools/bili.mjs comment --oid <aid> --bvid BV1xxxxxxxxx \
  --message "（正文，分享型必须 @ 主人）" \
  --share --auto --reason "至少八个字的理由" --score 15 --rank 1 --dry

# 2) 人工看一眼输出，确认正文/目标/额度都对，再真发
node tools/bili.mjs comment --oid <aid> --bvid BV1xxxxxxxxx \
  --message "（同上）" \
  --share --auto --reason "至少八个字的理由" --score 15 --rank 1 --go
```

其他写命令（动态、私信、点赞、收藏、弹幕……）同理，一律先 `--dry`。命令全集与各自参数：

```bash
node tools/bili.mjs help
```

### 发布前的硬约束（改代码前先读一遍）

- 一天最多分享 3 条（`quota.shareDaily`，可在设置页改）
- 同一个视频 30 天内只分享一次
- 分享型正文必须 `@` 主人，`--reason` 至少八个字，`--score` 0～20，`--rank 1`
- 额度账本在 `~/.bili-ai/quota.json`；读不出来时是 **fail-closed**（当成「今天已经发过了」），不会放行

---

## 4 卡住了怎么报

带上这四样，基本能一次定位：

| 证据 | 位置 / 命令 |
|---|---|
| 装配体检 | `node tools/bili.mjs deps` 的完整输出 |
| 真机结果 | `node tools/bili.mjs selftest --real` 的完整输出 |
| 接口层 | `~/.bili-ai/api-requests.log`（每次 B 站请求；限流/412 看这里） |
| 调度层 | `<数据目录>\log.jsonl` 的最后几行 |

限流（HTTP 412 / `-352`）不是坏了：内置退避是 5 → 10 → 20 分钟，期间只读缓存。
想知道还要等多久：

```bash
node tools/bili.mjs deps | findstr 限流
```

`~/.bili-ai/api-cache.json` 里还留着最近抓到的元信息，能撑一阵。

---

## 5 不要做的事

- **别拿主账号刷写操作来"测一下"** —— 有额度、有风控，测试请用 `--dry`。
- **别把 `credentials.json` / cookie / `bili_jct` 贴到任何地方**（issue、聊天、截图），
  那是账号的钥匙。报问题时只需要给上面第 4 节那四样。
- **别在生产 profile 上试危险命令** —— 想折腾就新建一个一次性 profile 装 `link:` 试。
- **别把「单测 134 全绿」当成发布依据** —— 那份清单只覆盖逻辑，不覆盖真机。发布前跑完本文件第 1 节。

---

## 附：这份清单的边界（诚实说明）

- 第 1 节「真机十二问」覆盖的是**只读链路**。写链路（评论/动态/私信真的发出去）**不在自动冒烟范围内**，
  因为无法在无人值守的情况下安全验证 —— 它只能由人在 `--dry` 之后人工确认。
- 「她一轮能跑完」依赖 DSH 宿主（会话 + Web 服务 + 权限），这三样不在插件控制内。
  headless（纯命令行）模式下插件**不会激活**，DSH 会打印
  `dsh-myilidepu: pending (waiting for services: sessionController, webServer, connection)` ——
  这是预期行为，不是装坏了；但那种模式下本文件第 2 节无法执行。
- 抽帧看画面需要 ffmpeg，本地 ASR 需要额外 Python 依赖；两者都是可选，缺失时对应能力静默降级为
  「字幕 / 官方总结」。第 1 节不会因此判红。
