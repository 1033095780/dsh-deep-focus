# Design

Architecture of `dsh-deep-focus` v0.3 for DeepSeek Harness. This document
describes the code in this repository; when behavior and prose disagree, the code
wins.

## Scope

v0.3 turns the plugin into a **focus assistant** for DSH. It does four things:

1. **Daily usage cap** — whole-machine active time while DSH runs, capped at
   `limits.dailyMinutes` (default 180 = 3 hours). When reached, DSH shows a gray
   overlay with today's total, per-app breakdown and a “Use 20 more minutes”
   extension action.
2. **Continuous-use cap → forced rest** — after `limits.continuousMinutes`
   (default 30) of continuous activity the assistant immediately starts a rest of
   `limits.restMinutes` (default 10); rest time is excluded from every counter.
3. **Focus assistant hub** — a sidebar panel below the Plugins row with the usage
   overview (today, per-app, 7-day trend), the settings form, and the
   enable/pause switch; a countdown chip sits in the DSH window's top-right.
4. **One conversation at a time (UI only, default on)** — while any root
   conversation's agent is running, the sidebar temporarily hides the other
   folders/conversations and restores them when it finishes.

**Pure-plugin boundary (by design, not a bug):** the plugin runs inside DSH and
only enforces inside DSH. It cannot bring DSH to the front, cannot block other
applications, cannot count usage while DSH is closed, and cannot draw outside the
DSH window. A companion desktop guard is a possible later phase and is not part of
v0.3.

Explicitly removed from earlier versions: the pomodoro timer (work/break blocks,
focus pill, 25/5 presets, focus routes/events, `src/host/focus.js`), tool blocking,
passwords, and the separate “Usage” sidebar entry.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/index.js` | Host plugin entry: wiring, timers, startup recovery, cleanup. |
| `src/host/storage.js` | Data directory, atomic JSON writes, append-only JSONL, per-file serialization, retention pruning. |
| `src/host/settings.js` | v3 settings merge/clamp; discards pre-v3 settings files. |
| `src/host/sampler.js` | Platform sampler: idle time **and** the foreground application. |
| `src/host/win32-idle.ps1` | Windows long-lived probe: idle ms + foreground pid/process name (ASCII only). |
| `src/host/apps.js` | Raw executable name → stable key + friendly display name. |
| `src/host/tracker.js` | Folds samples into total active time and per-app milliseconds; suppresses accumulation while resting. |
| `src/host/limits.js` | Daily cap, continuous cap, forced rest, extension windows, daily rollover. |
| `src/host/events.js` | Event ring buffer, agent status map, root-session tracking, completion alerts. |
| `src/host/api.js` | Same-origin JSON HTTP API under `/plugins/dsh-deep-focus/api`. |
| `src/client.js` | Self-contained browser half: assistant panel, countdown chip, overlays, solo hiding, settings, toasts. |
| `src/shared/contract.js` | Wire contract: routes, events, `DEFAULT_SETTINGS` (version 3). |
| `src/locale/{en,zh}.json` | Plugin metadata (`meta.title`, `meta.description`). |
| `src/icon.svg` | Plugin list icon. |
| `cordis.patch.yml` | Bundle patch that inserts the `dsh-deep-focus` Host row. |

There is no focus/pomodoro module in v0.3, and no tool-guard module.

No build step: the Host half is plain ESM and the browser half is a single
CommonJS-style factory file loaded by `window.__ModuleLoader__`.

## Host half

### Lifecycle

`src/index.js` exports `name`, `inject` (only the services it uses — `agents` and
`webServer`), and `apply(ctx)`. `apply` creates the pieces in dependency order,
registers listeners/timers/routes inside the plugin effect, and returns cleanups so
a disable/HMR unload leaves nothing running:

1. `createStorage()` → data directory (`$DSH_HOME/plugin-data/dsh-deep-focus`).
2. `createSettingsStore({ storage }).load()` → v3 settings.
3. `createSampler(...)` → idle + foreground-app samples.
4. `createTracker({ storage, settings })` → active totals and per-app buckets.
5. `createLimits({ settings, tracker, ring })` → daily/continuous/rest state.
6. `createEventRing()`, `createStatusMap()`, event listeners.
7. `registerApi({ ctx, api })` → web routes (no tool guard registration).
8. Timers: a 1 s limits/enforcement tick (finishes an elapsed rest and re-checks
   the caps even when the sampler stalls), a usage-flush check every 10 s (the
   tracker writes an aggregate at most once a minute), and daily retention
   pruning.
9. Startup recovery: load `limits.json`, prune old usage, resume sampling.

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
- **Rest suppression:** while `limits` reports a running rest, samples contribute
  neither to the daily total, the continuous counter, nor the app buckets, so rest
  time is excluded from usage as promised.
- When `usage.trackApps` is false only the total active time is kept.
- Aggregates are flushed roughly every 60 s to `usage/YYYY-MM-DD.jsonl`, one line
  per flush: `{ t, activeMs, apps: { exeKey: ms } }` (deltas since the previous
  flush), so a day stays around 288 lines. Retention pruning removes old day files.

### Limits and forced rest

`src/host/limits.js` is a small state machine evaluated on every sample and by the
limiter tick:

| Field | Meaning |
| --- | --- |
| `assistant.enabled` | Master switch; when off the plugin only measures, never enforces. |
| `limits.dailyMinutes` | Daily whole-machine active cap; `0` = no cap. |
| `limits.continuousMinutes` | Continuous-use cap; `0` = no forced rest. |
| `limits.restMinutes` | Forced-rest length (minimum 1 minute). |
| `limits.extendMinutes` | Time granted by one “Use 20 more minutes” click. |
| `limits.dailyExtendLimit` | Extensions per day; `0` = no extensions. |

- Active time while not resting adds to both `usage.activeTodayMs` and
  `usage.continuousMs`.
- **Continuous cap:** when `continuousMs >= continuousMinutes`, the assistant
  immediately enters a rest (`resting: true`, `restUntil`, event `rest-started`),
  resets the continuous counter, and the tracker suppresses further accumulation
  until the rest ends (`rest-finished`). A `rest-due` event fires once at 80 % of
  the continuous limit as an early warning.
- **Daily cap:** when `activeTodayMs >= dailyMinutes` and no extension grace window
  is active, `dailyLocked` becomes true and a `daily-locked` event fires once. The
  client shows the gray overlay.
- **Extension:** `POST /extend` sets `extendedUntil = now + extendMinutes`,
  increments `extendCountToday`, clears `dailyLocked`, and emits `extended`. It
  refuses with `not-locked` or `extend-limit-reached`.
- **Rollover:** at local midnight the daily lock, extension window and extension
  count reset; the rest state is transient and simply finishes.
- **Switch changes:** turning the assistant off ends any rest, clears the daily
  lock, and emits `assistant-off`; turning it on emits `assistant-on` and
  re-evaluates.
- `limits.json` stores the transient lock/rest state so a restart does not lose a
  running rest or today's extension count.

### Event feed and alerts

`events.js` owns a 50-entry ring buffer with sequence numbers seeded from
`Date.now()` (so a Host restart never makes the browser replay old events). It also
tracks the live agent status map (used by the API's root-session list for
`sessions`/`solo`) and listens for:

- `agent/status`, `agent/disposed` → running-session map.
- `session/event` `turn/end` (`reason.kind === 'completed'`) → `task-completed`
  when `alerts.taskDone` is on (the only remaining toast/chime alert).
- `goal/changed` with `operation === 'complete'` → `task-completed` when
  `alerts.taskDone` is on.

The API computes `sessions` from `ctx.agents.roots()` (root conversations only) and
cross-references the status map; subagent and teammate sessions never appear.

The event kinds in the contract are `rest-due`, `rest-started`, `rest-finished`,
`daily-locked`, `extended`, `assistant-off`, `assistant-on` (plus the
`task-completed` alert).

### Data files

| File | Contents |
| --- | --- |
| `settings.json` | Normalized v3 runtime settings (mode `0600`). No secrets. |
| `limits.json` | Daily lock, extension window/count, rest state (transient). |
| `usage/YYYY-MM-DD.jsonl` | One aggregate line per flush: `{ t, activeMs, apps }`. |

Writes are atomic (temporary file + rename) and serialized per file. Unknown or
corrupt JSON falls back to defaults instead of crashing the plugin. Files older
than `usage.retentionDays` are pruned for the `usage` subdirectory (and any legacy
`stats/` files left by earlier versions).

### Settings model

- Runtime settings live in `settings.json`, **not** in the Cordis Config schema, so
  changing them never reloads or restarts the plugin.
- v3 groups: `limits`, `assistant`, `alerts`, `usage`.
- `normalizeSettings()` deep-merges over `DEFAULT_SETTINGS`, drops unknown
  sections/keys, and clamps numbers/booleans and quiet hours.
- **Migration:** a stored file whose `version` is not 3 (v1/v2) is discarded and
  replaced with v3 defaults — a stale 480-minute cap from an older schema can never
  re-enable a rule the user did not choose.

## HTTP API

Base: `/plugins/dsh-deep-focus/api` (same origin as the DSH Web GUI).

| Method | Route | Body | Result |
| --- | --- | --- | --- |
| GET | `/state` | — | Full v3 state snapshot (below). |
| GET | `/apps?days=7` | — | Per-app usage for the last N days (1–31). |
| GET | `/settings` | — | Current v3 settings. |
| POST | `/settings` | `{ settings?: partial }` | Normalized settings; unknown sections dropped. |
| POST | `/assistant` | `{ enabled: boolean }` | Toggles enforcement; `{ ok, state }`. |
| POST | `/rest/start` | `{}` | Starts/refreshes a rest; 409 `already-resting` / `assistant-off`. |
| POST | `/rest/finish` | `{}` | Ends a rest early (continuous quota already reset); 409 `not-resting`. |
| POST | `/extend` | `{}` | Grants the extension window; 409 `not-locked` / `extend-limit-reached`. |

`GET /state` returns exactly:

```jsonc
{
  "now": 0,
  "usage": { "activeTodayMs": 0, "continuousMs": 0,
             "sampling": "ok", "appsSampling": "ok", "dayKey": "" },
  "appsToday": { "totalMs": 0, "top": [{ "id": "chrome", "name": "浏览器", "ms": 0 }] },
  "limit": {
    "assistantEnabled": true,
    "dailyLimitMs": 10800000, "dailyUsedMs": 0, "dailyLocked": false,
    "extendedUntil": null, "extendCountToday": 0, "extendLimit": 2,
    "continuousLimitMs": 1800000, "continuousUsedMs": 0,
    "restDue": false, "resting": false, "restUntil": null, "restRemainingMs": 0
  },
  "settings": { /* v3 settings */ },
  "sessions": [{ "id": "...", "running": true }],
  "solo": { "active": false, "sessions": [] },
  "events": [{ "seq": 0, "kind": "rest-started", "at": 0, "meta": {} }]
}
```

`sessions` lists **root conversations only** (subagent/teammate sessions never
appear); `solo.active` is true when at least one root conversation has a running
agent, and `solo.sessions` lists their ids.

`GET /apps?days=7` is unchanged from v0.2:

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
snapshot re-evaluates the limits first, so a poll between ticks still finishes an
elapsed rest and observes a newly reached cap. Responses are `cache-control:
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
| `main` (keyed) | `focus-assistant` | Assistant page: overview (daily/continuous progress, rest status, per-app today, 7-day trend), settings form, enable/pause switch. |
| `conversation.session.header.utilities` | `dsh-deep-focus-countdown` | Top-right countdown chip: continuous remaining, rest remaining, or “today's cap used up”; hidden when the assistant is off. |
| `shell.overlay` | `dsh-deep-focus-daily-lock` | Gray daily overlay: today's total, per-app rows, “Use 20 more minutes” (with remaining extensions), quiet “That's it for today” (a per-day `localStorage` acknowledgment, no data). |
| `shell.overlay` | `dsh-deep-focus-rest` | Full-frame forced-rest screen with the rest countdown and breathing copy; no dismiss button — it disappears when the Host finishes the rest. |
| `shell.overlay` | `dsh-deep-focus-solo-banner` | Soft banner while solo mode is hiding the sidebar. |
| `shell.overlay` | `dsh-deep-focus-toasts` | Completion / rest / extension toasts. |

The assistant page is the single settings surface in v0.3; the separate
`settings.section` and the old “Usage” panel are gone.

**One conversation at a time is a style injection, not DOM surgery.** While
`solo.active` and `assistant.soloSession` + `assistant.hideOtherSessions` are on,
the client sets one `<style>` node plus a `data-dsh-focus-solo` attribute on
`<html>` that hides session/folder rows other than the running root sessions, and
shows the banner. Nothing is rewritten inline on host elements; removing the style
node / attribute restores everything synchronously on outage, 404, or cleanup. No
tool, agent, or Host state is affected.

Polling is 1 s while the page is visible and 5 s while hidden, with a single shared
store and an in-flight guard. **Robustness:** after two consecutive failed polls
(fetch error or non-200) the client hides every element it renders and restores the
solo styles; a `404` means the plugin was disabled/gone and switches the client to
`disabled` immediately. Navigable slots (assistant row, keyed page) are registered
only while the API is live and disposed when it is not, so a disabled Host leaves no
dead sidebar rows or empty pages.

The chime is synthesized with Web Audio and only used for completion alerts
(`alerts.taskDone`); it respects volume and quiet hours, unlocks the `AudioContext`
on the first user gesture, and fails silently when blocked. All listeners,
observers, timers and styles are removed on `ctx.effect` cleanup. The UI uses DSH
theme tokens (`--dsw-alias-*`) only, follows `ctx.locale` for English/Chinese,
respects `prefers-reduced-motion`, and labels interactive elements for screen
readers.

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
  settings merge/clamp and v3 migration, per-app aggregation, app-name mapping,
  limits/rest transitions (continuous → rest, rest excludes usage, auto-finish,
  daily lock + extend + extend limit + rollover, assistant off), root-session
  selection, sampler line parsing. No DSH context required.
- `node scripts/verify.mjs` — offline packaging smoke: manifest/entry points,
  locale parity, icon XML, v3 contract sanity, no pomodoro strings in `src/`,
  README/contract settings-table drift, README must state the v0.3 rules and the
  pure-plugin boundary, local-link integrity, workflow rules.
- `.github/workflows/ci.yml` — syntax check, tests and verification on Node 20/22.

## Compatibility assumptions

- Verified against DSH `0.2.2-rc.1` on Windows. The plugin relies only on public
  Host services (`agents`, `webServer`), Cordis events (`agent/status`,
  `agent/disposed`, `session/event`, `goal/changed`) and documented client slots
  (`sidebar.panellist`, keyed `main`, `conversation.session.header.utilities`,
  `shell.overlay`).
- macOS/Linux foreground sampling, the header countdown slot, and the solo hiding
  rules are implemented but not covered by the author's testing; unsupported paths
  degrade visibly instead of failing the plugin.
- v1/v2 data directories remain readable where the format is compatible
  (`usage/*.jsonl`), while `settings.json` is intentionally not migrated: a v1/v2
  settings file is replaced by v3 defaults.
- The assistant is a self-discipline aid. Nothing is enforced outside DSH:
  restarting DSH, disabling the plugin, or switching applications always gets you
  out.
