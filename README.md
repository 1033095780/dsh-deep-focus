# dsh-deep-focus

A gentle focus plugin for DeepSeek Harness: **pomodoro blocks, a one-conversation-at-a-time reminder in the sidebar, per-app usage statistics, and an optional overtime nudge you can dismiss with one click.**

English | [简体中文](README.zh.md)

## Why

Coding agents make it effortless to spread across five conversations at once. That is great for throughput and terrible for finishing one thing.

`dsh-deep-focus` is a **self-discipline tool, not a gatekeeper**. It never blocks a tool call, never refuses another conversation's agent, and never takes work away from you. It only does four small things:

- keeps a **pomodoro rhythm** so you know when to stop;
- **grays out the other conversations** while a focus block runs, and shows a friendly reminder if you click one;
- shows **where the time actually went**, per foreground application, today and over the last 7 days;
- offers an **optional overtime nudge** when you choose to set a limit — dismissed with one click (“Use 20 more minutes”), no password.

If you disable the plugin, everything disappears immediately and the sidebar goes back to normal.

## Features

| Feature | What it does |
| --- | --- |
| **Pomodoro focus blocks** | Focus/break cycles (25/5 by default, long break every 4 rounds), a countdown pill in the composer, a floating panel, and a completion toast with a synthesized two-tone chime. The deadline is stored, so a page refresh or app restart keeps the remaining time. |
| **Gentle focus mode** | While a block is running, other conversations are grayed out in the sidebar. Clicking one shows 「当前任务完成后再切换吧」 / “Finish the current task before switching — you've got this.” and does not switch. The current conversation stays fully usable. |
| **Per-app usage statistics** | Samples the foreground application and records app name + duration only: DeepSeek Harness, browsers, QQ, WeChat, VS Code, terminals, and so on. Open the **Usage** panel from the sidebar (below the Plugins row) for today's totals, a per-app breakdown, and a 7-day trend. |
| **Optional overtime nudge** | Limits are **off by default** (`0` = unlimited). If you enable one and exceed it, a gentle full-screen overlay offers “Use 20 more minutes” (one click, no password) and “Take a break”. |
| **Local and quiet** | Everything is local — no network, no telemetry. Sound and quiet hours are configurable. |

One composer pill is the only always-visible element. Everything else appears on demand.

## Screenshots

<!-- screenshots:pending -->

> **Placeholder:** screenshots are not committed yet, so this section intentionally contains no image links (nothing to 404). The capture list (focus pill, focus mode with the grayed sidebar, usage panel, overtime overlay) is in [docs/publishing.md](docs/publishing.md#readme-screenshots). They will replace this placeholder before the first public release.

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

The plugin ships source as-is: there is no build step and no runtime dependency to install. Disabling or uninstalling it removes every UI element immediately and restores the sidebar.

## Quick start

1. Click the **focus pill** in the composer toolbar (a play glyph and `专注` / `Focus` when idle).
2. Enter the one task you are working on, pick a preset (15 / 25 / 50 minutes), and press start. Other conversations gray out; clicking one only shows a reminder.
3. Open the **Usage** panel in the sidebar (below the Plugins row) to see today's per-app time and the 7-day trend.
4. Optional: in **Settings → Deep focus**, turn on a daily / continuous / session limit if you want the overtime nudge.
5. When a block completes you get a toast and a short chime. Nothing is ever blocked; the lock-looking overlay only exists if you enabled a limit.

## Configuration

All runtime settings live in **Settings → Deep focus**. The table below is generated from `src/shared/contract.js` by `node scripts/config-table.mjs`.

<!-- config-table:start -->
| Setting | Default | Unit | Notes |
| --- | ---: | ---: | --- |
| `focus.workMinutes` | 25 | min | Length of one focus block. |
| `focus.breakMinutes` | 5 | min | Short break after each focus block. |
| `focus.longBreakMinutes` | 15 | min | Long break taken every `focus.longBreakEvery` focus blocks. |
| `focus.longBreakEvery` | 4 | blocks | Focus blocks between long breaks; 0 disables long breaks. |
| `focus.autoStartBreak` | On | — | Start the break automatically when a focus block completes. |
| `focus.autoStartNext` | Off | — | Start the next focus block automatically when a break ends. |
| `focus.idlePauseSeconds` | 120 | s | Pause the timer after this much inactivity; 0 disables auto-pause. |
| `focus.autoResumeOnReturn` | On | — | Resume a paused block when you are active again. |
| `focus.grayOutOtherSessions` | On | — | Gray out other conversations in the sidebar during a focus block; clicking one shows a gentle reminder instead of switching. Never blocks agents or tool calls. |
| `limits.dailyActiveMinutes` | 0 | min | Daily active-time cap for the overtime overlay; 0 = off (unlimited). |
| `limits.continuousWorkMinutes` | 0 | min | Cap on unbroken work before the overtime overlay; 0 = off (unlimited). |
| `limits.sessionMinutes` | 0 | min | Cap on a single focus block; 0 = off (unlimited). |
| `limits.unlockMinutes` | 20 | min | Extra time granted by one click on “Use 20 more minutes”. |
| `alerts.taskDone` | On | — | Toast and chime when a focus block completes. |
| `alerts.turnDone` | Off | — | Extra toast at the end of every agent turn. |
| `alerts.sound` | On | — | Play the synthesized completion chime. |
| `alerts.volume` | 0.6 | 0–1 | Chime volume. |
| `alerts.quietHoursStart` | null | HH:MM | Start of quiet hours (sound suppressed); null = off. |
| `alerts.quietHoursEnd` | null | HH:MM | End of quiet hours; null = off. |
| `usage.sampleSeconds` | 5 | s | How often the foreground app and idle time are sampled. |
| `usage.idleThresholdSeconds` | 60 | s | Idle time below this counts as active. |
| `usage.retentionDays` | 30 | days | Days of local usage history kept. |
| `usage.trackApps` | On | — | Record which foreground application is active (app name + duration only; no window titles). |

> Times are minutes unless the unit says otherwise. `0` disables a limit: the three overtime limits default to `0`, so a fresh install never shows the overtime overlay. The plugin never blocks tool calls or other conversations — focus mode is sidebar guidance only.
<!-- config-table:end -->

## How focus mode works

- **UI only, by design.** The Host never registers a tool guard, never refuses a tool call, and has no say over other conversations. Other agents keep working normally during a focus block.
- **Sidebar guidance:** while a block is active and `focus.grayOutOtherSessions` is on, session rows other than the focused conversation are dimmed. A click (or keyboard activation) on a dimmed row is ignored and replaced with a gentle toast. The focused conversation's own row stays normal and usable.
- **The timer is honest:** the stored deadline survives page refresh and app restart; idle auto-pause (`focus.idlePauseSeconds`) and auto-resume are configurable.
- **It disappears cleanly:** disabling the plugin, losing the Host, or a restart hides all UI and removes every inline style the plugin added — no stale gray rows, no swallowed clicks.

## Usage statistics

- The Host samples the **foreground application** every few seconds (`usage.sampleSeconds`) and counts time only while keyboard/mouse input is recent (`usage.idleThresholdSeconds`).
- Friendly names cover common apps (DeepSeek Harness, browsers, QQ, WeChat, VS Code, terminals, …); unknown executables are recorded under their base name. The stable key is the lowercase executable name.
- **Only app names and durations are stored** — no window titles, no keystrokes, no clipboard, no URLs.
- Windows foreground-app detection is first-class; macOS and Linux are best effort (when the foreground app cannot be determined, the plugin keeps idle tracking and reports app sampling as off).
- Turn `usage.trackApps` off to keep only total active time. Data is pruned after `usage.retentionDays` (30 days by default).

## Overtime nudge (off by default)

- Limits start at `0` (unlimited): **a fresh install never shows an overlay**.
- If you enable `limits.dailyActiveMinutes`, `limits.continuousWorkMinutes`, or `limits.sessionMinutes` and cross one, a full-screen overlay appears with today's usage and two actions: **「再使用 20 分钟」** (grants `limits.unlockMinutes`, 20 minutes by default) and **「休息一下」** (ends the lock and resets the continuous-work counter).
- No password, no quiz, no enforcement: the overlay is a deliberate speed bump. Restarting DSH or disabling the plugin always gets you out.

## Data & privacy

- Everything is local. Data lives in **`$DSH_HOME/plugin-data/dsh-deep-focus/`** (`$DSH_HOME` defaults to `~/.dsh`): `settings.json` (mode `0600`), `focus.json`, `budget.json`, and per-day `usage/YYYY-MM-DD.jsonl` / `stats/YYYY-MM-DD.jsonl` files.
- The sampler reads idle time and the **name of the foreground application** (on Windows from the foreground window's process; no title text). It never reads keystrokes, window titles, application contents, screenshots, or the clipboard.
- **No network access, no telemetry, no accounts, no third-party services.**
- Usage history is pruned after `usage.retentionDays` (30 days by default). Delete the data directory to remove everything.

See [docs/privacy.md](docs/privacy.md) for the full detail.

## Known limitations

- Usage is sampled **only while DSH runs**; time with DSH closed is not tracked and the UI shows it as untracked.
- **Windows is first-class.** macOS and Linux foreground-app detection is implemented but best effort.
- Foreground tracking is per executable: some apps share a process name (e.g. several Electron apps), and unknown executables appear under their raw name.
- Focus mode is **UI guidance only** — deliberately not a hard block. You can still switch conversations by other means, and background agents keep running.
- The overtime overlay is a nudge, not enforcement; it is off until you turn a limit on.
- No cross-device sync, no reports, no app-level website tracking.

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
├── host/             # sampler, per-app tracker, focus state machine, budget, events, API
├── client.js         # self-contained browser half (pill, panel, overlays, settings, usage panel)
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
