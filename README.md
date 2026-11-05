# dsh-deep-focus

A focus assistant for DeepSeek Harness: a **display-only floating two-ring widget** shows how much of your daily 3-hour cap and 30-minute continuous limit you have used, a **60-second idle break** grays the DSH window until you come back to the keyboard, and when you drift away a **chime repeats until you return** — all inside DSH, without blocking a single tool call.

English | [简体中文](README.zh.md)

## Why

Coding agents make it effortless to spread across five conversations at once. That is great for throughput and terrible for finishing one thing — and easy to turn into a 12-hour day.

`dsh-deep-focus` puts a gentle, honest boundary around that:

- **two rings, always visible** in the top-right corner: today's whole-machine usage vs. the daily cap, and continuous use vs. the continuous cap. They just show progress — there is nothing to click;
- stop touching the keyboard/mouse for **60 seconds** and the assistant enters a gray rest/pause state automatically; moving or typing brings you straight back;
- after **30 continuous minutes** it stops the work with a **10-minute rest**; the rest only ends when the time is up **and** you are back — or you press 「跳过休息」;
- at **3 hours of daily active use** DSH shows a gray overlay with today's per-app breakdown, a “Use 20 more minutes” action and a **Skip** button;
- by default it keeps **one conversation at a time**: while any conversation's agent is running, the other conversations and workspace folders are grayed out and cannot be clicked — a gentle reminder appears instead — while the current conversation stays normal.

It never blocks a tool call, never interrupts another conversation's agent, and never enforces anything outside DSH. See [Pure-plugin capability boundary](#pure-plugin-capability-boundary) for exactly what that means.

## Features

| Feature | What it does |
| --- | --- |
| **Floating two-ring widget** | Top-right of the DSH window: a compact glass card with one ring for today's usage and one for the continuous timer, plus a small label. **Display-only** — it shows progress and is not clickable. |
| **Automatic rest on idle** | After `usage.autoPauseSeconds` (default 60 s, `0` = off) without keyboard/mouse input the assistant automatically enters a gray rest/pause state; moving the mouse or typing resumes it. There is no manual click-to-pause. |
| **Daily cap (3 h by default)** | Gray overlay built on the shared today-usage card, with two actions: 「再使用 20 分钟」 / “Use 20 more minutes” (configurable minutes; unlimited by default) and 「跳过」 / “Skip” (only dismisses today's reminder, without extending). |
| **Continuous cap → forced rest** | 30 continuous minutes → a full-screen **10-minute rest** that reuses the same today-usage card. It finishes only when the rest time elapsed **and** you are back; while away it waits. 「跳过休息」 / “Skip rest” ends it immediately. Rest time is not counted toward the daily cap. |
| **Shared today-usage card** | Both the forced-rest screen and the daily-limit screen render one card: title/reason, today's total, per-app breakdown, and the screen's action buttons. |
| **Completion chime only when away** | No chime while you are actively watching. If the window is unfocused/hidden or the machine has been idle for `alerts.awayIdleSeconds`, the chime repeats every `alerts.repeatIntervalMs` until input returns. |
| **One conversation at a time** | Default on. While a root conversation's agent is running, the UI **jumps back to that conversation**, and the other conversations **and workspace folders** are grayed out and cannot be clicked (a gentle reminder appears). If a non-owner conversation is somehow visible, its content is veiled and sending is discouraged until the run finishes. Nothing is hidden; the running agent is never touched. No banner text. |
| **Focus assistant panel** | One sidebar entry under the Plugins row: overview (today, continuous timer, rest/pause status, per-app breakdown, 7-day trend), settings, and the enable/pause switch. |
| **Per-app usage statistics** | Foreground-application sampling while DSH runs: DeepSeek Harness, browsers, QQ, WeChat, VS Code, terminals, and so on. App name + duration only. |
| **Local and private** | Everything stays in `$DSH_HOME/plugin-data/dsh-deep-focus/`; no network, no telemetry, no accounts. |

There is **no pomodoro timer** in this version — the assistant replaces timer-based work/rest cycles with the usage rules above.

## Screenshots

<!-- screenshots:pending -->

> **Placeholder:** screenshots are not committed yet, so this section intentionally contains no image links (nothing to 404). The capture list (display-only rings, shared today-usage card on the rest and daily screens, gray automatic-rest state) is in [docs/publishing.md](docs/publishing.md#readme-screenshots). They will replace this placeholder before the first public release.

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
2. Watch the **floating two-ring widget** in the top-right corner of the DSH window; it shows today's usage and the continuous timer.
3. Leave the keyboard/mouse alone for `usage.autoPauseSeconds` (default 60 s) and the assistant enters the gray rest state automatically; moving or typing resumes it. The rings stay display-only.
4. When the continuous limit is reached, the rest screen appears — it shows the same today-usage card as the daily screen and waits until the rest time is over **and** you are back, or press 「跳过休息」.
5. At the daily cap the gray overlay offers only two actions: 「再使用 20 分钟」 and 「跳过」. Use the assistant panel's switch to pause enforcement entirely, and its short settings form to change the common limits.

## Configuration

The **Focus assistant** page intentionally exposes only seven common settings:

| In the assistant page | What it controls |
| --- | --- |
| Daily usage limit | `limits.dailyMinutes` (minutes, `0` = unlimited) |
| Continuous-use limit | `limits.continuousMinutes` (minutes, `0` = off) |
| Rest length | `limits.restMinutes` (minutes) |
| Extension length | `limits.extendMinutes` (minutes) |
| Auto-rest after idle | `usage.autoPauseSeconds` (seconds, `0` = off) |
| Sound | `alerts.sound` (on/off) |
| App tracking | `usage.trackApps` (on/off) |

Everything else — the extension count cap, quiet hours, the away/repeat chime settings, sampling intervals, retention, ring/solo toggles and the like — **stays in the settings JSON and the plugin API but is not shown in the UI**. The table below is the complete reference, generated from `src/shared/contract.js` by `node scripts/config-table.mjs`.

<!-- config-table:start -->
| Setting | Default | Unit | Notes |
| --- | ---: | ---: | --- |
| `limits.dailyMinutes` | 180 | min | Daily whole-machine active-time cap while DSH runs; 0 = no daily cap. |
| `limits.continuousMinutes` | 30 | min | Continuous-use cap before the assistant forces a rest; 0 = no forced rest. |
| `limits.restMinutes` | 10 | min | Length of a forced rest. Rest time is not counted toward the daily cap. |
| `limits.extendMinutes` | 20 | min | Extra usage granted by one click on “Use 20 more minutes”. |
| `limits.dailyExtendLimit` | 0 | count | Extensions per day; 0 = unlimited, a positive value is the daily maximum. |
| `assistant.enabled` | On | — | Track and enforce the rules; off = keep statistics only (nothing enforces). |
| `assistant.soloSession` | On | — | One conversation at a time in the UI while a root conversation is running. |
| `assistant.hideOtherSessions` | On | — | Gray out other conversations and workspace folders while one is running (visible but not clickable). |
| `assistant.showRings` | On | — | Show the floating top-right widget with the two usage rings. |
| `alerts.sound` | On | — | Play the short chime for rest, pause and completion alerts. |
| `alerts.volume` | 0.6 | 0–1 | Chime volume. |
| `alerts.quietHoursStart` | null | HH:MM | Start of quiet hours (sound suppressed); null = off. |
| `alerts.quietHoursEnd` | null | HH:MM | End of quiet hours; null = off. |
| `alerts.awayIdleSeconds` | 30 | s | Consider you away (for the completion chime) after this much idle time. |
| `alerts.repeatUntilActive` | On | — | Repeat the completion chime while you are away until input returns. |
| `alerts.repeatIntervalMs` | 1000 | ms | Chime repeat interval while away (clamped to 500–10000 ms). |
| `usage.sampleSeconds` | 5 | s | How often the foreground app and idle time are sampled. |
| `usage.idleThresholdSeconds` | 60 | s | Idle time below this counts as active. |
| `usage.retentionDays` | 30 | days | Days of local usage history kept. |
| `usage.trackApps` | On | — | Record which foreground application is active (app name + duration only; no window titles). |
| `usage.autoPauseSeconds` | 60 | s | Pause counting automatically after this much keyboard/mouse idle; 0 = off. |

> Times are minutes unless the unit says otherwise. The defaults are the agreed product rules: a 3-hour daily cap, a forced 10-minute rest after 30 continuous minutes, unlimited 20-minute extensions by default (set a positive daily limit to cap them), and a completion chime that only repeats while you are away. The assistant never blocks tools and only enforces inside DSH (see the capability boundary below).
<!-- config-table:end -->

## How the rules work

- **What counts:** time is counted only while keyboard/mouse input was recent (`usage.idleThresholdSeconds`) and only while DSH is running. It is whole-machine time, not DSH-window time.
- **Automatic rest:** if the keyboard/mouse is idle for `usage.autoPauseSeconds` (default 60, `0` = off), the Host automatically enters the rest/pause state and grays the DSH window; moving the mouse or typing resumes it. This is the only way to enter that state from the UI — the rings are display-only, and the pause/resume API endpoints stay available for advanced use.
- **Continuous use** accumulates while you are active. When it reaches `limits.continuousMinutes` (default 30), the assistant **immediately** starts a forced rest of `limits.restMinutes` (default 10): the rest screen appears with the shared today-usage card, active time stops accumulating, and the rest is excluded from the daily total.
  - The rest **finishes only when its time has elapsed and you are back** (real input detected); while you are away it simply keeps waiting, so you cannot "sleep through" the rest and have it silently end.
  - If you do not want to wait, **「跳过休息」 / “Skip rest”** ends it immediately. The continuous counter resets either way.
- **Daily use** accumulates the same activity. When it reaches `limits.dailyMinutes` (default 180), DSH shows the gray daily overlay — the same today-usage card as the rest screen, with two actions:
  - **「再使用 20 分钟」 / “Use 20 more minutes”** grants `limits.extendMinutes` (default 20) immediately. `limits.dailyExtendLimit` defaults to `0`, which means **unlimited** extensions; set a positive value to cap how many times per day you can extend. When the extension expires the overlay returns. While unlimited, the overlay omits the remaining-count line.
  - **「跳过」 / “Skip”** only dismisses today's reminder in this browser; it does **not** extend or change your limits (it is the daily acknowledgment flag in `localStorage`).
- **Day rollover:** counters reset at local midnight.
- **Rest vs. assistant off:** `assistant.enabled` off (panel switch) means statistics only — no rings, no rest, no overlays. The automatic rest is temporary and resumes on activity.
- **Completion chime:** when an agent task completes while you are **away** (window unfocused/hidden, or machine idle ≥ `alerts.awayIdleSeconds`), the chime repeats every `alerts.repeatIntervalMs` until you move the mouse or type. While you are actively watching, no chime plays.

## One conversation at a time

- **Default on** (`assistant.soloSession` + `assistant.hideOtherSessions`). While any root conversation's agent is running, the UI **jumps back to that running conversation** and keeps it usable. The other conversation rows **and workspace folder rows** are grayed out and cannot be clicked; clicking one only shows the gentle reminder. If a non-owner conversation is somehow visible, its content is veiled/grayed and sending is discouraged until the run finishes. Nothing is hidden — folder collapse/expand state is never touched — and there is no banner text.
- Background agents keep running to completion — this is a UI affordance, **not** a lock. No tool call is blocked, no agent is interrupted.
- When nothing is running, the auto-jump stops and the gray styles and click guard are removed immediately. Disabling the plugin or losing contact with the Host clears them right away as well.

## Focus assistant panel and usage statistics

- **Entry:** sidebar, below the Plugins row — `专注助手` / “Focus assistant”. It opens one page with three parts: overview, a short settings form, and the enable/pause switch.
- **Overview:** today's active time vs. the daily cap, continuous time vs. the continuous cap, rest status, per-app breakdown (top 8, name + mm:ss + bar), and a 7-day trend.
- **Settings:** only the seven common controls listed under [Configuration](#configuration), with units in the labels. Advanced knobs are not shown in the UI (they remain in the settings JSON/API). The save/discard action row sits right-aligned at the bottom of the panel content.
- **Per-app tracking** samples the foreground application every few seconds and stores **only app names and durations** — no window titles, no keystrokes, no URLs. Turn `usage.trackApps` off to keep just the total. Windows foreground-app detection is first-class; macOS and Linux are best effort.

## Pure-plugin capability boundary

This version is **a DSH plugin only**. It cannot do the things a desktop guard could, and the README says so plainly: it **cannot bring DSH to the front**, **cannot block other applications** (a rest does not stop you from using your machine), and **cannot count usage while DSH is closed**. The rest visuals only cover the DSH window. A companion desktop guard that would cover those cases is a possible later phase and is not included.

| Wanted behavior | This version | Why |
| --- | --- | --- |
| Count usage, show the two rings and the countdowns inside DSH | ✅ yes | Runs in the DSH Host and Web GUI |
| Gray DSH-only daily overlay with per-app detail | ✅ yes | Rendered inside DSH |
| Automatic rest and daily screens inside DSH | ✅ yes | Rendered inside DSH |
| One conversation at a time (auto-jump + gray out + not clickable) | ✅ yes (UI only) | Never blocks tools or agents |
| **Bring DSH to the front** | ❌ no | Needs a desktop window/OS API |
| **Block other applications during rest** | ❌ no | Needs a global always-on-top overlay / input hook |
| **Count or enforce while DSH is closed** | ❌ no | The plugin runs inside the DSH process |
| **Rings or rest screen outside the DSH window** | ❌ no | Only drawn inside DSH |

## Data & privacy

- Everything is local. Data lives in **`$DSH_HOME/plugin-data/dsh-deep-focus/`** (`$DSH_HOME` defaults to `~/.dsh`): `settings.json` (mode `0600`), `limits.json`, and per-day `usage/YYYY-MM-DD.jsonl` files.
- The sampler reads idle time and the **name of the foreground application** (on Windows from the foreground window's process; no title text). The idle auto-rest and away chime reuse that same idle signal and the browser's focus state — **no new data is recorded**. It never reads keystrokes, window titles, application contents, screenshots, or the clipboard.
- The browser stores only a per-day “Skip” acknowledgment flag in `localStorage`; it contains no usage data.
- **No network access, no telemetry, no accounts, no third-party services.**
- Rest time is excluded from the daily total, and history is pruned after `usage.retentionDays` (30 days by default). Delete the data directory to remove everything.

See [docs/privacy.md](docs/privacy.md) for the full detail.

## Known limitations

- Pure plugin: **no global enforcement** — switching to another application is never blocked, and DSH is never brought to the front. See the capability boundary above.
- Usage is sampled **only while DSH runs**; time with DSH closed is not tracked, and the UI cannot show it.
- **Windows is first-class.** macOS and Linux foreground-app detection is implemented but best effort.
- Foreground tracking is per executable: some apps share a process name, and unknown executables appear under their raw name.
- Solo mode jumps back to the running conversation and grays out other conversation/folder rows, blocking their clicks; it is a visual affordance, not a hard block, and background agents keep working.
- The “Skip” acknowledgment is stored per day per browser; another browser or clearing site data can show the overlay again.
- The completion chime repeats only inside the DSH browser window; if the machine sleeps or DSH is closed, nothing rings.
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
├── host/             # sampler, per-app tracker, limits/rest/pause state machine, events, API
├── client.js         # self-contained browser half (assistant panel, rings, pause/rest overlays, settings)
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
