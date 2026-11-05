# Design

Architecture of `dsh-deep-focus` for DeepSeek Harness. This document describes the
code in this repository; when behavior and prose disagree, the code wins.

## Scope

The plugin joins four things into one loop:

1. **Focus state machine** — pomodoro work/break blocks with pause/resume and
   deadline-based recovery.
2. **Whole-machine activity measurement** — how much time the machine is actually
   in use while DSH runs.
3. **Budget lock** — daily active, continuous work and single-session caps; a lock
   overlay plus a Host-enforced tool-call denial.
4. **One-conversation lock** — while a focus block or agent turn is active, only the
   owner conversation may call tools.

Non-goals: tracking time while DSH is closed, blocking the operating system,
parental-control-grade enforcement, cross-device sync.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/index.js` | Host plugin entry: `apply(ctx, config)`, `inject`, wiring and cleanup. |
| `src/host/storage.js` | Data directory, atomic JSON writes, append-only JSONL, per-file write serialization, retention pruning. |
| `src/host/settings.js` | Settings merge/clamp against the contract, scrypt password storage, public (hash-free) view. |
| `src/host/sampler.js` | Platform idle-time sampler (`ok` / `degraded` / `off`) with restart backoff. |
| `src/host/win32-idle.ps1` | Windows long-lived idle probe used by the sampler. |
| `src/host/tracker.js` | Folds idle samples into active time, per-day buckets and the continuous-work counter. |
| `src/host/focus.js` | Focus/break state machine, deadline recovery, idle auto-pause, events. |
| `src/host/budget.js` | Limit evaluation, lock state, grace windows, password and rest unlocks. |
| `src/host/lock.js` | Synchronous tool guard (hard boundary) + stable denial codes. |
| `src/host/events.js` | Event ring buffer, agent status map, turn/goal completion listeners. |
| `src/host/api.js` | Same-origin JSON HTTP API under `/plugins/dsh-deep-focus/api`. |
| `src/client.js` | Self-contained browser half: pill, panel, lock overlay, settings page, sounds, sidebar lock. |
| `src/shared/contract.js` | Wire contract: routes, phases, events, lock reasons, `DEFAULT_SETTINGS`, settings merge helpers. |
| `src/locale/{en,zh}.json` | Plugin metadata (`meta.title`, `meta.description`). |
| `src/icon.svg` | Plugin list icon. |
| `cordis.patch.yml` | Bundle patch that inserts the `dsh-deep-focus` Host row. |

No build step: the Host half is plain ESM and the browser half is a single
CommonJS-style factory file loaded by `window.__ModuleLoader__`.

## Host half

### Lifecycle

`src/index.js` exports:

```js
export const name = 'dsh-deep-focus'
export const inject = ['tools', 'agents', 'webServer']
export function apply(ctx) { /* ... */ }
```

`apply` creates the pieces in dependency order, registers every listener, timer and
route inside the plugin effect, and returns cleanups so a disable/HMR unload leaves
nothing running:

1. `createStorage()` → data directory (`$DSH_HOME/plugin-data/dsh-deep-focus`).
2. `createSettingsStore({ storage }).load()` → runtime settings.
3. `createSampler(...)` → idle samples.
4. `createTracker({ storage, settings })` → activity counters.
5. `createEventRing()`, `createStatusMap()`, `installHostEventListeners(...)`.
6. `createFocus(...)`, `createBudget(...)`.
7. `registerToolGuard({ ctx, getView })`.
8. `registerApi({ ctx, ... })` → web routes.
9. Timers: a 1 s focus tick, a 2 s budget evaluation, a 10 s usage flush, and a
   daily retention prune.
10. Startup recovery: load `focus.json` / `budget.json`, settle an over-deadline
    block once, and resume sampling.

If an optional service is missing, the plugin degrades (for example no web routes
when `webServer` is unavailable) instead of throwing.

### Time and sampling

- The sampler emits **idle milliseconds** every `usage.sampleSeconds` (clamped to
  3–30 s). It never reads input content.
- Windows uses one long-lived `powershell.exe -NoProfile -NonInteractive
  -ExecutionPolicy Bypass -File win32-idle.ps1` child that prints one idle value
  per interval; the sample interval is passed through an environment variable, not
  a shell string.
- macOS runs `ioreg -c IOHIDSystem` and parses `HIDIdleTime`; Linux runs
  `xprintidle`. These are one-shot probes per sample, not long-lived processes.
- States: `ok` (samples accepted), `degraded` (temporary failure, retrying) and
  `off` (unsupported platform or repeated failure). Restarts use exponential
  backoff (1 s → 30 s, capped), a watchdog restarts the Windows child when three
  intervals pass with no sample, and four consecutive failed starts stop sampling
  for the session.
- The tracker counts the wall-clock gap between two samples as active **only when
  the previous sample was active** and the gap is no longer than
  `max(10 s, sampleSeconds × 4)`. A sleep/suspend gap or a sampler restart
  therefore never inflates usage and ends the continuous-work run.
- `focus.tick()` accumulates elapsed time with `min(gap, 5 s)`, so a suspended
  laptop cannot complete a block in one jump. Deadlines (`endsAt`) are stored in
  `focus.json`; a block that outlives a process restart is settled exactly once by
  the first tick after recovery.

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

### Budget and lock

`budget.evaluate()` recomputes the lock every tick:

| Limit | Trigger | `0` means |
| --- | --- | --- |
| `limits.dailyActiveMinutes` | today's active time ≥ limit | unlimited |
| `limits.continuousWorkMinutes` | continuous active time ≥ limit | unlimited |
| `limits.sessionMinutes` | current work block elapsed ≥ limit | unlimited |

The lock is `{ locked, reason, since, unlockUntil, unlockCountToday, canUnlock,
strict }`. A `limit-warning` event fires once per day/run at 80 % of the daily and
continuous limits.

Unlocks do not lower counters; they set a **grace deadline** (`unlockUntil`) during
which the lock view reports `locked: false`:

- Password unlock: scrypt-verified, grants `limits.unlockMinutes` (default 20) and
  increments `unlockCountToday`; refused by `strictNoUnlock`, a missing password,
  or `dailyUnlockLimit` (0 = unlimited).
- Rest unlock: available in every mode (including strict), clears the continuous
  run and grants the same grace window.

`budget.json` stores the current reason/counters so a restart does not silently
reset the daily unlock limit.

### Tool guard (hard boundary)

`lock.js` exports a pure decision function and registers it with `ctx.tools.guard`:

- While budget-locked, **every** tool call is denied.
- While `lock.singleConversation` and `lock.blockToolsOutsideFocus` are on, the
  allowed set is the focus session id when a focus block is active, otherwise all
  currently running agent ids. A tool call from any other **root** conversation is
  denied.
- The conversation lock never denies non-root agents: subagents and workflow
  children are work performed for a root, so blocking them would stall the task
  being focused.
- When `lock.exemptSubagents` is on, Agent Teams members are exempt, and agents
  owned by an allowed agent (`ctx.agents.isOwnedBy`) are exempt too. The Agent Teams
  service is looked up lazily because it can mount after this plugin.
- If the bound focus session no longer has a live agent, the conversation lock does
  not deny anything (a stale binding must not freeze other conversations); stopping
  or resting clears the block. Disposing the bound owner also auto-stops the focus
  block.
- Denial text is bilingual and begins with a stable code so the UI can localize:
  `[dsh-deep-focus:budget-lock] …` or `[dsh-deep-focus:conversation-lock] …`.

### Event feed and alerts

`events.js` owns a 50-entry ring buffer with sequence numbers seeded from
`Date.now()` (so a Host restart never makes the browser replay old events). It also
tracks live agent status and listens for:

- `agent/status`, `agent/disposed` → running-session set used by the guard and the
  client's sidebar lock. Disposing the agent a focus block is bound to stops that
  block (`owner-disposed`), so a persisted `focus.json` cannot restore a ghost lock
  into a foreign session.
- `session/event` `turn/end` (`reason.kind === 'completed'`) → `task-completed`
  when `alerts.turnDone` is on.
- `goal/changed` with `operation === 'complete'` → completes the bound focus block,
  otherwise emits `task-completed` when `alerts.taskDone` is on.

The browser derives toasts and the chime from this ring; it never needs its own
timers for completion.

### Data files

| File | Contents |
| --- | --- |
| `settings.json` | Normalized runtime settings + `security.passwordHash` / `passwordSalt` (mode `0600`). |
| `focus.json` | Current focus block (phase, status, session id, task, timestamps, counters). |
| `budget.json` | Lock reason, since/unlockUntil timestamps, unlock counter, warning flags. |
| `usage/YYYY-MM-DD.jsonl` | Active-time deltas: `{ t, day, ms }`, flushed in batches (~10 s). |
| `stats/YYYY-MM-DD.jsonl` | Per-day aggregates used by the 7-day chart. |

Writes are atomic (temporary file + rename) and serialized per file. Unknown or
corrupt JSON falls back to defaults instead of crashing the plugin. Files older
than `usage.retentionDays` are pruned for the `usage` and `stats` subdirectories.

### Settings model

- Runtime settings live in `settings.json`, **not** in the Cordis Config schema, so
  changing them never reloads or restarts the plugin.
- `normalizeSettings()` deep-merges any stored/patch object over
  `DEFAULT_SETTINGS`, drops unknown keys, then clamps every number/boolean and
  validates quiet hours (`HH:MM` or `null`).
- `publicSettings()` removes the `security` section; the password hash and salt
  never leave the Host.
- Password: `node:crypto` scrypt (N=16384, r=8, p=1, 64-byte key, 16-byte random
  salt), compared with `timingSafeEqual`. Plaintext is never persisted or logged.
  Password length is 6–256 characters.

## HTTP API

Base: `/plugins/dsh-deep-focus/api` (same origin as the DSH Web GUI).

| Method | Route | Body | Result |
| --- | --- | --- | --- |
| GET | `/state` | — | Full state snapshot (below). |
| GET | `/stats?days=7` | — | `{ ok, retentionDays, days: [{ day, activeMs, focusMs, breakCount, pomodoros, unlocks }], today, totalActiveMs, totalFocusMs }`; days clamped to 1–90. |
| GET | `/settings` | — | `{ ok, settings: publicSettings(), hasPassword }` (no `security`). |
| POST | `/settings` | `{ settings?, password?, currentPassword?, clearPassword? }` | `{ ok, settings, hasPassword }`. Changing/clearing a password requires the current one. |
| POST | `/focus/start` | `{ task?, sessionId?, workMinutes? }` | `{ ok, state }`. |
| POST | `/focus/pause` | — | `{ ok, state }`. |
| POST | `/focus/resume` | — | `{ ok, state }`. |
| POST | `/focus/stop` | `{ reason? }` | `{ ok, state }` (does not count as completed). |
| POST | `/focus/complete` | — | `{ ok, state }` (marks the task done, starts the break). |
| POST | `/unlock` | `{ password }` or `{ rest: true }` | `{ ok, state }` / stable error code (`bad-password`, `limit-reached`, `strict`, `no-password`, …). |

`GET /state` returns exactly:

```jsonc
{
  "now": 0,
  "focus": { "phase": "idle", "status": "idle", "sessionId": null, "task": null,
             "endsAt": null, "remainingMs": 0, "elapsedMs": 0,
             "pomodorosToday": 0, "startedAt": null, "sessionLive": null },
  "usage": { "activeTodayMs": 0, "continuousMs": 0, "sampling": "off", "dayKey": "",
             "samplerDetail": null },
  "lock": { "locked": false, "reason": null, "since": null, "unlockUntil": null,
            "unlockCountToday": 0, "canUnlock": false, "strict": false },
  "alerts": { "sound": true, "volume": 0.6, "quietHoursStart": null, "quietHoursEnd": null },
  "settings": { /* publicSettings() */ },
  "sessions": [{ "id": "...", "running": true }],
  "events": [{ "seq": 0, "kind": "focus-started", "at": 0, "meta": {} }]
}
```

The client codes against this shape; optional fields may be added
(`usage.samplerDetail`, `focus.sessionLive` — `false` means the bound session has no
live agent, so a stale conversation binding must not dim or block other
conversations), existing ones are not renamed. Building the snapshot re-evaluates
the budget, so a poll taken between budget ticks still observes a newly exceeded
limit. Responses are `cache-control: no-store`. Every route, reads included, passes
a trust check: `sec-fetch-site: cross-site` is refused, a present `Origin` must
match the request authority (loopback ports may be omitted), and absent
`Origin`/`Host` headers are allowed for non-browser callers. JSON bodies are capped
at 32 KiB; malformed JSON gets a `400`, unknown paths a JSON `404`, wrong methods a
`405` with `allow`, and untrusted origins a `403`.

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
| `conversation.input.right` | `dsh-deep-focus-pill` | Status dot + countdown / phase, click opens the panel. |
| `shell.overlay` | `dsh-deep-focus-panel` | Focus card: progress ring, task input, presets, start/pause/resume/stop, today's stats. |
| `shell.overlay` | `dsh-deep-focus-toasts` | Completion / limit / lock toasts. |
| `shell.overlay` | `dsh-deep-focus-lock` | Full-screen lock overlay: reason, today's usage, password unlock / rest. |
| `settings.section` | `deep-focus` | Grouped settings, unlock password management, 7-day chart. |

Slot registration goes through `ctx.slots.inject(...)` + `ctx.slots.register(...)`, and
each registration is wrapped in `ctx.effect` so an unavailable or changed slot cannot
break the plugin row. The English/Chinese UI dictionary is registered with
`ctx.locale.register('dsh-deep-focus', { en, zh })` and falls back to English if the
locale service is missing.

The lock overlay only renders after the first successful `/state` fetch, so a fresh
page never flashes a lock. Polling is 1 s while the page is visible and 5 s while
hidden, with an in-flight guard; a failed poll keeps the last good snapshot and
shows an offline marker. Toasts are derived from the monotonic `events[].seq` ring,
so each event is shown exactly once.

The chime is synthesized with Web Audio (two ascending tones), respects
`alerts.sound`, `alerts.volume` and quiet hours, unlocks the `AudioContext` on the
first user gesture, and fails silently when the browser blocks audio.

The sidebar lock is **best effort**, layered on top of the Host guard:

1. A capture-phase click listener walks up to 12 ancestors, matches attribute values
   against known session ids, and blocks clicks on non-owner conversations.
2. Matched conversation rows are dimmed with inline styles and kept in sync with a
   debounced `MutationObserver`; original styles are restored on unlock.
3. The `uiWorkspace.openSession` method is wrapped while locked to refuse non-owner
   targets.

All listeners, observers, timers and styles are removed on `ctx.effect` cleanup.
The UI uses DSH theme tokens (`--dsw-alias-*`) only, follows `ctx.locale` for
English/Chinese, respects `prefers-reduced-motion`, and closes the panel with
Escape.

## Failure handling

| Failure | Behavior |
| --- | --- |
| Sampler unavailable (platform/permissions) | `sampling: "degraded"` or `"off"`; focus timer keeps working; UI shows the state instead of pretending. |
| API request fails (Host restarting) | Client keeps the last snapshot and shows an offline marker; next successful poll recovers. |
| Corrupt data file | Treated as missing: defaults/empty state. |
| Missing optional Host service | The related feature is skipped; the plugin does not throw into the Host. |
| Plugin disabled / HMR unload | Cleanups stop the sampler child, timers, HTTP routes, guard and event listeners. |

## Testing and verification

- `npm test` — `node --test` (auto-discovers `test/*.test.mjs`): pure functions
  (settings merge/clamp, password hash/verify, budget decisions, day rollover,
  focus transitions with an injected clock, active accumulation). No DSH context
  required.
- `node scripts/verify.mjs` — offline packaging smoke: manifest/entry points,
  locale parity, icon XML, contract sanity, README/contract settings-table drift,
  import hygiene, workflow rules.
- `.github/workflows/ci.yml` — syntax check, tests and verification on Node 20/22.

## Compatibility assumptions

- Verified against DSH `0.2.2-rc.1` on Windows. The plugin relies only on public
  Host services (`tools`, `agents`, `webServer`), Cordis events
  (`agent/status`, `agent/disposed`, `session/event`, `goal/changed`) and documented
  client slots.
- `macOS`/`Linux` sampler paths are implemented but not covered by the author's
  testing; they report `degraded`/`off` rather than failing the plugin.
- The lock is a self-discipline mechanism. The Host-side tool guard is authoritative
  for agent behavior; the lock overlay, password and sidebar interception are
  friction and can be bypassed by restarting DSH or editing the data directory.

The confirmed product decisions behind this design are recorded in `PLAN.md`
section 十二.
