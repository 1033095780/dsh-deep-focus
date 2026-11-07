# dsh-deep-focus

A focus assistant for DeepSeek Harness: a **two-ring widget** shows today's usage and continuous time (click it to pause or resume), an **automatic rest** pauses after 60 s of sustained idle, a **3-hour daily cap** and **30-minute continuous cap** keep the day bounded, and **one conversation at a time** keeps the sidebar focused — all inside DSH, never blocking a tool call.

English | [简体中文](README.zh.md)

## Features

| Feature | What it does |
| --- | --- |
| Two-ring widget | Two **equal columns**, each a ring with its **value inside** (today: minutes; continuous: mm:ss), centered captions 今日已用 / 连续使用, and a continuous clock ticking **once per second**. **Drag the card anywhere** — a real drag does not pause, a tap still pauses/resumes. The position is remembered across reloads (`localStorage`) and kept inside the window; default is top-right. |
| Automatic rest | After `usage.autoPauseSeconds` of sustained idle (default 60 s) the pause card appears; the ~0.6 s settle guard exists only for this automatic pause, to avoid flashing. Clicking the rings pauses **immediately** (card shown at once). A pause/rest screen is only **effective while DSH is the foreground app**: if you switch to another application, today's usage keeps counting and the continuous counter is held (no decay, no reset) — the screen waits for you, and returning to DSH makes it effective. While DSH is in front, any pause resumes as soon as you use the keyboard/mouse: the client posts `/resume` on the first input, near-instantly (no wait for the ~5 s sampler). |
| Daily cap | Whole-machine active time while DSH runs; at 180 min the today-usage card appears with 「再使用 20 分钟」/「跳过」. |
| Continuous cap | 30 continuous minutes → a 10-minute rest on the same card; rest time is not counted. **Continuous usage decays during an effective pause/rest instead of resetting** — decay starts only when you are actually on the DSH pause/rest page (DSH in the foreground); elsewhere the value is simply held. The cap clears after about `limits.restMinutes` of recovery (e.g. 20 min used → ~10 min rest, rate `continuousMinutes / restMinutes`); a short pause only reduces it and use continues from the remainder. |
| Background limit alert | When a limit screen appears (continuous timeout → rest/pause page, or the daily lock) while DSH is behind another app, the plugin retries `window.focus()` a couple of times and, when it cannot bring DSH forward, posts **one clickable system notification** prompting you to return (clicking it returns to DSH). Switching back is **best effort** only: a pure plugin cannot force the OS, Windows may keep another app in front, and the notification is the reliable fallback. No native code; only the browser notification permission. |
| One conversation at a time | Pins the UI to exactly **one primary conversation** — the running conversation whose turn started most recently. Every other row (including **other running conversations**) is grayed and not clickable; the UI auto-jumps to the primary. When the running set empties, the gray state is **held ~1.5 s** before restoring, so it no longer flickers. Nothing is hidden. |
| Away chime | Rings only when **all running conversations have finished** (the running set goes from non-empty to empty) while you are away. If only some conversations finish, it stays silent. Repeats until input, capped at ~2 minutes. |
| Shared usage card | Auto-pause, forced rest and the daily-limit screen all render the **same today-usage card** (title/reason + today's total + per-app breakdown); only the title and buttons differ. |
| Per-app statistics + assistant panel | Sidebar hub with overview, 7-day trend, short settings and an enable/pause switch. |

## Screenshots

<!-- screenshots:pending -->

> No screenshots are committed yet. The capture list (two-ring widget, shared today-usage card, automatic-rest state, assistant panel) is in [docs/publishing.md](docs/publishing.md#readme-screenshots).

## Install

Requires DeepSeek Harness `0.2.2-rc.1` (also accepts `0.2.0-rc.2` / `0.2.1-rc.2`) and a desktop DSH install. This project is **not published to npm** — install it from the repository or a local checkout.

1. From the Plugins page, add the repository as a source (or use the CLI below) and enable the bundle.
2. `dsh plugin --profile desktop add https://github.com/1033095780/dsh-deep-focus`
3. Local checkout: `dsh plugin --profile desktop add /absolute/path/to/dsh-deep-focus`.

No build step and no runtime dependencies. Disabling or uninstalling removes all UI immediately and stops tracking.

## Quick start

1. Open the **Focus assistant** entry in the sidebar (below Plugins).
2. The two rings show today's and continuous progress in two equal columns, each with its value inside. Click the card to pause — the pause card appears immediately — and the pause takes effect while DSH is in front; switch to another app and today's usage keeps counting (the continuous counter is held) until you return to the pause page. Any keyboard/mouse input while DSH is focused resumes it almost instantly. Idling for 60 s pauses automatically too.
3. At 30 continuous minutes a 10-minute rest screen appears (shared usage card + 「跳过休息」).
4. At 3 hours of daily use a gray overlay offers only 「再使用 20 分钟」 and 「跳过」 (skip just dismisses today's reminder).
5. Use the panel switch to pause enforcement; the short settings form changes the common limits.

## How the rules work

- **What counts:** whole-machine active time while DSH runs; a sample counts only when input was recent (`usage.idleThresholdSeconds`).
- **Daily cap:** default `limits.dailyMinutes` 180. At the cap the shared today-usage card appears; 「再使用 20 分钟」 grants `limits.extendMinutes` (20) immediately, unlimited per day by default (`limits.dailyExtendLimit` 0 = unlimited, a positive value caps it). 「跳过」 only dismisses today's reminder in this browser, it never extends.
- **Background limit screens:** when a limit screen appears while DSH is behind another application — a continuous timeout → the rest/pause page, or the daily-limit lock — the plugin retries `window.focus()` a couple of times (~1.2 s apart). **Switching back to the foreground is best effort**: a pure plugin cannot force the OS to raise a window, so when that fails it posts **one clickable system notification** (「连续使用超时 · 需要休息」 / 「今日使用已超时」) prompting you to return to DeepSeek — clicking it focuses DSH. Windows may still keep another application in front; **the notification is the reliable fallback**. It adds no native code and no permission beyond the browser notification permission.
- **Continuous rest / decay:** at `limits.continuousMinutes` (30) a rest of `limits.restMinutes` (10) starts on the same today-usage card; it ends only when its time elapsed **and** you are back, or via 「跳过休息」. **Decay only runs while the pause/rest page is effective, i.e. DSH is the foreground application.** If you are in another app, today's usage keeps counting and the continuous counter is frozen — no decay, no reset — until you actually return to the DSH screen. Then the counter **decays gradually** instead of resetting, at `continuousMinutes / restMinutes` per minute (default 30/10 → 1 min of rest removes 3 min of continuous use; with a 20/10 setup, 20 min → ~10 min rest → 0). A short pause only reduces the value proportionally, and resuming continues from the remaining value — a single click never zeros the run. Day rollover, disabling the assistant and invalid/sleep sampler gaps still reset it. Rest time is excluded from the daily total.
- **Unified screens:** idle auto-pause, manual pause, the forced rest and the daily cap all use the same today-usage card with their own title/actions — there is no separate gray-only pause layer any more.
- **Moving the timer:** press and drag the two-ring card with the mouse or finger — movement beyond a few pixels becomes a drag and suppresses the pause click, while a normal click/tap still toggles pause/resume. The position is saved in `localStorage` across reloads, clamped to stay inside the window on drag and resize, and defaults to the top-right corner.
- **Automatic rest / pause:** the pause card appears after **sustained idle** — at least two consecutive fresh samples show `usage.autoPauseSeconds` (60, `0` = off) of idleness — and for this automatic pause only, the card shows after the state settles (~0.6 s) so a single stale sample cannot flash it; prior activity resets the idle counter. **Clicking the two-ring widget pauses immediately** (`POST /pause`) and shows the card at once — the 0.6 s guard is not used there. **A pause/rest is only effective while DSH is the foreground app:** while you are in another application, today's usage continues accumulating and the continuous counter is held (no decay/reset); the paused screen simply waits for you. Once DSH is back in front, counting stops and (for a rest) decay begins. While DSH is focused, any pause resumes as soon as keyboard/mouse activity is detected — the client posts `/resume` on the first input after a short guard, near-instantly. The card blocks the DSH UI while shown and disappears immediately on resume (「继续计时」/Enter/Space/Escape remain optional explicit paths).
- **One conversation at a time:** exactly one **primary conversation** is active — the running root conversation whose turn started most recently (`/state.solo.primary`). The UI auto-jumps to it; every other conversation and folder row, **including other running conversations**, is grayed and non-clickable, and a visible non-primary conversation gets the veil. When the running set becomes empty the gray state is held for ~1.5 s before restoring, so transient empty polls do not flicker. Background agents keep running; no tool call is blocked, and nothing is hidden.
- **Away chime:** it rings only when **all running conversations have finished** — the root running set was non-empty and becomes empty — and you are away (window unfocused/hidden or idle past `alerts.awayIdleSeconds`). If several conversations run and only some finish, it stays silent; subagent/teammate turns never ring it either. It repeats every `alerts.repeatIntervalMs` until you move the mouse or type, with a hard cap of ~2 minutes (`alerts.repeatUntilActive` disables the repeat).
- **Assistant off:** statistics only — no rings, rest or overlays.

## Usage panel

Sidebar → `专注助手` / “Focus assistant”: today vs. daily cap, continuous vs. continuous cap, rest status, per-app breakdown (top 8 + 7-day trend), the enable/pause switch and the short settings form with a right-aligned save/discard row. Foreground app name + duration only — no window titles, no keystrokes, no network.

## Configuration

The assistant page exposes exactly eight settings: daily limit, continuous limit, rest length, extension length, auto-rest idle seconds, sound, app tracking, and 「专注时只允许一个对话」/“One conversation at a time” (`assistant.soloSession`, which toggles the auto-jump + gray + non-clickable pinning). Everything else (extension cap, quiet hours, away/repeat chime, sampling intervals, retention, ring toggle) stays in the settings JSON and plugin API but is **not shown in the UI**.

<!-- config-table:start -->
| Setting | Default | Unit | Notes |
| --- | ---: | ---: | --- |
| `limits.dailyMinutes` | 180 | min | Daily whole-machine active-time cap while DSH runs; 0 = no daily cap. |
| `limits.continuousMinutes` | 30 | min | Continuous-use cap before the assistant forces a rest; 0 = no forced rest. |
| `limits.restMinutes` | 10 | min | Length of a forced rest. Rest time is not counted toward the daily cap. |
| `limits.extendMinutes` | 20 | min | Extra usage granted by one click on “Use 20 more minutes”. |
| `limits.dailyExtendLimit` | 0 | count | Extensions per day; 0 = unlimited, a positive value is the daily maximum. |
| `assistant.enabled` | On | — | Track and enforce the rules; off = keep statistics only (nothing enforces). |
| `assistant.soloSession` | On | — | Pin the UI to one primary conversation while a root conversation is running. |
| `assistant.hideOtherSessions` | On | — | Gray out the other conversation and workspace folder rows while a primary conversation runs (visible but not clickable). |
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

It cannot bring DSH to the front, cannot block other applications, and cannot count usage while DSH is closed. When a limit screen appears in the background it only *attempts* `window.focus()` (with a couple of retries) plus one system notification; the OS may ignore the focus attempt and Windows may keep another application in front — the notification is the reliable fallback (and only the browser notification permission is used). The rest visuals only cover the DSH window. A companion desktop guard for those cases is a possible later phase and is not included.

| Works inside DSH | Cannot do |
| --- | --- |
| usage counting, rings, unified pause/rest/daily cards, auto-jump sidebar | force the OS foreground (focus/notification are best effort), block other apps, count while DSH is closed, draw outside DSH |

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

Repository: **https://github.com/1033095780/dsh-deep-focus** (releases: [releases](https://github.com/1033095780/dsh-deep-focus/releases), issues: [issues](https://github.com/1033095780/dsh-deep-focus/issues)). Distribution is **GitHub-only**: this project is not published to npm. Push a tag, create a **GitHub Release** with the changelog as release notes, and users install from the repository or tag. See [docs/publishing.md](docs/publishing.md) for the release checklist and source-install instructions.

## License

[MIT](LICENSE) © 2026 dsh-deep-focus contributors.
