# NOTICE · 合并归因、第三方与免责

本项目 **`dsh-myilidepu`**（MyiliDepu「我的 B 站分身」）是**两个上游项目的合并版**：同一份代码里同时包含两个项目的代码，二者均以 **MIT** 许可发布。

| 上游项目 | 仓库 | 原作者 | 许可证 | 在合并版里的角色 |
|---|---|---|---|---|
| `dsh-bili-whale` | [Alterssss/dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale) | ALTERSSSS | **MIT**（全文见 `LICENSE`） | 身体：生物钟 / 看片 / 分享 / 双日记 / 设置页 / 统一 CLI 工具链 |
| `dsh-bili-humanism` | [InariNGT-Ofiicial/dsh-bili-humanism](https://github.com/InariNGT-Ofiicial/dsh-bili-humanism) | InariNGT-Ofiicial | **MIT**（全文见 `LICENSE-humanism.txt`） | 灵魂：读原文 → 理解 → 记见闻 → 长人格（reading / ledger 引擎与提示词） |

合并、改名与新的调度流属于本合并版自己的改动；两个上游的版权声明与许可正文分别原样保留在 `LICENSE` 与 `LICENSE-humanism.txt` 中，均未修改。humanism 那部分的来源与分发范围说明见 `NOTICE-humanism.md`。

## 它依赖 / 参考了这些第三方

| 名称 | 用途 | 许可 / 说明 |
|---|---|---|
| **Bilibili API** | 全部功能都调 B 站公开接口 | 非官方；本项目**不包含** B 站任何代码或数据 |
| **bilibili-API-collect** | 命令实现里的 B 站接口路径与参数含义参考了该项目（社区维护的 B 站接口文档） | 遵循其原项目许可；仅作接口说明用，**未随本项目分发其文档内容**，引用时请以原仓库为准 |
| **ffmpeg** | 抽帧 / 看画面（`tools/lib/ffmpeg.mjs` 只是**定位并调用**它） | **LGPL v2.1+**（若用 GPL 构建则为 GPL）。本项目**不打包** ffmpeg：请自行安装（winget / brew / apt 均可），本仓库不提供 ffmpeg 二进制 |
| **Node.js** | 运行环境（`node:sqlite` 需要 Node 24+） | MIT |

## 免责

- 本项目是**个人自用工具的公开版**：它用**你自己的账号**在 B 站做评论 / 回复 / 发动态等动作，**后果由使用者自负**。
- 不要用于批量刷量、水军、骚扰、绕过风控或任何违反 B 站用户协议的行为。
- 遵循平台规则，撞到风控（验证码 / 限流 / 判刷屏）就该停手，本项目内置了「撞到就停」的护栏，且不会自动重试绕过。
- 本项目与 B 站、DeepSeek 官方均无隶属关系。
