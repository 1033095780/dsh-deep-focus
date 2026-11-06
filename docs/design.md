# Design

How `dsh-deep-focus` is put together. The code is the source of truth; this page
explains the shape and the contract.

## Overview

The plugin runs inside DSH and only enforces inside DSH. It measures whole-machine
active time while DSH runs, keeps a daily cap (180 min), forces a rest after 30
continuous minutes (10 min, activity-gated), auto-rests after 60 s idle, and keeps
one conversation at a time in the sidebar (a single primary conversation pinned: auto-jump + gray-out, UI only). It never
blocks tools, other agents, or other applications; it cannot count while DSH is
closed. A companion desktop guard is a possible later phase and is not included.

## Layout

| Path | Purpose |
| --- | --- |
| `src/index.js` | Host entry: wiring, timers, startup recovery, cleanup. |
| `src/host/storage.js` | Data directory, atomic JSON writes, JSONL appends, per-file serialization, retention. |
| `src/host/settings.js` | v4 settings merge/clamp; pre-v4 files are discarded. |
| `src/host/sampler.js` + `win32-idle.ps1` | Idle time + foreground application (`idleMs\|pid\|exeName`). |
| `src/host/apps.js` | Executable name → stable key + friendly label. |
| `src/host/tracker.js` | Active total, per-app buckets, daily JSONL aggregate, pause/rest suppression. |
| `src/host/limits.js` | Daily cap, continuous cap, forced rest, idle pause, extension window. |
| `src/host/events.js` | Event ring, agent status map, completion alerts. |
| `src/host/api.js` | Same-origin JSON API. |
| `src/client.js` | Browser half: assistant panel, interactive two-ring widget, overlays, sidebar graying. |
| `src/shared/contract.js` | Wire contract: routes, events, `DEFAULT_SETTINGS` (version 4). |
| `scripts/verify.mjs` / `scripts/e2e.mjs` | Offline packaging checks / live HTTP smoke. |

No build step: the Host is plain ESM; the browser half is one
`window.__ModuleLoader__` factory file (only `react` is required).

## Host lifecycle

`apply(ctx)` runs inside `ctx.effect`: storage → settings → sampler → tracker →
limits → event ring/status map → API routes → timers (1 s limits tick, 10 s flush
check, daily prune). Startup loads `settings.json` and `limits.json`, prunes old
usage, and resumes sampling; unload stops the sampler child, timers, routes and
listeners, and flushes writes. Sampler failures degrade (`degraded`/`off`) instead
of throwing.

Sampler: Windows uses one long-lived `powershell -NoProfile … -File win32-idle.ps1`
child printing `idleMs|pid|exeName`; macOS uses `ioreg` + `osascript`; Linux uses
`xprintidle` + `xdotool`/`/proc/<pid>/comm` (both best effort). Restart backoff is
1 s → 30 s, a watchdog restarts a stale Windows child, and four failed starts stop
sampling for the session. No window titles are read.

Tracker: a sample counts as active only when idle < `usage.idleThresholdSeconds`;
active time goes to the day total and the current app bucket. While paused or
resting the Host calls `tracker.sample(..., { counted: false })`, so those periods
never accumulate. One aggregate line per minute: `{ t, activeMs, apps: { key: ms } }`.

## Limits, rest and pause

`limits.js` is evaluated on every sample and by the 1 s tick.

| Setting | Default | Meaning |
| --- | --- | --- |
| `limits.dailyMinutes` | 180 | daily whole-machine cap; `0` = off |
| `limits.continuousMinutes` | 30 | continuous cap before a forced rest; `0` = off |
| `limits.restMinutes` | 10 | forced-rest length |
| `limits.extendMinutes` | 20 | time granted by one 「再使用 20 分钟」 |
| `limits.dailyExtendLimit` | 0 | extensions per day; `0` = unlimited |
| `usage.autoPauseSeconds` | 60 | idle auto-rest threshold; `0` = off |
| `assistant.enabled` | true | false = statistics only, no enforcement |
| `assistant.soloSession` | true | one-conversation pinning (auto-jump + gray + non-clickable); exposed as the eighth UI switch together with `hideOtherSessions` |

- **Continuous cap:** reaching it starts a rest (`resting`, `restUntil`,
  `rest-started`, continuous counter reset). The rest ends only when its time
  elapsed **and** activity was seen afterwards (`rest-finished`,
  `reason: "elapsed-and-active"`), or via `POST /rest/finish`
  (`reason: "skipped"`); a 30-minute cap prevents a stuck rest.
- **Daily cap:** when active time ≥ cap and no extension grace window is active,
  `dailyLocked` is set once (`daily-locked`). `POST /extend` sets
  `extendedUntil`, increments `extendCountToday` and clears the lock; only a
  positive `dailyExtendLimit` can be exhausted.
- **Pause:** `POST /pause` stops counting (`paused`, `pausedAt`, `pausedReason:
  "manual"`). The Host also enters it automatically only after **sustained idle** —
  at least two consecutive fresh samples at/after `autoPauseSeconds`, with any
  active sample resetting the streak and stale samples (older than the last
  resume) ignored — so a single high sample cannot flash the overlay
  (`pausedReason: "idle"`, `paused` event). `POST /resume` resumes it. The pause
  card is shown only after the paused state has held ~0.6 s. **Any pause — manual or
  idle — auto-resumes on a fresh sample whose system-wide idle time is below
  `usage.idleThresholdSeconds`** (activity in another application counts, which keeps
  usage accounting accurate); `pausedReason` only chooses the card copy. The card
  blocks host-UI interaction while shown and disappears immediately when the Host
  reports `paused: false`; the explicit 「继续计时」/Enter/Space/Escape paths remain
  available if the user prefers to resume sooner.
- **Rollover:** at local midnight the lock, extension window/count and due flags
  reset. Turning the assistant off ends a rest and clears lock/pause
  (`assistant-off`).

State (`GET /state`) exposes this as `limit`:
`assistantEnabled, dailyLimitMs, dailyUsedMs, dailyLocked, extendedUntil,
extendCountToday, extendLimit, continuousLimitMs, continuousUsedMs, restDue,
resting, restUntil, restRemainingMs, restNeedsActivity, paused, pausedAt,
pausedReason, pausedNeedsActivity`.

## API

Base `/plugins/dsh-deep-focus/api`, same-origin only, `cache-control: no-store`,
32 KiB body cap, JSON 404/405.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/state` | full snapshot (below) |
| GET | `/apps?days=7` | `{ ok, retentionDays, days:[{day,activeMs,apps:[{id,name,ms}]}], today, top }` |
| GET/POST | `/settings` | `{ settings }` / normalized settings update |
| POST | `/assistant` | `{ enabled }` → `{ ok, state }` |
| POST | `/pause`, `/resume` | pause/resume counting |
| POST | `/rest/start`, `/rest/finish` | start a rest / skip the running one |
| POST | `/extend` | grant the extension window (409 `not-locked` / `extend-limit-reached`) |

`/state`: `{ now, usage:{activeTodayMs, continuousMs, sampling, appsSampling,
dayKey, idleMs, away}, appsToday:{totalMs, top}, limit, settings, sessions:[{id,
running}] (root conversations only), solo:{active, primary, sessions}, events }`
where `solo.primary` is the running root session whose turn started most recently
(or `null` when none runs), `solo.sessions` lists all running root ids and
`solo.active` stays true when any root runs. Events:
`task-completed, paused, resumed, rest-due, rest-started, rest-finished,
daily-locked, extended, assistant-off, assistant-on`. Building the snapshot
re-evaluates limits first; missed running flags are reconciled from the durable
session log. `task-completed` is emitted only for a **root conversation's** turn
end (`turn/end` completed); subagent/teammate sessions are filtered out by an
`isRootSession` predicate, so background work never rings the chime. Goal
completions still emit the event (it now drives a toast only; the chime is the
all-done edge detector below). `events.js` also tracks
each root session's **last turn start** (from `turn/start` events, with the running
status feed as a fallback); the API uses that timestamp to pick `solo.primary` — the
newest running root — so exactly one conversation is pinned.

## Browser half

| Slot | Id | Content |
| --- | --- | --- |
| `sidebar.panellist` | `focus-assistant` | assistant entry below Plugins |
| `main` (keyed) | `focus-assistant` | overview, 7-day trend, 8-field settings (incl. the one-conversation switch), enable/pause, right-aligned save row |
| `shell.overlay` | `dsh-deep-focus-rings` | interactive two-ring **button** with two **equal columns** (flex `1 1 0`): each column has a 40–44 px ring with its value absolutely centered (today minutes; continuous mm:ss/h:mm, tabular figures) and a centered 11 px caption below (今日已用 / 连续使用); the continuous clock is interpolated to tick once per second (frozen while paused/resting/locked). Click → `POST /pause`; an in-flight lock ignores double-clicks and shows a pressed/disabled state. Keyboard accessible (`role="button"`, `tabIndex`, Enter/Space) with aria-labels 「暂停计时」/「继续计时」 (“Pause timer”/“Resume timer”). |
| `shell.overlay` | `dsh-deep-focus-pause-gray` | auto/manual pause: a **blocking** shared today-usage card (`pointer-events: auto`) that captures hover/click/focus; the copy depends on `pausedReason` (`idle` shows 「检测到你回来后会继续计时」, `manual` shows the resume hint). Both kinds disappear immediately when system-wide keyboard/mouse activity resumes the Host; the 「继续计时」 primary action and Enter/Space/Escape remain as explicit resume paths. |
| `shell.overlay` | `dsh-deep-focus-rest` | forced-rest screen using the shared today-usage card + 「跳过休息」 |
| `shell.overlay` | `dsh-deep-focus-daily-lock` | daily overlay on the same card: 「再使用 20 分钟」/「跳过」 |
| `shell.overlay` | `dsh-deep-focus-focus-veil` | veil over a visible non-owner conversation |
| `shell.overlay` | `dsh-deep-focus-toasts` | completion/rest/extension toasts |

One shared `TodayUsageCard` renders title/reason, today's total, per-app rows and the
screen's buttons for **idle auto-pause, manual pause, the forced rest and the daily
cap** — only the title and actions differ. The old separate gray-only pause layer is
gone. When the daily cap hits while the window is hidden/unfocused, the client tries
`window.focus()`, posts one system `Notification` (click → focus) and rings once per
lock transition; this is best effort — a pure plugin cannot force the OS foreground.

One conversation at a time is style-only and pins to **one primary conversation**:
the host records each root session's last turn start and exposes the newest one as
`solo.primary`. The client uses only that session as the owner (fallbacks: the
single running root, then the visible running conversation; no owner → nothing is
grayed). To avoid flicker it keeps the owner/gray state for ~1.5 s after the
running set becomes empty and ignores transient empty snapshots. It auto-jumps once to the primary, adds one `<style>` +
`data-dsh-focus-solo` attribute dimming **all** other session and workspace rows
(`opacity`, no hiding) and blocks their clicks with a gentle reminder — including
other running conversations; a capture-phase click/keydown guard covers keyboard
paths. A visible non-primary conversation gets the veil. Nothing is hidden, so
folder expand/collapse state is never touched. On solo end/outage/cleanup the style
and attribute are removed.

Polling is 1 s visible / 5 s hidden with one store and an in-flight guard; after two
failed polls (or a 404) the client hides its UI, restores sidebar styles and keeps
retrying. Buttons use inline theme colors. The chime is synthesized Web Audio and
**all-done**: the client tracks the root running set from `state.sessions`; it rings
only on the edge from non-empty to empty (all running conversations finished) while
away (unfocused/hidden or idle past `alerts.awayIdleSeconds`). A partial completion
— some conversations still running — stays silent, and `task-completed` events only
drive a toast, never sound by themselves. It repeats every
`alerts.repeatIntervalMs` until input and is hard-capped at ~120 repeats
(~2 minutes); it stops on `visibilitychange`→visible, window focus, or activity;
quiet hours/volume apply; audio fails silently.

## Data files

`$DSH_HOME/plugin-data/dsh-deep-focus/` (`$DSH_HOME` defaults to `~/.dsh`):
`settings.json` (mode 0600), `limits.json` (lock/rest/pause/extension state),
`usage/YYYY-MM-DD.jsonl`. Atomic writes, unknown/corrupt JSON falls back to
defaults, retention prunes old usage (and legacy `stats/`).

## Migration and compatibility

Settings are versioned (4): a v1/v2/v3 `settings.json` is discarded and replaced by
v4 defaults. Legacy `usage/*.jsonl` lines are still summed for their `ms`/total.
Verified on DSH `0.2.2-rc.1` (Windows); macOS/Linux foreground sampling and the
sidebar DOM rules are best effort. The assistant is a self-discipline aid — nothing
is enforced outside DSH.
