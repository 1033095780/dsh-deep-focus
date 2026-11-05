# dsh-deep-focus

A focus assistant for DeepSeek Harness: a **floating two-ring widget** shows how much of your daily 3-hour cap and 30-minute continuous limit you have used, clicking it **pauses counting and grays the DSH window** until you actually touch the keyboard or mouse, and when you drift away a **chime repeats until you come back** — all inside DSH, without blocking a single tool call.

English | [简体中文](README.zh.md)

## Why

Coding agents make it effortless to spread across five conversations at once. That is great for throughput and terrible for finishing one thing — and easy to turn into a 12-hour day.

`dsh-deep-focus` puts a gentle, honest boundary around that:

- **two rings, always visible** in the top-right corner: today's whole-machine usage vs. the daily cap, and continuous use vs. the continuous cap;
- when you need a real break, **click the rings**: counting pauses, the DSH window grays, and nothing resumes until you move the mouse or type again;
- after **30 continuous minutes** it stops the work with a **10-minute rest**; the rest only ends when the time is up **and** you are back — or you press 「跳过休息」;
- at **3 hours of daily active use** DSH shows a gray overlay with today's per-app breakdown, a “Use 20 more minutes” action and a **Skip** button;
- by default it keeps **one conversation at a time**: while any conversation's agent is running, the other conversations and workspace folders are grayed out and cannot be clicked — a gentle reminder appears instead — while the current conversation stays normal.

It never blocks a tool call, never interrupts another conversation's agent, and never enforces anything outside DSH. See [Pure-plugin capability boundary](#pure-plugin-capability-boundary) for exactly what that means.

## Features

| Feature | What it does |
| --- | --- |
| **Floating two-ring widget** | Top-right of the DSH window: a compact glass card with one ring for today's usage and one for the continuous timer, plus a small label. Click it to pause. |
| **Pause & gray** | Clicking the widget stops counting and grays the DSH window with a calm 「已暂停计时」 note. The pause ends only on **real keyboard/mouse activity** (a short grace period ignores the click that started it). It also pauses automatically after `usage.autoPauseSeconds` (default 60 s) without input, and movement resumes it. |
| **Daily cap (3 h by default)** | Gray overlay with today's total, per-app breakdown, 「再使用 20 分钟」 / “Use 20 more minutes” (configurable minutes; the extension count is unlimited by default) and 「跳过」 / “Skip” (a per-day acknowledgment). |
| **Continuous cap → forced rest** | 30 continuous minutes → a full-screen **10-minute rest**. It finishes only when the rest time elapsed **and** you are back at the machine; while you are away it waits. 「跳过休息」 / “Skip rest” ends it immediately. Rest time is not counted toward the daily cap. |
| **Completion chime only when away** | No chime while you are actively watching. If the window is unfocused/hidden or the machine has been idle for `alerts.awayIdleSeconds`, the chime repeats every `alerts.repeatIntervalMs` until input returns. |
| **One conversation at a time** | Default on. While a root conversation's agent is running, the UI **jumps back to that conversation**, and the other conversations **and workspace folders** are grayed out and cannot be clicked (a gentle reminder appears). If a non-owner conversation is somehow visible, its content is veiled and sending is discouraged until the run finishes. Nothing is hidden; the running agent is never touched. No banner text. |
| **Focus assistant panel** | One sidebar entry under the Plugins row: overview (today, continuous timer, rest/pause status, per-app breakdown, 7-day trend), settings, and the enable/pause switch. |
| **Per-app usage statistics** | Foreground-application sampling while DSH runs: DeepSeek Harness, browsers, QQ, WeChat, VS Code, terminals, and so on. App name + duration only. |
| **Local and private** | Everything stays in `$DSH_HOME/plugin-data/dsh-deep-focus/`; no network, no telemetry, no accounts. |

There is **no pomodoro timer** in this version — the assistant replaces timer-based work/rest cycles with the usage rules above.

## Screenshots

<!-- screenshots:pending -->

> **Placeholder:** screenshots are not committed yet, so this section intentionally contains no image links (nothing to 404). The capture list (floating rings, paused gray state, rest screen with skip, daily overlay with skip) is in [docs/publishing.md](docs/publishing.md#readme-screenshots). They will replace this placeholder before the first public release.

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
3. Click the widget when you want a deliberate pause: counting stops, DSH grays, and moving the mouse or typing resumes it. The same gray pause appears automatically after `usage.autoPauseSeconds` (default 60 s) without input.
4. When the continuous limit is reached, the rest screen appears; it waits until the rest time is over **and** you are back, or press 「跳过休息」.
5. At the daily cap the gray overlay offers 「再使用 20 分钟」 and 「跳过」. Use the assistant panel's switch to pause enforcement entirely, and its settings to change any limit.

## Configuration

All runtime settings live in the **Focus assistant** panel. The table below is generated from `src/shared/contract.js` by `node scripts/config-table.mjs`.

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
- **Pause mode:** clicking the floating widget sends `POST /pause`; counting stops immediately and the window grays. It resumes only on real activity (`POST /resume` or the Host's own activity check with a short grace period), never from the click that paused it.
- **Idle auto-pause:** if the keyboard/mouse is idle for `usage.autoPauseSeconds` (default 60, `0` = off), the Host pauses counting automatically and shows the same gray pause screen; moving the mouse or typing resumes it. Both manual and automatic pauses reuse the idle signal the plugin already samples.
- **Continuous use** accumulates while you are active. When it reaches `limits.continuousMinutes` (default 30), the assistant **immediately** starts a forced rest of `limits.restMinutes` (default 10): the rest screen appears, active time stops accumulating, and the rest is excluded from the daily total.
  - The rest **finishes only when its time has elapsed and you are back** (real input detected); while you are away it simply keeps waiting, so you cannot "sleep through" the rest and have it silently end.
  - If you do not want to wait, **「跳过休息」 / “Skip rest”** ends it immediately. The continuous counter resets either way.
- **Daily use** accumulates the same activity. When it reaches `limits.dailyMinutes` (default 180), DSH shows the gray daily overlay:
  - **「再使用 20 分钟」 / “Use 20 more minutes”** grants `limits.extendMinutes` (default 20) immediately. `limits.dailyExtendLimit` defaults to `0`, which means **unlimited** extensions; set a positive value to cap how many times per day you can extend. When the extension expires the overlay returns. While unlimited, the overlay omits the remaining-count line.
  - **「跳过」 / “Skip”** hides the overlay for the current day in this browser (best-effort acknowledgment, not enforcement).
- **Day rollover:** counters reset at local midnight.
- **Pause vs. assistant off:** `assistant.enabled` off (panel switch) means statistics only — no rings, no rest, no overlays. Pause is temporary and resumes on activity.
- **Completion chime:** when an agent task completes while you are **away** (window unfocused/hidden, or machine idle ≥ `alerts.awayIdleSeconds`), the chime repeats every `alerts.repeatIntervalMs` until you move the mouse or type. While you are actively watching, no chime plays.

## One conversation at a time

- **Default on** (`assistant.soloSession` + `assistant.hideOtherSessions`). While any root conversation's agent is running, the UI **jumps back to that running conversation** and keeps it usable. The other conversation rows **and workspace folder rows** are grayed out and cannot be clicked; clicking one only shows the gentle reminder. If a non-owner conversation is somehow visible, its content is veiled/grayed and sending is discouraged until the run finishes. Nothing is hidden — folder collapse/expand state is never touched — and there is no banner text.
- Background agents keep running to completion — this is a UI affordance, **not** a lock. No tool call is blocked, no agent is interrupted.
- When nothing is running, the auto-jump stops and the gray styles and click guard are removed immediately. Disabling the plugin or losing contact with the Host clears them right away as well.

## Focus assistant panel and usage statistics

- **Entry:** sidebar, below the Plugins row — `专注助手` / “Focus assistant”. It opens one page with three parts: overview, settings, and the enable/pause switch.
- **Overview:** today's active time vs. the daily cap, continuous time vs. the continuous cap, pause/rest status, per-app breakdown (top 8, name + mm:ss + bar), and a 7-day trend.
- **Settings:** every limit and toggle from the configuration table above, with units in the labels — including `assistant.showRings` and the completion-chime repeat settings.
- **Per-app tracking** samples the foreground application every few seconds and stores **only app names and durations** — no window titles, no keystrokes, no URLs. Turn `usage.trackApps` off to keep just the total. Windows foreground-app detection is first-class; macOS and Linux are best effort.

## Pure-plugin capability boundary

This version is **a DSH plugin only**. It cannot do the things a desktop guard could, and the README says so plainly: it **cannot bring DSH to the front**, **cannot block other applications** (a rest does not stop you from using your machine), and **cannot count usage while DSH is closed**. The pause/rest visuals only cover the DSH window. A companion desktop guard that would cover those cases is a possible later phase and is not included.

| Wanted behavior | This version | Why |
| --- | --- | --- |
| Count usage, show the two rings and the countdowns inside DSH | ✅ yes | Runs in the DSH Host and Web GUI |
| Gray DSH-only daily overlay with per-app detail | ✅ yes | Rendered inside DSH |
| Pause and rest screens inside DSH | ✅ yes | Rendered inside DSH |
| One conversation at a time (auto-jump + gray out + not clickable) | ✅ yes (UI only) | Never blocks tools or agents |
| **Bring DSH to the front** | ❌ no | Needs a desktop window/OS API |
| **Block other applications during rest** | ❌ no | Needs a global always-on-top overlay / input hook |
| **Count or enforce while DSH is closed** | ❌ no | The plugin runs inside the DSH process |
| **Rings or rest screen outside the DSH window** | ❌ no | Only drawn inside DSH |

## Data & privacy

- Everything is local. Data lives in **`$DSH_HOME/plugin-data/dsh-deep-focus/`** (`$DSH_HOME` defaults to `~/.dsh`): `settings.json` (mode `0600`), `limits.json`, and per-day `usage/YYYY-MM-DD.jsonl` files.
- The sampler reads idle time and the **name of the foreground application** (on Windows from the foreground window's process; no title text). The pause/away logic reuses that same idle signal and the browser's focus state — **no new data is recorded**. It never reads keystrokes, window titles, application contents, screenshots, or the clipboard.
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
