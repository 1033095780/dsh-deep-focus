# dsh-deep-focus

一个给 DeepSeek Harness 用的深度专注插件：**番茄专注时段、一次只对话一个会话、DSH 运行期间的整机活跃统计，以及超时后的全屏锁定——输入本地保存的密码可以再使用 20 分钟。**

[English](README.md) | 简体中文

## 为什么

写代码的 agent 让同时开五个对话变得毫不费力。这对吞吐量是好事，对「把一件事做完」是灾难。`dsh-deep-focus` 是给 vibe coding 工作流准备的自律小工具：

- 开始专注时，DSH 只保留**一个会话**，避免你到处乱飘；
- 统计的是**整台机器是否真的在被使用**，而不只是你盯着 DSH 的时间；
- 超过你自己设定的额度后，应用会**锁定**，直到你休息，或者主动输入密码解锁。

它是专注工具，不是家长控制。你可以关掉、改配置，甚至重启 DSH 绕过它——这是设计的一部分。它真正的作用是让「分心」多一次明确的决定成本。

## 功能

| 功能 | 说明 |
| --- | --- |
| **番茄专注时段** | 专注/休息循环（默认 25/5，每 4 轮长休一次），输入框工具行显示倒计时胶囊，浮层里有开始/暂停/结束面板；时段结束有 toast 和合成的双音提示音。剩余时间按截止时间戳恢复，刷新页面或重启应用都不会重置。 |
| **单会话锁定** | 专注时段或 agent 回合进行时，侧栏中的其它会话会置灰、不可进入，Host 也拒绝它们的工具调用。属于被锁会话的子代理与 Agent Teams 成员照常工作。 |
| **整机活跃统计** | 每隔几秒读取系统空闲时间（Windows 用 `GetLastInputInfo`，macOS 用 `HIDIdleTime`，Linux 用 X11/DBus），只有在最近有键鼠输入时才计入活跃。设置页显示今日活跃、连续工作时长和最近 7 天柱状图。 |
| **超时锁定 + 密码解锁** | 今日活跃、连续工作或单次专注超过上限时锁定应用。输入解锁密码可以再使用 20 分钟。严格模式只允许强制休息，还可以限制每日解锁次数。 |

所有功能都可配置；界面跟随 DSH 主题（明/暗）与语言（中文/英文），常驻元素只有输入框工具行上的一个胶囊。

## 截图

<!-- screenshots:pending -->

> **占位说明：** 截图尚未提交到仓库，因此本节故意不放任何图片链接（避免出现 404）。需要拍摄的完整清单（明/暗主题下的胶囊、浮层面板、锁定遮罩、设置与统计页）见 [docs/publishing.md](docs/publishing.md#readme-screenshots)。首次公开发布前会用真实截图替换本占位。

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

插件直接发布源码：没有构建步骤，也没有需要安装的运行时依赖。

## 快速开始

1. 点击输入框工具行上的**专注胶囊**（空闲时是播放图标和「专注」）。
2. 填写当前要做的**唯一任务**，选一个预设（15 / 25 / 50 分钟），开始。胶囊会变成倒计时。
3. 打开 **设置 → 深度专注**，先设置一个**解锁密码**，再依赖锁定功能。
4. 在 **设置 → 深度专注** 查看今日活跃时长、连续工作时长和最近 7 天趋势。
5. 被锁定时输入解锁密码可再使用 20 分钟，或者直接去休息。

## 配置

所有运行期设置都在 **设置 → 深度专注** 中。下表由 `node scripts/config-table.mjs` 从 `src/shared/contract.js` 生成；Host 会把每个值收敛到安全范围内。

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
| `limits.dailyActiveMinutes` | 480 | 分钟 | 每日活跃时长上限；0 = 不限。 |
| `limits.continuousWorkMinutes` | 90 | 分钟 | 连续工作时长上限；0 = 不限。 |
| `limits.sessionMinutes` | 90 | 分钟 | 单次专注时长上限；0 = 不限。 |
| `limits.unlockMinutes` | 20 | 分钟 | 输入一次密码解锁后增加的可用时长。 |
| `limits.dailyUnlockLimit` | 0 | 次 | 每日密码解锁次数；0 = 不限。 |
| `limits.strictNoUnlock` | 关 | — | 隐藏密码输入框：锁定后只能通过强制休息解除。 |
| `lock.singleConversation` | 开 | — | 专注时段或 agent 回合进行时，只保留一个会话。 |
| `lock.blockToolsOutsideFocus` | 开 | — | Host 拒绝其它会话的工具调用。 |
| `lock.lockSidebarOutsideFocus` | 开 | — | 尽力而为：置灰并拦截侧栏中的其它会话。 |
| `lock.exemptSubagents` | 开 | — | 对 Agent Teams 成员豁免会话锁（子代理等非根 agent 始终豁免）。 |
| `alerts.taskDone` | 开 | — | 专注时段完成时显示 toast 并播放提示音。 |
| `alerts.turnDone` | 关 | — | 每个 agent 回合结束时额外提示一次。 |
| `alerts.sound` | 开 | — | 播放合成的完成提示音。 |
| `alerts.volume` | 0.6 | 0–1 | 提示音音量。 |
| `alerts.quietHoursStart` | null | HH:MM | 静音时段的开始时间（该时段内不播放提示音）；null = 关闭。 |
| `alerts.quietHoursEnd` | null | HH:MM | 静音时段的结束时间；null = 关闭。 |
| `usage.sampleSeconds` | 5 | 秒 | 空闲采样的读取间隔。 |
| `usage.idleThresholdSeconds` | 60 | 秒 | 空闲时长低于此值算作活跃。 |
| `usage.retentionDays` | 30 | 天 | 本地使用记录保留天数。 |
| `usage.detectMedia` | 关 | — | 媒体播放豁免，为后续版本预留；0.1.0 中不生效。 |

> `security.*` 由插件内部管理（解锁密码的加盐 scrypt 哈希），设置接口永远不会返回。未特别注明时时间单位为分钟；`0` 表示关闭该限制。
<!-- config-table:end -->

## 锁定是怎么工作的

- **硬防线：** 会话被锁定时，Host 拒绝其它会话发起的工具调用；该 agent 会看到明确的拒绝原因，而不是请求被静默丢弃。
- **尽力而为：** 侧栏会把非锁主会话置灰并拦截点击，应用自己的「打开会话」入口在锁定期间也会被包装拦截。这部分依赖 DSH 的 DOM 细节，不是安全边界。
- **锁主是谁：** 专注时段会绑定你开始专注的那个会话；没有专注时段时，正在运行 agent 的会话就是锁主（「只看正在跑的那个」）。
- **豁免：** 子代理与 workflow 子级始终不会被拦（它们是为根会话做的工作）；开启 `lock.exemptSubagents` 时 Agent Teams 成员也豁免。如果绑定的专注会话已经没有存活的 agent，会话锁会停止拦截，直到你结束或休息。
- **锁主消失：** 绑定的会话被销毁时会自动结束它的专注时段，避免残留锁冻结其它会话。
- **解锁：** 密码由 Host 对照加盐 scrypt 哈希校验。解锁成功后增加 `limits.unlockMinutes`（默认 20 分钟）。`limits.strictNoUnlock` 会隐藏密码框，只提供强制休息。

锁定是摩擦，不是安全防线：它用来打断自动化惯性，不是用来对抗攻击者。重启 DSH 或修改数据目录都能绕过。

## 数据与隐私

- 完全本地。数据位于 **`$DSH_HOME/plugin-data/dsh-deep-focus/`**（`$DSH_HOME` 默认是 `~/.dsh`）：`settings.json`（权限 `0600`）、`focus.json`、`budget.json`，以及按天的 `usage/YYYY-MM-DD.jsonl`、`stats/YYYY-MM-DD.jsonl`。
- 采样器只读取**整机空闲了多久**。它不会读取按键内容、窗口标题、应用名、截图或剪贴板。
- **不联网、无遥测、无账号、无第三方服务。**
- 活跃记录按 `usage.retentionDays`（默认 30 天）清理。删除数据目录即可清除全部数据。

完整说明见 [docs/privacy.md](docs/privacy.md)。

## 已知限制

- **只在 DSH 运行期间采样**；DSH 关闭时的时长不统计，界面会明确标注为未统计。常驻后台守护进程不在 0.1.0 范围内。
- **Windows 是首选平台。** macOS 与 Linux 的采样已实现，但属于尽力而为，本次发布未实测。
- 侧栏锁定是尽力而为（DOM 拦截）。真正的边界是 Host 侧的工具守卫。
- 密码解锁是**摩擦，不是安全边界**。重启 DSH 即可绕过锁定。
- 看视频等无输入的媒体播放会被判为空闲（`usage.detectMedia` 为后续版本预留，0.1.0 中不生效）。
- 不能替代屏幕时间工具：没有跨设备同步、没有报告、没有按应用拆分。

## 兼容性

| 项目 | 状态 |
| --- | --- |
| DeepSeek Harness | 在 **0.2.2-rc.1**（Windows）实测通过；声明范围 `^0.2.0-rc.2 \|\| ^0.2.1-rc.2 \|\| ^0.2.2-rc.1`。 |
| 操作系统 | Windows 已实测；macOS/Linux 采样已实现，尽力而为。 |
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
├── host/             # 采样、统计、专注状态机、额度、工具守卫、事件、API
├── client.js         # 自包含的浏览器端（槽位、面板、遮罩、设置页）
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
