# dsh-deep-focus

A focus assistant for DeepSeek Harness: it tracks how long the whole machine is actually in use while DSH runs, keeps the default **3-hour daily cap** and **30-minute continuous limit** (with a **10-minute forced rest**), and shows **one conversation at a time** — all inside DSH, without blocking a single tool call.

English | [简体中文](README.zh.md)

## Why

Coding agents make it effortless to spread across five conversations at once. That is great for throughput and terrible for finishing one thing — and easy to turn into a 12-hour day.

`dsh-deep-focus` puts a gentle, honest boundary around that:

- it measures **whole-machine activity while DSH runs**, not just time spent looking at DSH;
- after **30 continuous minutes** it stops the work with a **10-minute rest screen**;
- at **3 hours of daily active use** DSH shows a gray overlay with today's per-app breakdown and a small “Use 20 more minutes” action;
- by default it keeps **one conversation at a time**: while any conversation's agent is running, the other folders and conversations are temporarily hidden until it finishes.

It never blocks a tool call, never interrupts another conversation's agent, and never enforces anything outside DSH. See [Pure-plugin capability boundary](#pure-plugin-capability-boundary) for exactly what that means.

## Features

| Feature | What it does |
| --- | --- |
| **Focus assistant panel** | One sidebar entry under the Plugins row. Overview (today's usage, continuous timer, per-app breakdown, 7-day trend), settings, and an enable/pause switch. |
| **Daily cap (3 h by default)** | When the whole-machine active time spent while DSH runs reaches the limit, DSH shows a gray overlay: today's total, per-app breakdown, “Use 20 more minutes” (configurable minutes and daily count) and a quiet “That's it for today”. |
| **Continuous cap → forced rest** | 30 continuous minutes → a full-screen **10-minute rest** inside DSH. The countdown is visible; rest time is **not** counted toward the daily cap. |
| **Header countdown** | A small chip in the top-right of the DSH window: continuous time remaining, rest time remaining, or “今日已用完” (today's cap used up). |
| **One conversation at a time** | Default on. While a root conversation's agent is running, the sidebar temporarily hides the other folders and conversations, and restores them the moment it finishes. The running agent is never touched. |
| **Per-app usage statistics** | Foreground-application sampling while DSH runs: DeepSeek Harness, browsers, QQ, WeChat, VS Code, terminals, and so on. App name + duration only. |
| **Local and private** | Everything stays in `$DSH_HOME/plugin-data/dsh-deep-focus/`; no network, no telemetry, no accounts. |

There is **no pomodoro timer** in this version — the assistant replaces timer-based work/rest cycles with the usage rules above.

## Screenshots

<!-- screenshots:pending -->

> **Placeholder:** screenshots are not committed yet, so this section intentionally contains no image links (nothing to 404). The capture list (assistant panel, header countdown, daily overlay, forced rest screen) is in [docs/publishing.md](docs/publishing.md#readme-screenshots). They will replace this placeholder before the first public release.

## Install

Requirements:

- DeepSeek Harness **0.2.2-rc.1** (verified; `engines.dsh` also accepts `0.2.0-rc.2` and `0.2.1-rc.2`)
- A desktop DSH installation (the browser half renders in the DSH Web GUI)

**From the DSH desktop app**

1. Open **Plugins** and search for `dsh-deep-focus`.
2. Install it, then enable the bundle. Installing from the Plugins page enables it by default.
3. If the app does not show the plugin immediately, restart DSH once.

**From the CLI**

```bash
dsh plugin --profile desktop add dsh-deep-focus
```

The plugin ships source as-is: there is no build step and no runtime dependency to install. Disabling or uninstalling it removes every UI element immediately, restores the sidebar, and stops all tracking.

## Quick start

1. Open the **Focus assistant** entry in the sidebar, below the Plugins row (`专注助手` in Chinese).
2. Check today's usage and the per-app breakdown; the 7-day trend is on the same page.
3. The default rules are already on: 3 hours per day, 30 continuous minutes → 10-minute rest.
4. Watch the **top-right countdown** in the DSH window: it turns warning-colored as the continuous limit approaches and shows the rest timer when you are resting.
5. Use the switch in the assistant panel to pause enforcement (statistics keep running), and the same page's settings to change any limit.

## Configuration

All runtime settings live in the **Focus assistant** panel. The table below is generated from `src/shared/contract.js` by `node scripts/config-table.mjs`.

<!-- config-table:start -->
| Setting | Default | Unit | Notes |
| --- | ---: | ---: | --- |
| `limits.dailyMinutes` | 180 | min | Daily whole-machine active-time cap while DSH runs; 0 = no daily cap. |
| `limits.continuousMinutes` | 30 | min | Continuous-use cap before the assistant forces a rest; 0 = no forced rest. |
| `limits.restMinutes` | 10 | min | Length of a forced rest. Rest time is not counted toward the daily cap. |
| `limits.extendMinutes` | 20 | min | Extra usage granted by one click on “Use 20 more minutes”. |
| `limits.dailyExtendLimit` | 2 | count | Times per day the daily cap can be extended; 0 = no extensions. |
| `assistant.enabled` | On | — | Track and enforce the rules; off = keep statistics only (nothing enforces). |
| `assistant.soloSession` | On | — | One conversation at a time in the UI while a root conversation is running. |
| `assistant.hideOtherSessions` | On | — | Temporarily hide other folders/conversations while one is running. |
| `assistant.showCountdown` | On | — | Show the countdown chip in the DSH window header. |
| `alerts.sound` | On | — | Play the short chime for rest and completion alerts. |
| `alerts.volume` | 0.6 | 0–1 | Chime volume. |
| `alerts.quietHoursStart` | null | HH:MM | Start of quiet hours (sound suppressed); null = off. |
| `alerts.quietHoursEnd` | null | HH:MM | End of quiet hours; null = off. |
| `alerts.taskDone` | On | — | Toast and chime when an agent task completes. |
| `usage.sampleSeconds` | 5 | s | How often the foreground app and idle time are sampled. |
| `usage.idleThresholdSeconds` | 60 | s | Idle time below this counts as active. |
| `usage.retentionDays` | 30 | days | Days of local usage history kept. |
| `usage.trackApps` | On | — | Record which foreground application is active (app name + duration only; no window titles). |

> Times are minutes unless the unit says otherwise. The defaults are the agreed product rules: a 3-hour daily cap, a forced 10-minute rest after 30 continuous minutes, and 2 × 20-minute extensions per day. The assistant never blocks tools and only enforces inside DSH (see the capability boundary below).
<!-- config-table:end -->

## How the rules work

- **What counts:** time is counted only while keyboard/mouse input was recent (`usage.idleThresholdSeconds`) and only while DSH is running. It is whole-machine time, not DSH-window time.
- **Continuous use** accumulates while you are active. When it reaches `limits.continuousMinutes` (default 30), the assistant **immediately** starts a forced rest of `limits.restMinutes` (default 10): the rest screen appears, active time stops accumulating, and the rest is excluded from the daily total. When the rest ends, the continuous counter starts again from zero.
- **Daily use** accumulates the same activity. When it reaches `limits.dailyMinutes` (default 180), DSH shows the gray daily overlay:
  - **“Use 20 more minutes”** grants `limits.extendMinutes` (default 20) immediately, up to `limits.dailyExtendLimit` times per day (default 2, `0` = no extensions). When the extension expires the overlay returns.
  - **“That's it for today”** only hides the overlay for the current day in this browser. It is a best-effort acknowledgment, not an enforcement mechanism.
- **Day rollover:** counters reset at local midnight.
- **Countdown chip:** top-right of the DSH window — continuous time remaining, rest remaining, or “today's cap used up”. It can be turned off with `assistant.showCountdown`.
- **Pause:** set `assistant.enabled` off (panel switch). Everything keeps being measured, but nothing is enforced — no rest screen, no daily overlay.

## One conversation at a time

- **Default on** (`assistant.soloSession` + `assistant.hideOtherSessions`). While any root conversation's agent is running, other folders and conversations are temporarily **hidden** from the sidebar; a small soft banner explains why.
- The conversation that is running stays fully usable, and other background agents keep running to completion — this is a UI affordance, **not** a lock. No tool call is blocked, no agent is interrupted.
- When nothing is running, the sidebar restores itself automatically. Disabling the plugin or losing contact with the Host restores it immediately as well.

## Focus assistant panel and usage statistics

- **Entry:** sidebar, below the Plugins row — `专注助手` / “Focus assistant”. It opens one page with three parts: overview, settings, and the enable/pause switch.
- **Overview:** today's active time vs. the daily cap, continuous time vs. the continuous cap, rest status, per-app breakdown (top 8, name + mm:ss + bar), and a 7-day trend.
- **Settings:** every limit and toggle from the configuration table above, with units in the labels.
- **Per-app tracking** samples the foreground application every few seconds and stores **only app names and durations** — no window titles, no keystrokes, no URLs. Turn `usage.trackApps` off to keep just the total. Windows foreground-app detection is first-class; macOS and Linux are best effort.

## Pure-plugin capability boundary

This version is **a DSH plugin only**. It cannot do the things a desktop guard could, and the README says so plainly: it **cannot bring DSH to the front**, **cannot block other applications** (a rest does not stop you from using your machine), and **cannot count usage while DSH is closed**. A companion desktop guard that would cover those cases is a possible later phase and is not included.

| Wanted behavior | This version | Why |
| --- | --- | --- |
| Count usage and show the countdown inside DSH | ✅ yes | Runs in the DSH Host and Web GUI |
| Gray DSH-only daily overlay with per-app detail | ✅ yes | Rendered inside DSH |
| Force a rest screen inside DSH | ✅ yes | Rendered inside DSH |
| One conversation at a time (sidebar hiding) | ✅ yes (UI only) | Never blocks tools or agents |
| **Bring DSH to the front** | ❌ no | Needs a desktop window/OS API |
| **Block other applications during rest** | ❌ no | Needs a global always-on-top overlay / input hook |
| **Count or enforce while DSH is closed** | ❌ no | The plugin runs inside the DSH process |
| **Countdown outside the DSH window** | ❌ no | Only drawn inside DSH |

A companion desktop guard (tray app: global foreground sampling, always-on-top rest overlay, bringing DSH forward, counting while DSH is closed) is a **possible later phase and is not included in v0.3**. The current version deliberately trades that global reach for a zero-install, pure-plugin experience.

## Data & privacy

- Everything is local. Data lives in **`$DSH_HOME/plugin-data/dsh-deep-focus/`** (`$DSH_HOME` defaults to `~/.dsh`): `settings.json` (mode `0600`), `limits.json`, and per-day `usage/YYYY-MM-DD.jsonl` files.
- The sampler reads idle time and the **name of the foreground application** (on Windows from the foreground window's process; no title text). It never reads keystrokes, window titles, application contents, screenshots, or the clipboard.
- **No network access, no telemetry, no accounts, no third-party services.**
- Rest time is excluded from the daily total, and history is pruned after `usage.retentionDays` (30 days by default). Delete the data directory to remove everything.

See [docs/privacy.md](docs/privacy.md) for the full detail.

## Known limitations

- Pure plugin: **no global enforcement** — switching to another application is never blocked, and DSH is never brought to the front. See the capability boundary above.
- Usage is sampled **only while DSH runs**; time with DSH closed is not tracked, and the UI cannot show it.
- **Windows is first-class.** macOS and Linux foreground-app detection is implemented but best effort.
- Foreground tracking is per executable: some apps share a process name, and unknown executables appear under their raw name.
- Solo mode hides sidebar entries; it is a visual affordance, not a hard block, and background agents keep working.
- “That's it for today” is a per-day, per-browser acknowledgment stored in the browser; another browser or clearing site data can show the overlay again.
- No cross-device sync and no reports.

## Compatibility

| Item | Status |
| --- | --- |
| DeepSeek Harness | Verified on **0.2.2-rc.1** (Windows). Declared range: `^0.2.0-rc.2 \|\| ^0.2.1-rc.2 \|\| ^0.2.2-rc.1`. |
| Operating systems | Windows tested; macOS/Linux foreground-app sampling best effort. |
| Surface | DSH Web GUI (desktop app). The browser half uses only the documented plugin slots. |
| Node.js (development) | 20 or newer; CI runs 20 and 22. |
| Build step | None. Source is the published artifact. |

## Development

```bash
node --check src/index.js src/client.js   # syntax
npm test                                  # node --test (pure host logic)
node scripts/verify.mjs                   # offline packaging smoke test
```

Repository layout:

```text
src/
├── index.js          # Host entry: config, inject, apply
├── host/             # sampler, per-app tracker, limits/rest state machine, events, API
├── client.js         # self-contained browser half (assistant panel, countdown, overlays, settings)
├── shared/contract.js# wire contract + DEFAULT_SETTINGS (single source of defaults)
├── locale/           # meta.title / meta.description in en + zh
└── icon.svg          # plugin list icon
cordis.patch.yml      # bundle patch that inserts the Host row
scripts/verify.mjs    # offline packaging checks used by CI
docs/                 # design, privacy, publishing
```

No dependency installation is needed to run the checks. See [docs/design.md](docs/design.md) for the architecture and the API contract.

## Publishing

Release steps, npm Trusted Publishing (OIDC, no tokens), the plugin-market listing and the screenshot checklist are documented in [docs/publishing.md](docs/publishing.md).

## License

[MIT](LICENSE) © 2026 dsh-deep-focus contributors.
