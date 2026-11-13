# Design

`dsh-deep-focus` v1 is deliberately one feature: **task lock + optional DingTalk
completion notice**. The code is the source of truth; this page explains the shape.

## Product boundary

- Pure DeepSeek Harness bundle plugin. It observes session/turn events and renders one
  overlay; it cannot stop the model, terminate a run, control other applications, or
  force the DSH window to the foreground.
- Everything from the earlier focus/timer product is gone: no sampling process, no
  background counters, no overlays other than the lock, no dashboard statistics.
- If DSH is closed the lock ends with it.

## Layout

| Path | Purpose |
| --- | --- |
| `src/index.js` | Host entry: wiring, lock state machine, event listeners, timer cleanup. |
| `src/host/storage.js` | Local plugin data directory and atomic JSON file writes. |
| `src/host/settings.js` | Settings load/normalize/save via `contract.mergeSettings`; keeps the token on disk only. |
| `src/host/dingtalk.js` | DingTalk webhook sender (timeout, retries, `[+]` messages). |
| `src/host/api.js` | Same-origin JSON API (`/state`, `/settings`, `/lock/skip`, `/notifications/test`). |
| `src/shared/contract.js` | Wire contract v5: routes, defaults, settings patching, message builders. |
| `src/client.js` | Self-contained browser bundle: lock overlay, completion reminder (local notification + banner) and minimal DingTalk settings page. |
| `scripts/verify.mjs` / `scripts/e2e.mjs` | Offline release checks / live API smoke test. |

No build step: the Host is plain ESM; the browser half is one
`window.__ModuleLoader__` factory file (only `react` is required).

## Lock lifecycle

A lock is created after the user sends a message in a conversation and cleared when that
conversation's whole task tree is done.

| Step | Behaviour |
| --- | --- |
| Arm | User input in a root conversation starts/refreshes the lock for that session (`lock.active = true`, `sessionId`, `title`, `startedAt`). |
| Hold | While the root turn or **any subagent/child session it started** is running, the lock stays. `activity.running` (host aggregate) and per-session running flags are the truth. |
| Settle | After the root turn closes and children stay idle for `LOCK_SETTLE_MS` (1200 ms), the lock is released. A `LOCK_RECONCILE_MS` (1500 ms) safety pass covers missed events while locked. |
| Release | `lock.active = false`; a completion message is attempted once when DingTalk is enabled and the lock was released automatically (never on skip). |
| Skip | `POST /lock/skip` releases immediately and sends nothing. |
| Fail | A closed turn (including model/network errors) still releases; a Host restart simply drops the in-memory lock. |

The lock is in-memory; only settings are persisted, so a reload leaves no stale overlay
behind. Elapsed time in the UI is derived from `startedAt` (host clock), not a local
counter.

## API

Base `/plugins/dsh-deep-focus/api`, same-origin only, `cache-control: no-store`, JSON
404/405. Routes come from `contract.ROUTES`.

| Method | Route | Result |
| --- | --- | --- |
| GET | `/state` | `{ ok, version: 5, now, lock:{active,sessionId,title,startedAt,elapsedMs}, settings: publicSettings, notify:{configured,last} }` |
| GET | `/settings` | `{ ok, version: 5, settings: publicSettings }` |
| POST | `/settings` | `{ ok, version: 5, settings: publicSettings, state }` after applying a patch |
| POST | `/lock/skip` | `{ ok, state }`; `409` `no-lock` when no lock is active |
| POST | `/notifications/test` | `{ ok, delivered, state }`; `409` `not-configured` when DingTalk is disabled or has no token |

Settings are `{ version: 5, notifications: { dingtalkEnabled, dingtalkToken } }`. PATCH
semantics (`contract.applySettingsPatch`): omitting `dingtalkToken` or sending `''`
keeps the stored token; `null` clears it; any other non-empty string replaces it.
`publicSettings` never exposes the token — only `dingtalkTokenSet` and the last four
characters (`dingtalkTokenHint`). POST bodies are size-capped and malformed JSON is
rejected.

## DingTalk sender

`src/host/dingtalk.js` posts `{ msgtype: 'text', text: { content } }` to
`DINGTALK_WEBHOOK + token` with a 3 s timeout and up to two retries; failures are logged
locally and never throw into the event loop. Completion text is built by
`contract.buildCompletionMessage` and always begins with `[+] `:

`[+] 会话已完成：<title>，用时 <n> 分钟，完成时间 HH:MM`

The test route uses `buildTestMessage`. Only these messages are ever sent; nothing is
sent on skip, on errors, or when DingTalk is disabled.

## Browser half

| Slot | Id | Content |
| --- | --- | --- |
| `sidebar.panellist` | `focus-assistant` | sidebar entry (kept id for continuity) |
| `main` (keyed) | `focus-assistant` | minimal DingTalk settings page: enable switch, password token field, save, clear, send-test |
| `shell.overlay` | `dsh-deep-focus-lock` | full-screen lock overlay (order 50) |

The overlay renders only when the confirmed state says `lock.active`; it shows
「任务进行中」, the conversation title, a per-second elapsed time (host clock), a note
about automatic unlock, the DingTalk status line, and a 「跳过」 button that POSTs
`/lock/skip` and hides optimistically. It covers the frame with `pointer-events: auto`
so the app underneath gets no hover/click, uses theme tokens and stays readable in light
and dark.

The client is self-contained (`window.__ModuleLoader__`, only `require('react')`). One
lightweight store drives it with a chained `setTimeout` poll: 1 s while locked, 3 s when
idle, 5 s while `document.hidden`. No intervals survive unmount. If the API fails three
polls in a row (or returns 404), the overlay is hidden and the store keeps the last good
state, so an unreachable Host cannot block the UI forever. Inline zh/en strings are used;
there is no audio.

### Completion reminder

On the lock transition `active → inactive` the client fires a local reminder, unless the
transition came from the user's 「跳过」 (the client suppresses the session whose skip it
sent):

- **one local notification** via the browser `Notification` API, title 「会话已完成」 /
  "Conversation finished" and body `<title> · 用时 X 分钟`, using the elapsed value from the
  last active state. It is **best effort**: `permission === 'granted'` shows it,
  `default` requests permission once and shows it if granted, denied/unsupported is silent;
  `onclick` focuses the DSH window and closes the notification;
- **one in-page banner** 「会话已完成 · <title>」 for ~5 s, always shown while the page is
  visible, theme-styled, non-blocking, auto-dismissed. It is the fallback when the browser
  notification cannot be shown.

No reminder is shown on boot with an already-inactive state, on skip, or for repeated
polls of the same transition (deduped by session/timestamp). Reminders are local-only:
they involve no network request and never contain the DingTalk token or message content.

## Data file

`$DSH_HOME/plugin-data/dsh-deep-focus/settings.json` (defaults to `~/.dsh`) stores
`{ version: 5, notifications: { dingtalkEnabled, dingtalkToken } }`. Writes are atomic;
corrupt files fall back to defaults with DingTalk disabled. The lock itself is not
persisted.
