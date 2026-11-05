# dsh-deep-focus

A DeepSeek Harness plugin for deep work: **pomodoro focus blocks, one conversation at a time, whole-machine activity tracking while DSH runs, and an overtime lock you open with a locally stored password for another 20 minutes.**

English | [简体中文](README.zh.md)

## Why

Coding agents make it effortless to spread across five conversations at once. That is great for throughput and terrible for finishing one thing. `dsh-deep-focus` is a small self-discipline tool for the vibe-coding workflow:

- when you start a focus block, DSH keeps **one conversation** live instead of letting you drift;
- the plugin counts **real machine activity**, not just time spent looking at DSH;
- when you exceed the limits you chose, the app **locks** until you rest, or until you deliberately type your unlock password.

It is a focus tool, not parental control. It can be disabled, configured, or bypassed by restarting DSH. That is by design. The point is to make drifting cost one conscious decision.

## Features

| Feature | What it does |
| --- | --- |
| **Pomodoro focus blocks** | Focus/break cycles (25/5 by default, long break every 4 rounds), a countdown pill in the composer, an in-app panel, completion toast and a synthesized two-tone chime. Plans survive page refreshes and app restarts because the deadline is stored, not the remaining time. |
| **One-conversation lock** | While a focus block or an agent turn is running, other conversations in the sidebar are dimmed and blocked, and the Host refuses their tool calls. Subagents and Agent Teams members owned by the locked conversation keep working. |
| **Whole-machine activity tracking** | Every few seconds the plugin reads the system idle time (`GetLastInputInfo` on Windows, `HIDIdleTime` on macOS, X11/DBus on Linux) and counts a sample as active only when keyboard or mouse input was recent. Today's active time, continuous work time and a 7-day chart are shown in the settings section. |
| **Overtime lock + password unlock** | When the daily active, continuous work, or single-session limit is exceeded, the app locks. Type your unlock password to get another 20 minutes. A strict mode allows only a forced break, and a daily unlock cap can limit how often you can extend. |

Everything is configurable, the UI follows the DSH theme (light/dark) and language (English/Chinese), and one composer pill is the only always-visible element.

## Screenshots

<!-- screenshots:pending -->

> **Placeholder:** screenshots are not committed yet, so this section intentionally contains no image links (nothing to 404). The exact capture list (light/dark pill, panel, lock overlay, settings and stats) is in [docs/publishing.md](docs/publishing.md#readme-screenshots). They will replace this placeholder before the first public release.

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

The plugin ships source as-is: there is no build step and no runtime dependency to install.

## Quick start

1. Click the **focus pill** in the composer toolbar (a play glyph and `专注` / `Focus` when idle).
2. Enter the one task you are working on, pick a preset (15 / 25 / 50 minutes), and press start. The pill turns into a countdown.
3. Open **Settings > Deep focus** and set an **unlock password** before you rely on the lock.
4. Check **Settings > Deep focus** for today's active time, continuous work time and the last 7 days.
5. When the app locks, type the unlock password to buy another 20 minutes, or take the break.

## Configuration

All runtime settings live in **Settings > Deep focus**. The table below is generated from `src/shared/contract.js` by `node scripts/config-table.mjs`; the Host clamps every value to a safe range.

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
| `limits.dailyActiveMinutes` | 480 | min | Daily active-time cap; 0 = unlimited. |
| `limits.continuousWorkMinutes` | 90 | min | Cap on unbroken work before a break; 0 = unlimited. |
| `limits.sessionMinutes` | 90 | min | Cap on a single focus block; 0 = unlimited. |
| `limits.unlockMinutes` | 20 | min | Extra app time granted by one password unlock. |
| `limits.dailyUnlockLimit` | 0 | count | Password unlocks allowed per day; 0 = unlimited. |
| `limits.strictNoUnlock` | Off | — | Hide the password field: a lock can only be ended by a forced break. |
| `lock.singleConversation` | On | — | Keep one conversation active while a focus block or agent turn is running. |
| `lock.blockToolsOutsideFocus` | On | — | The Host refuses tool calls from other conversations. |
| `lock.lockSidebarOutsideFocus` | On | — | Best effort: dim and block the other conversations in the sidebar. |
| `lock.exemptSubagents` | On | — | Exempt Agent Teams members from the conversation lock (non-root subagents are always exempt). |
| `alerts.taskDone` | On | — | Toast and chime when a focus block completes. |
| `alerts.turnDone` | Off | — | Extra toast at the end of every agent turn. |
| `alerts.sound` | On | — | Play the synthesized completion chime. |
| `alerts.volume` | 0.6 | 0–1 | Chime volume. |
| `alerts.quietHoursStart` | null | HH:MM | Start of quiet hours (sound suppressed); null = off. |
| `alerts.quietHoursEnd` | null | HH:MM | End of quiet hours; null = off. |
| `usage.sampleSeconds` | 5 | s | How often the idle sampler reads system activity. |
| `usage.idleThresholdSeconds` | 60 | s | Idle time below this counts as active. |
| `usage.retentionDays` | 30 | days | Days of local usage history kept. |
| `usage.detectMedia` | Off | — | Media-playback exemption, reserved for a later release; inert in 0.1.0. |

> `security.*` keys are managed by the plugin (a salted scrypt hash of the unlock password) and are never returned by the settings API. Times are minutes unless the unit says otherwise; `0` disables a limit.
<!-- config-table:end -->

## How the lock works

- **Hard boundary:** while a conversation is locked, the Host refuses tool calls from any other conversation. The refusal is visible to that agent, not silently dropped.
- **Best effort:** the sidebar dims non-owner conversations and intercepts clicks on them, and the app's own "open conversation" path is wrapped while locked. This part depends on DSH DOM details and is not a security boundary.
- **Choosing the owner:** a focus block binds the conversation you started it from. When no focus block is running, the conversation with a running agent is the owner ("only the one that is working").
- **Exempt:** subagents and workflow children are never blocked (they are work for a root conversation), and Agent Teams members are exempt while `lock.exemptSubagents` is on. If the bound focus conversation has no live agent, the conversation lock stops blocking until you stop or rest.
- **Owner goes away:** disposing the bound conversation stops its focus block, so a stale lock cannot freeze the rest of the app.
- **Unlock:** your password is checked by the Host against a salted scrypt hash. A successful unlock grants `limits.unlockMinutes` (20 minutes by default). `limits.strictNoUnlock` hides the password field and only offers a forced break.

The lock is friction, not security: it exists to interrupt autopilot, not to withstand an adversary. Restarting DSH, or editing the data directory, bypasses it.

## Data & privacy

- Everything is local. Data lives in **`$DSH_HOME/plugin-data/dsh-deep-focus/`** (`$DSH_HOME` defaults to `~/.dsh`): `settings.json` (mode `0600`), `focus.json`, `budget.json`, and per-day `usage/YYYY-MM-DD.jsonl` / `stats/YYYY-MM-DD.jsonl` files.
- The sampler reads only **how long the whole machine has been idle**. It never reads keystrokes, window titles, application names, screenshots, or clipboard contents.
- **No network access, no telemetry, no accounts, no third-party services.**
- Activity is pruned after `usage.retentionDays` (30 days by default). Delete the data directory to remove everything.

See [docs/privacy.md](docs/privacy.md) for the full detail.

## Known limitations

- Activity is sampled **only while DSH runs**; time with DSH closed is not tracked and the UI shows it as untracked. A background daemon is out of scope for 0.1.0.
- **Windows is first-class.** macOS and Linux sampling is implemented but best effort and not tested by this release's author.
- The sidebar lock is best effort (DOM interception). The Host-side tool guard is the real boundary.
- The password unlock is **friction, not a security boundary**. Restarting DSH bypasses the lock.
- Media playback without input counts as idle (`usage.detectMedia` is reserved and inert in 0.1.0).
- Not a screen-time replacement: no cross-device sync, no reports, no app-level breakdown.

## Compatibility

| Item | Status |
| --- | --- |
| DeepSeek Harness | Verified on **0.2.2-rc.1** (Windows). Declared range: `^0.2.0-rc.2 \|\| ^0.2.1-rc.2 \|\| ^0.2.2-rc.1`. |
| Operating systems | Windows tested; macOS/Linux sampling implemented, best effort. |
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
├── host/             # sampler, tracker, focus state machine, budget, lock guard, events, API
├── client.js         # self-contained browser half (slots, panel, overlay, settings page)
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
