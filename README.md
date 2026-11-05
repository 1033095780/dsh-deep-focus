# dsh-deep-focus

A focus assistant for DeepSeek Harness: a **display-only two-ring widget** shows today's usage and continuous time, an **automatic rest** grays DSH after 60 s idle, a **3-hour daily cap** and **30-minute continuous cap** keep the day bounded, and **one conversation at a time** keeps the sidebar focused — all inside DSH, never blocking a tool call.

English | [简体中文](README.zh.md)

## Features

| Feature | What it does |
| --- | --- |
| Display-only rings | Top-right widget: today vs. daily cap, continuous vs. continuous cap. Not clickable. |
| Automatic rest | After `usage.autoPauseSeconds` idle (default 60 s) DSH grays; keyboard/mouse resumes. |
| Daily cap | Whole-machine active time while DSH runs; at 180 min a gray “today usage” overlay appears. |
| Continuous cap | 30 continuous minutes → a 10-minute rest; rest time is not counted. |
| One conversation at a time | The UI jumps back to the running conversation; other session/folder rows are grayed and not clickable (veil fallback), nothing is hidden. |
| Away chime | Completion chime only while you are away; repeats until you return. |
| Shared usage card | Rest and daily screens use the same card: title, today's total, per-app breakdown, actions. |
| Per-app statistics + assistant panel | Sidebar hub with overview, 7-day trend, short settings and an enable/pause switch. |

## Screenshots

<!-- screenshots:pending -->

> No screenshots are committed yet. The capture list (display-only rings, shared today-usage card, automatic-rest state, assistant panel) is in [docs/publishing.md](docs/publishing.md#readme-screenshots).

## Install

Requires DeepSeek Harness `0.2.2-rc.1` (also accepts `0.2.0-rc.2` / `0.2.1-rc.2`) and a desktop DSH install.

1. Open **Plugins**, search `dsh-deep-focus`, install and enable.
2. Or: `dsh plugin --profile desktop add dsh-deep-focus`.

No build step and no runtime dependencies. Disabling or uninstalling removes all UI immediately and stops tracking.

## Quick start

1. Open the **Focus assistant** entry in the sidebar (below Plugins).
2. The two rings show today's and continuous progress; leave the keyboard/mouse alone for 60 s to see the automatic rest.
3. At 30 continuous minutes a 10-minute rest screen appears (shared usage card + 「跳过休息」).
4. At 3 hours of daily use a gray overlay offers only 「再使用 20 分钟」 and 「跳过」 (skip just dismisses today's reminder).
5. Use the panel switch to pause enforcement; the short settings form changes the common limits.

## How the rules work

- **What counts:** whole-machine active time while DSH runs; a sample counts only when input was recent (`usage.idleThresholdSeconds`).
- **Daily cap:** default `limits.dailyMinutes` 180. At the cap the shared “today usage” card appears; 「再使用 20 分钟」 grants `limits.extendMinutes` (20) immediately, unlimited per day by default (`limits.dailyExtendLimit` 0 = unlimited, a positive value caps it). 「跳过」 only dismisses today's reminder in this browser, it never extends.
- **Continuous rest:** at `limits.continuousMinutes` (30) a rest of `limits.restMinutes` (10) starts; it ends only when its time elapsed **and** you are back, or via 「跳过休息」. Rest time is excluded from the daily total.
- **Automatic rest:** after `usage.autoPauseSeconds` (60, `0` = off) without input the assistant enters the same gray rest state; activity resumes it. The rings are display-only; the pause/resume endpoints exist for the API but are not used by the UI.
- **One conversation at a time:** while a root conversation's agent runs, the UI jumps back to it; other conversation/folder rows are grayed and non-clickable, a visible non-owner conversation is veiled and sending is discouraged. Background agents keep running; no tool call is blocked.
- **Away chime:** a completion chime plays only when the window is unfocused/hidden or the machine has been idle for `alerts.awayIdleSeconds`; it repeats every `alerts.repeatIntervalMs` until input returns (`alerts.repeatUntilActive`).
- **Assistant off:** statistics only — no rings, rest or overlays.

## Usage panel

Sidebar → `专注助手` / “Focus assistant”: today vs. daily cap, continuous vs. continuous cap, rest status, per-app breakdown (top 8 + 7-day trend), the enable/pause switch and the short settings form with a right-aligned save/discard row. Foreground app name + duration only — no window titles, no keystrokes, no network.

## Configuration

The assistant page exposes exactly seven controls: daily limit, continuous limit, rest length, extension length, auto-rest idle seconds, sound, app tracking. Everything else (extension cap, quiet hours, away/repeat chime, sampling intervals, retention, solo/ring toggles) stays in the settings JSON and plugin API but is **not shown in the UI**.

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

## Data & privacy

- Local only: `$DSH_HOME/plugin-data/dsh-deep-focus/` (`settings.json` mode 0600, `limits.json`, daily `usage/YYYY-MM-DD.jsonl`). No network, no telemetry, no accounts.
- The sampler reads idle time and the foreground application's process name only; the automatic rest and away chime reuse that signal. No new data is recorded for either.
- Only app names and durations are stored. Rest time is excluded; history is pruned after `usage.retentionDays` (30). Delete the directory to remove everything.

See [docs/privacy.md](docs/privacy.md).

## Pure-plugin boundary

It cannot bring DSH to the front, cannot block other applications, and cannot count usage while DSH is closed; the rest visuals only cover the DSH window. A companion desktop guard for those cases is a possible later phase and is not included.

| Works inside DSH | Cannot do |
| --- | --- |
| usage counting, rings, rest/daily overlays, auto-jump sidebar | bring DSH forward, block other apps, count while DSH is closed, draw outside DSH |

## Compatibility

| Item | Status |
| --- | --- |
| DSH | verified on `0.2.2-rc.1`; engines `^0.2.0-rc.2 \|\| ^0.2.1-rc.2 \|\| ^0.2.2-rc.1` |
| OS | Windows tested; macOS/Linux foreground sampling best effort |
| Node (dev) | 20+; CI runs 20 and 22 |
| Build | none — source is the artifact |

## Development

```bash
node --check src/index.js src/client.js   # syntax
node --test                               # host unit tests
node scripts/verify.mjs                  # offline packaging smoke
node scripts/e2e.mjs http://127.0.0.1:<port>/plugins/dsh-deep-focus/api  # live API smoke
```

`scripts/e2e.mjs` exercises the running plugin over HTTP (state, apps, settings, rest/extend/pause paths) and restores what it changes.

## Publishing

Repository: **https://github.com/1033095780/dsh-deep-focus** (releases: [releases](https://github.com/1033095780/dsh-deep-focus/releases), issues: [issues](https://github.com/1033095780/dsh-deep-focus/issues)). Push a tag, create a **GitHub Release**, and attach the source archive. npm publishing is optional — see [docs/publishing.md](docs/publishing.md) for the checklist and npm Trusted Publishing setup.

## License

[MIT](LICENSE) © 2026 dsh-deep-focus contributors.
