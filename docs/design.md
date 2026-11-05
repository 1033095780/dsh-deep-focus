# Design

Architecture of `dsh-deep-focus` v0.2 for DeepSeek Harness. This document
describes the code in this repository; when behavior and prose disagree, the code
wins.

## Scope

v0.2 is a product rewrite after the first real-device feedback round. The plugin is
**guidance, never a gatekeeper**: it never blocks a tool call and never interferes
with another conversation's agent. It does four things:

1. **Focus state machine** — pomodoro work/break blocks with pause/resume and
   deadline-based recovery.
2. **Gentle focus mode** — while a block runs, other conversations are grayed out in
   the sidebar; clicking one shows a friendly reminder instead of switching.
3. **Per-application usage statistics** — foreground-app sampling aggregated into
   today's totals, a per-app breakdown, and a 7-day trend, shown in a sidebar
   “Usage” panel.
4. **Optional overtime overlay** — limits are off by default; when the user enables
   one and exceeds it, a gentle full-screen overlay offers “Use 20 more minutes”
   (one click) or “Take a break”.

Non-goals (explicitly removed in v0.2): tool-call denial, Host-enforced
single-conversation locking, password/quiz unlocking, tracking time while DSH is
closed, blocking the operating system, parental-control-grade enforcement.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/index.js` | Host plugin entry: wiring, timers, startup recovery, cleanup. |
| `src/host/storage.js` | Data directory, atomic JSON writes, append-only JSONL, per-file serialization, retention pruning. |
| `src/host/settings.js` | Settings merge/clamp against the contract; public (no secret) settings view. |
| `src/host/sampler.js` | Platform sampler: idle time **and** the foreground application. |
| `src/host/win32-idle.ps1` | Windows long-lived probe: idle ms + foreground pid/process name. |
| `src/host/apps.js` | Raw executable name → stable key + friendly display name mapping. |
| `src/host/tracker.js` | Folds samples into total active time and per-app milliseconds; daily JSONL aggregation. |
| `src/host/focus.js` | Focus/break state machine, deadline recovery, idle auto-pause, events. |
| `src/host/budget.js` | Limit evaluation and overtime lock state; click-to-continue and rest unlocks. |
| `src/host/events.js` | Event ring buffer, agent status map, turn/goal completion listeners. |
| `src/host/api.js` | Same-origin JSON HTTP API under `/plugins/dsh-deep-focus/api`. |
| `src/client.js` | Self-contained browser half: pill, panel, toasts, overtime overlay, settings, Usage panel. |
| `src/shared/contract.js` | Wire contract: routes, phases, events, lock reasons, `DEFAULT_SETTINGS` (version 2). |
| `src/locale/{en,zh}.json` | Plugin metadata (`meta.title`, `meta.description`). |
| `src/icon.svg` | Plugin list icon. |
| `cordis.patch.yml` | Bundle patch that inserts the `dsh-deep-focus` Host row. |

There is **no tool guard module** in v0.2: the v1 `src/host/lock.js` was deleted
with its `ctx.tools.guard` registration.

No build step: the Host half is plain ESM and the browser half is a single
CommonJS-style factory file loaded by `window.__ModuleLoader__`.

## Host half

### Lifecycle

`src/index.js` exports `name`, `inject` (the services the plugin actually uses —
`tools` is no longer among them) and `apply(ctx)`. `apply` creates the pieces in
dependency order, registers listeners/timers/routes inside the plugin effect, and
returns cleanups so a disable/HMR unload leaves nothing running:

1. `createStorage()` → data directory (`$DSH_HOME/plugin-data/dsh-deep-focus`).
2. `createSettingsStore({ storage }).load()` → runtime settings (v2 shape).
3. `createSampler(...)` → idle + foreground-app samples.
4. `createTracker({ storage, settings })` → active totals and per-app buckets.
5. `createEventRing()`, `createStatusMap()`, `installHostEventListeners(...)`.
6. `createFocus(...)`, `createBudget(...)`.
7. `registerApi({ ctx, api })` → web routes (no tool guard registration).
8. Timers: focus tick (1 s), budget evaluation (2 s), a usage-flush check every
   10 s (the tracker writes an aggregate at most once a minute), and daily
   retention pruning.
9. Startup recovery: load `focus.json` / `budget.json`, settle an over-deadline
   block once, resume sampling.

If an optional service is missing, the plugin degrades (for example no web routes
when `webServer` is unavailable) instead of throwing.

### Sampling: idle + foreground application

- One sample per `usage.sampleSeconds` (3–30 s) reports **idle milliseconds and the
  foreground process**: `idleMs|pid|exeName` on Windows (one line per sample from a
  long-lived `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass
  -File win32-idle.ps1` child; cadence via the `DSH_FOCUS_SAMPLE_MS` environment
  variable, not a shell string).
- The Windows script calls `GetLastInputInfo` + `GetTickCount64` for idle time and
  `GetForegroundWindow` + `GetWindowThreadProcessId` + `Process.GetProcessById(pid)
  .ProcessName` for the application name. It never reads window titles.
- macOS reads idle time from `ioreg -c IOHIDSystem` (`HIDIdleTime`) and probes the
  frontmost application with `osascript -e 'tell application "System Events" to get
  name of first application process whose frontmost is true'` (best effort). Linux
  runs `xprintidle` for idle time and `xdotool getactivewindow getwindowpid` plus
  `/proc/<pid>/comm` for the foreground process name (best effort). Unsupported or
  failing foreground detection keeps idle tracking working and reports app sampling
  as off.
- Sampler states: `ok` (samples accepted), `degraded` (temporary failure,
  retrying), `off` (unsupported platform or repeated failure). Restarts use
  exponential backoff (1 s → 30 s, capped), a watchdog restarts the Windows child
  when three intervals pass with no sample, and four consecutive failed starts stop
  sampling for the session. All failures degrade gracefully; none crash the plugin.

### Per-application aggregation

- `src/host/apps.js` maps raw executable names (case-insensitive) to a stable key
  and a friendly display name: browsers, QQ, WeChat, VS Code, Cursor, DeepSeek
  Harness, Windows Terminal / PowerShell, Explorer, Notion, Feishu, DingTalk,
  Spotify, Bilibili, VLC, and so on. Unknown executables use their base name as
  both key and label.
- The tracker counts time only when the idle time is below
  `usage.idleThresholdSeconds`; that time is added to the day total and to the
  current app's bucket. Idle samples end the continuous-work run.
- When `usage.trackApps` is false only the total active time is kept.
- Aggregates are flushed roughly every 60 s to `usage/YYYY-MM-DD.jsonl`, one line
  per flush: `{ t, activeMs, apps: { exeKey: ms } }` (deltas since the previous
  flush), so a day stays around 288 lines. Retention pruning removes old day files.
- A sleep/suspend gap or sampler restart never inflates usage: the first sample
  after a gap only opens a new run.

### Focus state machine

```
                 start(task, sessionId)
idle ───────────────────────────────────▶ work(running)
 ▲                                          │  ▲
 │                                          │  │ resume (user / activity)
 │                     idle threshold  ─────┘  │
 │                          pause ─▶ paused ──┘
 │                                          │
 │        complete / natural end            ▼
 │                            ┌─────────▶ break(running) ──natural end──┐
 │                            │ autoStartBreak                          │
 │                            │                            autoStartNext │
 └──────────── stop ──────────┘                                          │
                                                              back to work
```

- Phases: `idle`, `work`, `break`; status: `idle`, `running`, `paused`.
- `paused` is only reachable inside `work`; the remaining time is frozen and
  `endsAt` becomes `null` while paused.
- Idle auto-pause uses `focus.idlePauseSeconds` (0 disables it); auto-resume on
  activity uses `focus.autoResumeOnReturn`.
- Long breaks: every `focus.longBreakEvery` completed work blocks (0 disables them)
  the next break uses `focus.longBreakMinutes`.
- `pomodorosToday` resets on the local calendar day; the cycle counter survives the
  process and resets after a long break.
- The focus machine is UI guidance: it exposes state to the browser but never
  affects tool availability or other agents.

### Overtime overlay (“budget”)

`budget.evaluate()` recomputes the overlay every tick:

| Limit | Trigger | Default |
| --- | --- | --- |
| `limits.dailyActiveMinutes` | today's active time ≥ limit | `0` = off |
| `limits.continuousWorkMinutes` | continuous active time ≥ limit | `0` = off |
| `limits.sessionMinutes` | current work block elapsed ≥ limit | `0` = off |

The lock view is `{ locked, reason, since, unlockUntil, unlockMinutes, canUnlock,
strict: false }`. A `limit-warning` event fires once per day/run at 80 % of an
enabled daily/continuous limit.

Limits are off out of the box: with all three at `0` the overlay never appears.
When it does, unlocks do not lower counters; they set a **grace deadline**
(`unlockUntil`) during which the lock view reports `locked: false`:

- **Use 20 more minutes** — `POST /unlock` with no body (or `{}`): grants
  `limits.unlockMinutes` (default 20) immediately. No password, no verification.
- **Take a break** — `POST /unlock` with `{ "mode": "rest" }`: ends the lock and
  resets the continuous-work counter.

`budget.json` stores the current reason/counters so a restart does not silently
reset the state.

### Event feed and alerts

`events.js` owns a 50-entry ring buffer with sequence numbers seeded from
`Date.now()` (so a Host restart never makes the browser replay old events). It also
tracks live agent status for the `sessions` list and listens for:

- `agent/status`, `agent/disposed` → running-session set. Disposing the agent a
  focus block is bound to also stops that block (`owner-disposed`), so the UI can
  never stay bound to a conversation that no longer exists.
- `session/event` `turn/end` (`reason.kind === 'completed'`) → `task-completed`
  when `alerts.turnDone` is on.
- `goal/changed` with `operation === 'complete'` → completes the bound focus block,
  otherwise emits `task-completed` when `alerts.taskDone` is on.

The browser derives toasts and the chime from this ring; it never needs its own
timers for completion.

### Data files

| File | Contents |
| --- | --- |
| `settings.json` | Normalized v2 runtime settings (mode `0600`). No password data. |
| `focus.json` | Current focus block (phase, status, session id, task, timestamps, counters). |
| `budget.json` | Overtime-lock reason, since/unlockUntil timestamps, warning flags. |
| `usage/YYYY-MM-DD.jsonl` | One aggregate line per flush: `{ t, activeMs, apps }`. |
| `stats/YYYY-MM-DD.jsonl` | Per-day focus/break/unlock aggregates used by the settings chart. |

Writes are atomic (temporary file + rename) and serialized per file. Unknown or
corrupt JSON falls back to defaults instead of crashing the plugin. Files older
than `usage.retentionDays` are pruned for the `usage` and `stats` subdirectories.

### Settings model

- Runtime settings live in `settings.json`, **not** in the Cordis Config schema, so
  changing them never reloads or restarts the plugin.
- `normalizeSettings()` deep-merges any stored/partial object over
  `DEFAULT_SETTINGS` (v2 groups: `focus`, `limits`, `alerts`, `usage`), drops
  unknown keys (including stale v1 `lock`/`security` sections), then clamps every
  number/boolean and validates quiet hours (`HH:MM` or `null`).
- There is no secret section any more: the settings API returns exactly what the
  Host holds.

## HTTP API

Base: `/plugins/dsh-deep-focus/api` (same origin as the DSH Web GUI).

| Method | Route | Body | Result |
| --- | --- | --- | --- |
| GET | `/state` | — | Full v2 state snapshot (below). |
| GET | `/apps?days=7` | — | Per-app usage for the last N days (1–31); `top` is today's first 8 apps. |
| GET | `/stats?days=7` | — | Focus/break aggregates for the settings chart (1–90 days). |
| GET | `/settings` | — | Current settings. |
| POST | `/settings` | `{ settings?: partial }` | Normalized settings; unknown sections dropped. |
| POST | `/focus/start` | `{ task?, sessionId?, workMinutes? }` | `{ ok, state }`. |
| POST | `/focus/pause` | — | `{ ok, state }`. |
| POST | `/focus/resume` | — | `{ ok, state }`. |
| POST | `/focus/stop` | `{ reason? }` | `{ ok, state }` (does not count as completed). |
| POST | `/focus/complete` | — | `{ ok, state }` (marks the task done, starts the break). |
| POST | `/unlock` | `{}` or `{ mode: 'rest' }` | `{ ok, state }`; grants the grace window or ends the lock. |

`GET /state` returns exactly:

```jsonc
{
  "now": 0,
  "focus": { "phase": "idle", "status": "idle", "sessionId": null, "task": null,
             "endsAt": null, "remainingMs": 0, "elapsedMs": 0,
             "pomodorosToday": 0, "startedAt": null, "pauseCause": null,
             "sessionLive": null },
  "usage": { "activeTodayMs": 0, "continuousMs": 0,
             "sampling": "ok", "appsSampling": "ok", "dayKey": "" },
  "appsToday": { "totalMs": 0, "top": [{ "id": "chrome", "name": "浏览器", "ms": 0 }] },
  "lock": { "locked": false, "reason": null, "since": null, "unlockUntil": null,
            "unlockMinutes": 20, "canUnlock": false, "strict": false },
  "alerts": { "sound": true, "volume": 0.6, "quietHoursStart": null, "quietHoursEnd": null },
  "settings": { /* v2 settings */ },
  "sessions": [{ "id": "...", "running": true }],
  "events": [{ "seq": 0, "kind": "focus-started", "at": 0, "meta": {} }]
}
```

`GET /apps?days=7` returns:

```jsonc
{
  "ok": true,
  "retentionDays": 30,
  "days": [{ "day": "2026-11-05", "activeMs": 0,
             "apps": [{ "id": "chrome", "name": "浏览器", "ms": 0 }] }],
  "today": { "day": "2026-11-05", "activeMs": 0, "apps": [{ "id": "code", "name": "VS Code", "ms": 0 }] },
  "top": [{ "id": "chrome", "name": "浏览器", "ms": 0 }]
}
```

`top` is today's apps sorted descending, capped at 8 rows. Building the state snapshot re-evaluates
the budget, so a poll taken between budget ticks still observes a newly exceeded
limit. Responses are `cache-control: no-store`. Every route passes a trust check:
`sec-fetch-site: cross-site` is refused, a present `Origin` must match the request
authority (loopback ports may be omitted), and absent `Origin`/`Host` headers are
allowed for non-browser callers. JSON bodies are capped at 32 KiB; malformed JSON
gets a `400`, unknown paths a JSON `404`, wrong methods a `405` with `allow`, and
untrusted origins a `403`.

## Browser half

`src/client.js` is one file with no build step and no import beyond
`require('react')`:

```js
window.__ModuleLoader__.load({
  id: 'dsh-deep-focus',
  factory(require) {
    const React = require('react')
    return { inject: ['slots', 'locale'], apply(ctx) { /* slots + polling */ } }
  },
})
```

Slot registrations:

| Slot | Id | Contents |
| --- | --- | --- |
| `conversation.input.right` | `dsh-deep-focus-pill` | Status dot + countdown / phase; click toggles the focus panel. |
| `shell.overlay` | `dsh-deep-focus-panel` | Focus card: progress ring, task input, presets, start/pause/resume/stop, today's mini stats incl. top app. |
| `shell.overlay` | `dsh-deep-focus-toasts` | Completion / limit / unlock toasts. |
| `shell.overlay` | `dsh-deep-focus-lock` | Gentle overtime overlay: reason, today's usage, “Use 20 more minutes”, “Take a break”. No password field, no Escape dismissal. |
| `settings.section` | `deep-focus` | Grouped settings (focus/limits/alerts/usage), today summary, 7-day chart. |
| `sidebar.panellist` | `focus-stats` | **Usage** entry in the sidebar below the shipped rows, labeled 「使用统计」/「Usage」. |
| `main` | `focus-stats` (keyed) | Full central Usage panel: today total, per-app bars, 7-day trend, refresh, privacy note. |

The lock/overtime overlay only renders after the first successful `/state` fetch,
so a fresh page never flashes it.

**Focus mode is UI-only.** While a block runs and `focus.grayOutOtherSessions` is
on, the client dims non-owner session rows with reversible inline styles and adds a
capture-phase click/keyboard handler that blocks activation of those rows and shows
the gentle reminder toast instead. The focused conversation stays clickable. Clicks
inside the plugin's own `[data-dsh-deep-focus-root]` containers are skipped. No
tool, agent, or Host state is affected.

Polling is 1 s while the page is visible and 5 s while hidden, with a single shared
store and an in-flight guard. **Robustness:** after two consecutive failed polls
(fetch error or non-200) the client hides every element it renders, removes all
sidebar inline styles, and keeps retrying quietly in the background. A `404` means
the plugin was disabled/gone and switches the client to `disabled` immediately. The
navigable slots (settings section, sidebar Usage row, keyed main panel) are
registered only while the API is live and are disposed when it is not, so a
disabled Host leaves no dead sidebar rows or empty pages; the always-present slots
(pill, panel, toasts, overtime overlay) render nothing in that state. No stale
dimming, no swallowed clicks.

The chime is synthesized with Web Audio (two ascending tones), respects
`alerts.sound`, `alerts.volume` and quiet hours, unlocks the `AudioContext` on the
first user gesture, and fails silently when the browser blocks audio.

All listeners, observers, timers and styles are removed on `ctx.effect` cleanup.
The UI uses DSH theme tokens (`--dsw-alias-*`) only, follows `ctx.locale` for
English/Chinese, respects `prefers-reduced-motion`, and closes the focus panel with
Escape.

## Failure handling

| Failure | Behavior |
| --- | --- |
| Sampler unavailable (platform/permissions) | `sampling: "degraded"`/`"off"`; focus timer keeps working; UI shows the state instead of pretending. |
| Foreground app unavailable, idle time fine | App tracking reports `appsSampling: "off"`; total active time keeps counting. |
| API request fails (Host restarting / plugin disabled) | After two consecutive failures the client hides its UI and restores the sidebar, then keeps retrying. |
| Corrupt data file | Treated as missing: defaults/empty state. |
| Missing optional Host service | The related feature is skipped; the plugin does not throw into the Host. |
| Plugin disabled / HMR unload | Cleanups stop the sampler child, timers, HTTP routes and event listeners; the browser UI hides on the next failed poll. |

## Testing and verification

- `npm test` — `node --test` (auto-discovers `test/*.test.mjs`): pure functions for
  settings merge/clamp, per-app aggregation, app-name mapping, budget decisions and
  click-to-continue, day rollover, focus transitions with an injected clock,
  sampler line parsing (`idleMs|pid|exeName`). No DSH context required.
- `node scripts/verify.mjs` — offline packaging smoke: manifest/entry points,
  locale parity, icon XML, contract sanity (v2 shape, no `security`/`lock`
  sections), README/contract settings-table drift, v1-concept absence checks,
  import hygiene, workflow rules.
- `.github/workflows/ci.yml` — syntax check, tests and verification on Node 20/22.

## Compatibility assumptions

- Verified against DSH `0.2.2-rc.1` on Windows. The plugin relies only on public
  Host services (`agents`, `webServer`), Cordis events (`agent/status`,
  `agent/disposed`, `session/event`, `goal/changed`) and documented client slots
  (`conversation.input.right`, `shell.overlay`, `settings.section`,
  `sidebar.panellist`, `main`).
- macOS/Linux foreground sampling and the `sidebar.panellist`/`main` slots are
  implemented but not covered by the author's testing; unsupported paths degrade
  visibly instead of failing the plugin.
- The overtime overlay is a self-discipline nudge. Nothing is enforced: restarting
  DSH, disabling the plugin, or simply not enabling a limit always gets you out.
- v1 customers' data directories still load: v2 settings drop the removed
  `lock`/`security` sections, and legacy usage lines are read for their `ms` field
  where the new aggregate format is absent.
