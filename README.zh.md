# dsh-deep-focus

一个给 DeepSeek Harness 用的温柔专注插件：**番茄专注、侧栏「一次只聊一个会话」的提醒、按软件统计使用时长，以及可选的一次点击就能续 20 分钟的超时提醒。**

[English](README.md) | 简体中文

## 为什么

写代码的 agent 让同时开五个对话变得毫不费力。这对吞吐量是好事，对「把一件事做完」是灾难。

`dsh-deep-focus` 是**自律工具，不是门卫**。它绝不拦截工具调用、绝不拒绝其它会话的 agent、绝不把你的活抢走。它只做四件小事：

- 用**番茄节奏**提醒你何时该停；
- 专注进行中把**其它会话置灰**，点了只给一条温柔提示；
- 告诉你**时间实际花在哪**——按前台软件统计今日和近 7 天的时长；
- 只有你自己设置了限额时，才提供**可选的超时提醒**——点一下「再使用 20 分钟」即可继续，没有密码。

禁用插件后，所有界面立刻消失，侧栏立即恢复正常。

## 功能

| 功能 | 说明 |
| --- | --- |
| **番茄专注时段** | 专注/休息循环（默认 25/5，每 4 轮长休一次），输入框工具行显示倒计时胶囊，浮层里有开始/暂停/完成面板，结束有 toast 和合成的双音提示音。剩余时间按截止时间戳恢复，刷新页面或重启应用都不会重置。 |
| **温柔专注模式** | 时段进行中，侧栏里的其它会话置灰；点击只会显示「当前任务完成后再切换吧」，不会切换会话。当前会话始终可以正常使用。 |
| **按软件使用统计** | 采样前台应用，只记录应用名与时长：DeepSeek Harness、浏览器、QQ、微信、VS Code、终端等。侧栏「插件」下方新增**使用统计**入口：今日总时长、各软件排行、近 7 天趋势。 |
| **可选超时提醒** | 限额**默认全部关闭**（`0` = 不限）。如果你自己开启并超出，出现全屏温柔遮罩，可点「再使用 20 分钟」（一键，无密码）或「休息一下」。 |
| **本地、安静** | 全部本地运行——不联网、无遥测。提示音与静音时段可配置。 |

常驻元素只有输入框工具行上的一个胶囊，其它内容按需出现。

## 截图

<!-- screenshots:pending -->

> **占位说明：** 截图尚未提交到仓库，因此本节故意不放任何图片链接（避免出现 404）。需要拍摄的清单（专注胶囊、置灰侧栏的专注模式、使用统计面板、超时遮罩）见 [docs/publishing.md](docs/publishing.md#readme-screenshots)。首次公开发布前会用真实截图替换本占位。

## 安装

环境要求：

- DeepSeek Harness **0.2.2-rc.1**（已实测；`engines.dsh` 同时接受 `0.2.0-rc.2` 与 `0.2.1-rc.2`）
- 桌面版 DSH（浏览器端 UI 运行在 DSH Web GUI 中）

**在 DSH 桌面应用里安装**

1. 打开 **插件** 页，搜索 `dsh-deep-focus`。
2. 安装并启用该组合包；从插件页安装默认就是启用状态。
3. 如果界面没有立刻出现插件，重启一次 DSH。

**用命令行安装**

```bash
dsh plugin --profile desktop add dsh-deep-focus
```

插件直接发布源码：没有构建步骤，也没有需要安装的运行时依赖。禁用或卸载插件会立刻移除所有界面元素并恢复侧栏。

## 快速开始

1. 点击输入框工具行上的**专注胶囊**（空闲时是播放图标和「专注」）。
2. 填写当前要做的**唯一任务**，选一个预设（15 / 25 / 50 分钟），开始。其它会话会置灰；点击只会收到一条提示。
3. 打开侧栏「插件」下方的**使用统计**，查看今日各软件时长与近 7 天趋势。
4. 可选：在 **设置 → 深度专注** 里开启每日 / 连续 / 单次时长限额，才会出现超时提醒。
5. 时段结束会有 toast 和提示音。任何东西都不会被拦截——只有你开启了限额，才会出现类似锁定的遮罩。

## 配置

所有运行期设置都在 **设置 → 深度专注** 中。下表由 `node scripts/config-table.mjs` 从 `src/shared/contract.js` 生成。

<!-- config-table:start -->
| 配置项 | 默认值 | 单位 | 说明 |
| --- | ---: | ---: | --- |
| `focus.workMinutes` | 25 | 分钟 | 单个专注时段的长度。 |
| `focus.breakMinutes` | 5 | 分钟 | 每个专注时段后的短休息。 |
| `focus.longBreakMinutes` | 15 | 分钟 | 每 `focus.longBreakEvery` 轮专注后的长休息。 |
| `focus.longBreakEvery` | 4 | 轮 | 长休息之间的专注轮数；0 = 关闭长休息。 |
| `focus.autoStartBreak` | 开 | — | 专注时段结束后自动开始休息。 |
| `focus.autoStartNext` | 关 | — | 休息结束后自动开始下一轮专注。 |
| `focus.idlePauseSeconds` | 120 | 秒 | 无操作达到此时长后暂停计时；0 = 关闭自动暂停。 |
| `focus.autoResumeOnReturn` | 开 | — | 回到电脑后自动继续已暂停的时段。 |
| `focus.grayOutOtherSessions` | 开 | — | 专注期间把侧栏里的其它会话置灰；点击只会显示一条温柔提示，不会切换会话。绝不拦截 agent 或工具调用。 |
| `limits.dailyActiveMinutes` | 0 | 分钟 | 触发超时遮罩的每日活跃时长上限；0 = 关闭（不限）。 |
| `limits.continuousWorkMinutes` | 0 | 分钟 | 触发超时遮罩的连续工作时长上限；0 = 关闭（不限）。 |
| `limits.sessionMinutes` | 0 | 分钟 | 单个专注时段的时长上限；0 = 关闭（不限）。 |
| `limits.unlockMinutes` | 20 | 分钟 | 点击一次「再使用 20 分钟」增加的时长。 |
| `alerts.taskDone` | 开 | — | 专注时段完成时显示 toast 并播放提示音。 |
| `alerts.turnDone` | 关 | — | 每个 agent 回合结束时额外提示一次。 |
| `alerts.sound` | 开 | — | 播放合成的完成提示音。 |
| `alerts.volume` | 0.6 | 0–1 | 提示音音量。 |
| `alerts.quietHoursStart` | null | HH:MM | 静音时段的开始时间（该时段内不播放提示音）；null = 关闭。 |
| `alerts.quietHoursEnd` | null | HH:MM | 静音时段的结束时间；null = 关闭。 |
| `usage.sampleSeconds` | 5 | 秒 | 前台应用与空闲时长的采样间隔。 |
| `usage.idleThresholdSeconds` | 60 | 秒 | 空闲时长低于此值算作活跃。 |
| `usage.retentionDays` | 30 | 天 | 本地使用记录保留天数。 |
| `usage.trackApps` | 开 | — | 记录前台应用（只存应用名与时长，不记录窗口标题）。 |

> 未特别注明时时间单位为分钟。`0` 表示关闭该限制：三个超时上限默认都是 `0`，因此刚安装时不会出现超时遮罩。插件绝不拦截工具调用或其它会话——专注模式只在侧栏做视觉引导。
<!-- config-table:end -->

## 专注模式是怎么工作的

- **纯 UI 引导。** Host 不注册任何工具守卫，不拒绝任何工具调用，也无权干涉其它会话。专注期间其它 agent 照常工作。
- **侧栏提示：** 时段进行中且 `focus.grayOutOtherSessions` 开启时，除当前专注会话外的会话行会置灰；点击（或键盘激活）这些行不会切换，只弹一条温柔 toast。当前会话自己的行保持正常可用。
- **计时是诚实的：** 截止时间戳跨页面刷新、跨应用重启有效；空闲自动暂停（`focus.idlePauseSeconds`）与回到电脑自动继续均可配置。
- **能干净地消失：** 禁用插件、Host 不可达或重启时，所有界面都会隐藏，并移除插件加过的全部内联样式——不会残留置灰，也不会吞掉点击。

## 使用统计

- Host 每隔几秒采样**前台应用**（`usage.sampleSeconds`），且只有在最近有键鼠输入时才计时（`usage.idleThresholdSeconds`）。
- 常见应用有友好名称（DeepSeek Harness、浏览器、QQ、微信、VS Code、终端等）；未知可执行文件按基础名记录。稳定键是小写可执行文件名。
- **只记录应用名与时长**——不记录窗口标题、按键内容、剪贴板或 URL。
- Windows 的前台应用识别是一等公民；macOS/Linux 为尽力而为（识别不到时继续统计空闲总时长，并把应用采样标记为 off）。
- 关闭 `usage.trackApps` 可只统计总活跃时长。记录按 `usage.retentionDays`（默认 30 天）清理。

## 超时提醒（默认关闭）

- 限额默认都是 `0`（不限）：**刚安装时永远不会出现遮罩**。
- 如果你自行开启 `limits.dailyActiveMinutes`、`limits.continuousWorkMinutes` 或 `limits.sessionMinutes` 并超出，会出现全屏柔和遮罩，显示今日用量与两个操作：**「再使用 20 分钟」**（增加 `limits.unlockMinutes`，默认 20 分钟）和 **「休息一下」**（解除锁定并清零连续工作时长）。
- 没有密码、没有算术题、也不强制：遮罩只是一次 deliberate 的缓冲。重启 DSH 或禁用插件随时可以退出。

## 数据与隐私

- 完全本地。数据位于 **`$DSH_HOME/plugin-data/dsh-deep-focus/`**（`$DSH_HOME` 默认是 `~/.dsh`）：`settings.json`（权限 `0600`）、`focus.json`、`budget.json`，以及按天的 `usage/YYYY-MM-DD.jsonl`、`stats/YYYY-MM-DD.jsonl`。
- 采样器读取空闲时长与**前台应用名称**（Windows 上取前台窗口所属进程；不读取标题文本）。它不会读取按键内容、窗口标题、应用内容、截图或剪贴板。
- **不联网、无遥测、无账号、无第三方服务。**
- 使用记录按 `usage.retentionDays`（默认 30 天）清理。删除数据目录即可清除全部数据。

完整说明见 [docs/privacy.md](docs/privacy.md)。

## 已知限制

- **只在 DSH 运行期间采样**；DSH 关闭时的时长不统计，界面会明确标注为未统计。
- **Windows 是首选平台。** macOS/Linux 的前台应用识别已实现，但属于尽力而为。
- 前台统计按可执行文件粒度：一些应用共享进程名（如多个 Electron 应用），未知程序会以原始名称出现。
- 专注模式是**纯 UI 引导**，刻意不做硬拦截。你仍可以通过其它方式切换会话，后台 agent 也照常运行。
- 超时遮罩是提醒，不是强制；不开启限额就不会出现。
- 没有跨设备同步、没有报告、没有按网站拆分。

## 兼容性

| 项目 | 状态 |
| --- | --- |
| DeepSeek Harness | 在 **0.2.2-rc.1**（Windows）实测通过；声明范围 `^0.2.0-rc.2 \|\| ^0.2.1-rc.2 \|\| ^0.2.2-rc.1`。 |
| 操作系统 | Windows 已实测；macOS/Linux 前台应用采样尽力而为。 |
| 运行界面 | DSH Web GUI（桌面应用）。浏览器端只使用公开的插件槽位。 |
| Node.js（开发） | 20 及以上；CI 跑 20 与 22。 |
| 构建步骤 | 没有。发布产物就是源码。 |

## 开发

```bash
node --check src/index.js src/client.js   # 语法检查
npm test                                  # node --test（Host 纯逻辑单测）
node scripts/verify.mjs                   # 离线打包冒烟检查
```

仓库结构：

```text
src/
├── index.js          # Host 入口：Config / inject / apply
├── host/             # 采样、按应用统计、专注状态机、额度、事件、API
├── client.js         # 自包含的浏览器端（胶囊、面板、遮罩、设置页、使用统计面板）
├── shared/contract.js# 通信契约 + DEFAULT_SETTINGS（默认值唯一来源）
├── locale/           # 中英文 meta.title / meta.description
└── icon.svg          # 插件列表图标
cordis.patch.yml      # 插入 Host 行的组合包 patch
scripts/verify.mjs    # CI 使用的离线打包检查
docs/                 # 设计、隐私、发布文档
```

运行这些检查不需要安装依赖。架构与 API 契约见 [docs/design.md](docs/design.md)。

## 发布

发布流程、npm Trusted Publishing（OIDC，仓库中不保存 token）、插件市场收录与截图清单见 [docs/publishing.md](docs/publishing.md)。

## 许可证

[MIT](LICENSE) © 2026 dsh-deep-focus contributors。
