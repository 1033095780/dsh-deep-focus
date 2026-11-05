# Design

Architecture of `dsh-deep-focus` v0.4 for DeepSeek Harness. This document
describes the code in this repository; when behavior and prose disagree, the code
wins.

## Scope

v0.4 is a UX pass over the v0.3 focus assistant. The product rules are the same —
daily cap, continuous cap with a forced rest, per-app statistics, one conversation
at a time, pure plugin — with these additions:

1. **Floating two-ring widget** in the top-right of the DSH window (today's usage,
   continuous use), replacing the old header countdown chip.
2. **Pause mode** — clicking the rings stops counting and grays the DSH window; the
   pause ends only on real keyboard/mouse activity (with a short grace period so the
   initiating click does not count).
3. **Activity-gated rest** — a forced rest finishes only when its timer elapsed
   **and** the user is back; while away it keeps waiting (capped at 30 extra
   minutes), and 「跳过休息」 skips it.
4. **Daily overlay skip** — the gray overlay keeps 「再使用 20 分钟」 and adds
   「跳过」.
5. **Away-only repeating completion chime** — silent while you are actively
   watching; when away it repeats at `alerts.repeatIntervalMs` until input returns.
6. **Smooth solo hiding** — one-conversation mode now hides conversations **and**
   workspace folders with a fade animation, and the old banner text is gone.

**Pure-plugin boundary (by design, not a bug):** the plugin runs inside DSH and
only enforces inside DSH. It cannot bring DSH to the front, cannot block other
applications, cannot count usage while DSH is closed, and cannot draw outside the
DSH window. A companion desktop guard is a possible later phase and is not part of
v0.4.

Explicitly removed from earlier versions: the pomodoro timer (work/break blocks,
focus pill, presets, focus routes/events, `src/host/focus.js`), tool blocking,
passwords, the separate “Usage” sidebar entry, the header countdown chip and the
solo banner.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/index.js` | Host plugin entry: wiring, timers, startup recovery, cleanup. |
| `src/host/storage.js` | Data directory, atomic JSON writes, append-only JSONL, per-file serialization, retention pruning. |
| `src/host/settings.js` | v4 settings merge/clamp; discards pre-v4 settings files. |
| `src/host/sampler.js` | Platform sampler: idle time **and** the foreground application. |
| `src/host/win32-idle.ps1` | Windows long-lived probe: idle ms + foreground pid/process name (ASCII only). |
| `src/host/apps.js` | Raw executable name → stable key + friendly display name. |
| `src/host/tracker.js` | Folds samples into total active time and per-app milliseconds; suppresses accumulation while paused or resting. |
| `src/host/limits.js` | Daily cap, continuous cap, forced rest (activity-gated), pause mode, extension windows, daily rollover. |
| `src/host/events.js` | Event ring buffer, agent status map, completion alerts. |
| `src/host/api.js` | Same-origin JSON HTTP API under `/plugins/dsh-deep-focus/api`. |
| `src/client.js` | Self-contained browser half: assistant panel, floating rings, pause/rest/daily overlays, animated solo hiding, toasts. |
| `src/shared/contract.js` | Wire contract: routes, events, `DEFAULT_SETTINGS` (version 4). |
| `src/locale/{en,zh}.json` | Plugin metadata (`meta.title`, `meta.description`). |
| `src/icon.svg` | Plugin list icon. |
| `cordis.patch.yml` | Bundle patch that inserts the `dsh-deep-focus` Host row. |

There is no focus/pomodoro module, no tool-guard module, and no solo banner.

No build step: the Host half is plain ESM and the browser half is a single
CommonJS-style factory file loaded by `window.__ModuleLoader__`.

## Host half

### Lifecycle

`src/index.js` exports `name`, `inject` (only `agents` and `webServer`), and
`apply(ctx)`. `apply` creates the pieces in dependency order, registers
listeners/timers/routes inside the plugin effect, and returns cleanups so a
disable/HMR unload leaves nothing running:

1. `createStorage()` → data directory (`$DSH_HOME/plugin-data/dsh-deep-focus`).
2. `createSettingsStore({ storage }).load()` → v4 settings.
3. `createSampler(...)` → idle + foreground-app samples.
4. `createTracker({ storage, settings })` → active totals and per-app buckets.
5. `createLimits({ settings, tracker, ring })` → daily/continuous/rest/pause state.
6. `createEventRing()`, `createStatusMap()`, event listeners.
7. `registerApi({ ctx, api })` → web routes (no tool guard registration).
8. Timers: a 1 s limits tick and a 10 s usage-flush check (the tracker writes an
   aggregate at most once a minute), plus daily retention pruning.
9. Startup recovery: load `limits.json`, prune old usage, resume sampling.

The sampler callback resolves state first: `limits.evaluate()` → `limits.applySample()`
(which can end a pause or an elapsed rest) → `tracker.sample(sample, at, { counted })`
→ `limits.evaluate()` again, so a sample that reaches the continuous cap starts the
rest immediately and paused/resting periods never add active or app time.

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
  frontmost application with `osascript` (best effort). Linux runs `xprintidle` and
  `xdotool getactivewindow getwindowpid` + `/proc/<pid>/comm` (best effort).
- Sampler states: `ok`, `degraded` (temporary failure, retrying), `off`
  (unsupported platform or repeated failure). Restarts use exponential backoff
  (1 s → 30 s, capped), a watchdog restarts the Windows child when three intervals
  pass with no sample, and four consecutive failed starts stop sampling for the
  session. Failures degrade gracefully; none crash the plugin.

### Per-application aggregation

- `src/host/apps.js` maps raw executable names (case-insensitive) to a stable key
  and a friendly display name: browsers, QQ, WeChat, VS Code, Cursor, DeepSeek
  Harness, Windows Terminal / PowerShell, Explorer, Notion, Feishu, DingTalk,
  Spotify, Bilibili, VLC, and so on. Unknown executables use their base name as
  both key and label.
- The tracker counts time only when the idle time is below
  `usage.idleThresholdSeconds`; that time is added to the day total and to the
  current app's bucket. Idle samples end the continuous-work run.
- **Pause/rest suppression:** while `limits` reports a running rest or an active
  pause, samples contribute neither to the daily total, the continuous counter, nor
  the app buckets (`tracker.sample(..., { counted: false })`).
- When `usage.trackApps` is false only the total active time is kept.
- Aggregates are flushed roughly every 60 s to `usage/YYYY-MM-DD.jsonl`, one line
  per flush: `{ t, activeMs, apps: { exeKey: ms } }` (deltas since the previous
  flush), so a day stays around 288 lines. Retention pruning removes old day files.

### Limits, pause and forced rest

`src/host/limits.js` is a small state machine evaluated on every sample and by the
1 s tick:

| Field | Meaning |
| --- | --- |
| `assistant.enabled` | Master switch; when off the plugin only measures, never enforces. |
| `limits.dailyMinutes` | Daily whole-machine active cap; `0` = no cap. |
| `limits.continuousMinutes` | Continuous-use cap; `0` = no forced rest. |
| `limits.restMinutes` | Forced-rest length (minimum 1 minute). |
| `limits.extendMinutes` | Time granted by one 「再使用 20 分钟」 click. |
| `limits.dailyExtendLimit` | Extensions per day; `0` = no extensions. |

- **Pause mode:** `POST /pause` sets `paused`/`pausedAt`, stops counting, and emits
  `paused`. The pause resumes only on a sampler sample that is active (idle below
  `usage.idleThresholdSeconds`) and arrives at least 1.5 s after `pausedAt` — so the
  click that entered pause is ignored. `POST /resume` also force-resumes; `paused`
  and `pausedNeedsActivity` are exposed in `/state`. A forced rest supersedes a
  pause (rest wins and clears it).
- **Continuous cap:** when continuous use reaches `continuousMinutes`, the assistant
  immediately enters a rest (`resting: true`, `restUntil`, event `rest-started`),
  resets the continuous counter, and the tracker suppresses accumulation. A
  `rest-due` event fires once at 80 % as an early warning.
- **Activity-gated rest:** a rest finishes only when `restUntil` has elapsed **and**
  real activity was seen after `restUntil` (`rest-finished` with
  `reason: "elapsed-and-active"`). While the machine stays idle the rest keeps
  waiting and `restNeedsActivity: true` is exposed; a 30-minute cap after
  `restUntil` ends it anyway so it can never get stuck. Rest time is excluded from
  every counter.
- **Skip rest:** `POST /rest/finish` ends a running rest immediately with
  `rest-finished` `{ early: true, reason: "skipped" }` (409 `not-resting`).
- **Daily cap:** when `activeTodayMs >= dailyMinutes` and no extension grace window
  is active, `dailyLocked` becomes true and a `daily-locked` event fires once. The
  daily cap is evaluated before the continuous cap, so a lock and a forced rest do
  not stack.
- **Extension:** `POST /extend` sets `extendedUntil = now + extendMinutes`,
  increments `extendCountToday`, clears `dailyLocked`, and emits `extended`; it
  refuses with `not-locked` / `extend-limit-reached`. The overlay's 「跳过」 is a
  client-side per-day acknowledgment, not an endpoint.
- **Rollover:** at local midnight the daily lock, extension window and extension
  count reset.
- **Switch changes:** turning the assistant off ends any rest, clears the daily lock
  and pause, and emits `assistant-off`; turning it on emits `assistant-on` and
  re-evaluates.
- `limits.json` stores the transient lock/rest/pause state so a restart does not
  lose a running rest, an active pause, or today's extension count.

### Event feed and alerts

`events.js` owns a 50-entry ring buffer with sequence numbers seeded from
`Date.now()` (so a Host restart never makes the browser replay old events). It also
tracks the live agent status map (used by the API's root-session list for
`sessions`/`solo`) and listens for:

- `agent/status`, `agent/disposed` → running-session map.
- `session/event` `turn/end` (`reason.kind === 'completed'`) → `task-completed`.
- `goal/changed` with `operation === 'complete'` → `task-completed`.

The browser decides whether the completion chime actually sounds (only when away).
The event kinds are `task-completed`, `paused`, `resumed`, `rest-due`,
`rest-started`, `rest-finished`, `daily-locked`, `extended`, `assistant-off` and
`assistant-on`.

### Data files

| File | Contents |
| --- | --- |
| `settings.json` | Normalized v4 runtime settings (mode `0600`). No secrets. |
| `limits.json` | Daily lock, extension window/count, rest state and pause state (transient). |
| `usage/YYYY-MM-DD.jsonl` | One aggregate line per flush: `{ t, activeMs, apps }`. |

Writes are atomic (temporary file + rename) and serialized per file. Unknown or
corrupt JSON falls back to defaults instead of crashing the plugin. Files older
than `usage.retentionDays` are pruned for the `usage` subdirectory (and any legacy
`stats/` files left by earlier versions).

### Settings model

- Runtime settings live in `settings.json`, **not** in the Cordis Config schema, so
  changing them never reloads or restarts the plugin.
- v4 groups: `limits`, `assistant`, `alerts`, `usage`.
  - `assistant.showRings` replaced `assistant.showCountdown`.
  - `alerts` gained `repeatUntilActive` (bool), `repeatIntervalMs` (clamped
    500–10000) and `awayIdleSeconds` (clamped 10–3600); `alerts.taskDone` was
    removed (the completion chime is governed by `alerts.sound` and the away/repeat
    settings).
- `normalizeSettings()` deep-merges over `DEFAULT_SETTINGS`, drops unknown
  sections/keys, and clamps numbers/booleans and quiet hours.
- **Migration:** a stored file whose `version` is not 4 (v1/v2/v3) is discarded and
  replaced with v4 defaults.

## HTTP API

Base: `/plugins/dsh-deep-focus/api` (same origin as the DSH Web GUI).

| Method | Route | Body | Result |
| --- | --- | --- | --- |
| GET | `/state` | — | Full v4 state snapshot (below). |
| GET | `/apps?days=7` | — | Per-app usage for the last N days (1–31, today live). |
| GET | `/settings` | — | Current v4 settings. |
| POST | `/settings` | `{ settings?: partial }` | Normalized settings; unknown sections dropped. |
| POST | `/assistant` | `{ enabled: boolean }` | Toggles enforcement; `{ ok, state }`. |
| POST | `/pause` | `{}` | Stops counting and grays; 409 `already-paused` / `already-resting` / `assistant-off`. |
| POST | `/resume` | `{}` | Force-resumes a pause; 409 `not-paused`. |
| POST | `/rest/start` | `{}` | Starts a manual rest; 409 `already-resting` / `assistant-off`. |
| POST | `/rest/finish` | `{}` | Skips the rest (`early: true`, reason `skipped`); 409 `not-resting`. |
| POST | `/extend` | `{}` | Grants the extension window; 409 `not-locked` / `extend-limit-reached`. |

`GET /state` returns exactly:

```jsonc
{
  "now": 0,
  "usage": { "activeTodayMs": 0, "continuousMs": 0,
             "sampling": "ok", "appsSampling": "ok", "dayKey": "",
             "idleMs": null, "away": false },
  "appsToday": { "totalMs": 0, "top": [{ "id": "chrome", "name": "浏览器", "ms": 0 }] },
  "limit": {
    "assistantEnabled": true,
    "dailyLimitMs": 10800000, "dailyUsedMs": 0, "dailyLocked": false,
    "extendedUntil": null, "extendCountToday": 0, "extendLimit": 2,
    "continuousLimitMs": 1800000, "continuousUsedMs": 0,
    "restDue": false, "resting": false, "restUntil": null, "restRemainingMs": 0,
    "restNeedsActivity": false,
    "paused": false, "pausedAt": null, "pausedNeedsActivity": false
  },
  "settings": { /* v4 settings */ },
  "sessions": [{ "id": "...", "running": true }],
  "solo": { "active": false, "sessions": [] },
  "events": [{ "seq": 0, "kind": "rest-started", "at": 0, "meta": {} }]
}
```

`sessions` lists **root conversations only** (subagent/teammate sessions never
appear); `solo.active` is true when at least one root conversation has a running
agent, and `solo.sessions` lists their ids. `usage.idleMs` is the last sampled idle
time and `usage.away` applies `alerts.awayIdleSeconds` to it, so the browser can
decide whether the completion chime should sound. When the plugin reloaded
mid-turn, `buildState()` reconciles a missed "running" flag from the durable
session log's open-turn boundary (upgrades only; a live status event is never
downgraded).

`GET /apps?days=7` is unchanged from v0.x:

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

`top` is today's apps sorted descending, capped at 8 rows. Building the state
snapshot re-evaluates the limits first, so a poll between ticks still ends an
elapsed rest or observes a newly reached cap. Responses are `cache-control:
no-store`. Every route passes a trust check: `sec-fetch-site: cross-site` is
refused, a present `Origin` must match the request authority (loopback ports may be
omitted), and absent `Origin`/`Host` headers are allowed for non-browser callers.
JSON bodies are capped at 32 KiB; malformed JSON gets a `400`, unknown paths a JSON
`404`, wrong methods a `405` with `allow`, and untrusted origins a `403`.

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
| `sidebar.panellist` | `focus-assistant` | 「专注助手」/“Focus assistant” entry below the Plugins row. |
| `main` (keyed) | `focus-assistant` | Assistant page: overview (daily/continuous progress, pause/rest status, per-app today, 7-day trend), settings form, enable/pause switch. |
| `shell.overlay` | `dsh-deep-focus-rings` | Floating top-right glass card with two SVG rings (today vs. daily cap, continuous vs. continuous cap) and a small label; click enters pause. Hidden when the assistant is off or the two-ring setting is off. |
| `shell.overlay` | `dsh-deep-focus-pause-gray` | Full-frame semi-transparent gray pause layer (`pointer-events: none` so it cannot trap the click): 「已暂停计时 · 动一下鼠标或键盘继续」. |
| `shell.overlay` | `dsh-deep-focus-rest` | Full-frame forced-rest screen with the countdown, `restNeedsActivity` copy and the 「跳过休息」 button. |
| `shell.overlay` | `dsh-deep-focus-daily-lock` | Gray daily overlay: today's total, per-app rows, 「再使用 20 分钟」 and 「跳过」 (per-day `localStorage` acknowledgment). |
| `shell.overlay` | `dsh-deep-focus-toasts` | Completion / rest / extension / pause toasts. |

There is **no** `conversation.session.header.utilities` chip and **no** solo banner
any more.

**Pause flow:** clicking the rings `POST /pause`s and the client records the pause
time; the gray layer renders from `limit.paused`. The client adds a one-shot
`mousemove`/`keydown` listener after a 1.5 s grace and calls `POST /resume` when it
fires; the Host also auto-resumes on its own activity sample, so whichever arrives
first ends the pause. The layer clears when `limit.paused` becomes false, and on
outage/cleanup.

**Rest flow:** the rest overlay renders from `limit.resting`; when
`restNeedsActivity` is true it shows 「休息完成 · 动一下鼠标键盘继续」 instead of a
running countdown. The 「跳过休息」 button calls `POST /rest/finish`. The Host ends
the rest only after its time elapsed **and** activity was observed (or the 30-minute
cap), so the overlay cannot disappear while the user is away.

**Daily flow:** the overlay renders from `limit.dailyLocked`; 「再使用 20 分钟」
calls `POST /extend`, 「跳过」 writes the per-day ack key and hides the overlay
locally.

**One conversation at a time is a style injection, not DOM surgery.** While
`solo.active` and `assistant.soloSession` + `assistant.hideOtherSessions` are on,
the client hides session **and** workspace rows other than the running root
sessions with one `<style>` node plus a timestamped `data-dsh-focus-solo` attribute
on `<html>`. The attribute walks through `pre` → `out` (CSS transition fades
opacity/max-height over ~220 ms) → `hidden` (`display: none`); restoring plays
`in` → removed. It is timer-based, idempotent, cleared on outage/404/cleanup, and
instant under `prefers-reduced-motion`. No host element gets inline styles, and
there is no banner text.

Polling is 1 s while the page is visible and 5 s while hidden, with a single shared
store and an in-flight guard. **Robustness:** after two consecutive failed polls
(fetch error or non-200) the client hides every element it renders and restores the
solo styles; a `404` means the plugin was disabled/gone and switches the client to
`disabled` immediately. Navigable slots (assistant row, keyed page) are registered
only while the API is live and disposed when it is not.

**Completion chime:** the client decides whether the user is away from
`document.hidden`/focus and the machine idle time in `state.usage` (idle hint) —
chime only when away, repeat every `alerts.repeatIntervalMs` until
`mousemove`/`keydown`/focus, controlled by `alerts.sound`, `alerts.volume`,
`alerts.repeatUntilActive` and quiet hours. One persistent toast is allowed; the
chime is synthesized with Web Audio, unlocked on the first user gesture, and fails
silently when blocked. The old `alerts.taskDone` toggle is gone.

All listeners, observers, timers and styles are removed on `ctx.effect` cleanup. The
UI uses DSH theme tokens (`--dsw-alias-*`) only, follows `ctx.locale` for
English/Chinese, respects `prefers-reduced-motion`, and labels interactive elements
for screen readers.

## Failure handling

| Failure | Behavior |
| --- | --- |
| Sampler unavailable (platform/permissions) | `sampling: "degraded"`/`"off"`; limits still evaluate what was measured; UI shows the state instead of pretending. |
| Foreground app unavailable, idle time fine | App tracking reports `appsSampling: "off"`; total active time keeps counting. |
| API request fails (Host restarting / plugin disabled) | After two consecutive failures the client hides its UI and restores the sidebar, then keeps retrying. |
| Corrupt data file | Treated as missing: defaults/empty state. |
| Missing optional Host service | The related feature is skipped; the plugin does not throw into the Host. |
| Plugin disabled / HMR unload | Cleanups stop the sampler child, timers, HTTP routes and event listeners; the browser UI hides on the next failed poll. |

## Testing and verification

- `npm test` — `node --test` (auto-discovers `test/*.test.mjs`): pure functions for
  settings merge/clamp and v4 migration, per-app aggregation, app-name mapping,
  limits/rest transitions (continuous → rest, activity-gated rest, 30-minute cap,
  rest excludes usage, daily lock + extend + extend limit + rollover, assistant off),
  pause behavior (auto-resume only after activity + grace, forced resume), root
  session selection, sampler line parsing. No DSH context required.
- `node scripts/verify.mjs` — offline packaging smoke: manifest/entry points,
  locale parity, icon XML, v4 contract sanity (version 4, new repeat/rings keys, old
  chip/banner keys gone), no pomodoro code, no old header-chip/banner strings in
  `src/`, README/contract settings-table drift, README must state the v0.3 rules and
  the v0.4 UX plus the pure-plugin boundary, local-link integrity, workflow rules.
- `.github/workflows/ci.yml` — syntax check, tests and verification on Node 20/22.

## Compatibility assumptions

- Verified against DSH `0.2.2-rc.1` on Windows. The plugin relies only on public
  Host services (`agents`, `webServer`), Cordis events (`agent/status`,
  `agent/disposed`, `session/event`, `goal/changed`) and documented client slots
  (`sidebar.panellist`, keyed `main`, `shell.overlay`).
- macOS/Linux foreground sampling and the solo-hiding DOM rules are implemented but
  not covered by the author's testing; unsupported paths degrade visibly instead of
  failing the plugin.
- v1–v3 data directories remain readable where the format is compatible
  (`usage/*.jsonl`); `settings.json` is intentionally not migrated, and the old
  `focus.json`/`budget.json`/`stats/` files are ignored/pruned.
- The assistant is a self-discipline aid. Nothing is enforced outside DSH:
  restarting DSH, disabling the plugin, or switching applications always gets you
  out.
