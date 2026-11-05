# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.4.4] - Unreleased

A stability release on top of 0.4.3. Versions 0.1.0–0.4.3 were never published.

### Added

- `scripts/e2e.mjs` — a live end-to-end suite against the running plugin's HTTP API
  (contract shape, `/apps`, removed routes, idle auto-pause, resume stability,
  pause/resume, rest start/skip, extend, settings round-trip, assistant toggle,
  bad requests). 29 checks, restores any setting it changes.

### Fixed

- **Auto-pause flapping after you come back.** The 1-second enforcement tick could
  read the stale idle sample taken *before* the resume (often 100 s+) and pause
  again one second later. Auto-pause now requires a sample strictly newer than the
  latest resume (`sampleAt > lastResumeAt`) and a resume grace window of
  `max(2 × sample interval, 6 s)`; manual pause still applies immediately and
  `autoPauseSeconds: 0` still disables auto-pause entirely.

## [0.4.3] - Unreleased

A UX simplification release on top of 0.4.2. Versions 0.1.0–0.4.2 were never
published.

### Changed

- **The floating two-ring widget is now display-only.** The click-to-pause
  behaviour and its copy are gone; the rings only show today's/continuous progress.
  Entering the rest/pause state is automatic: after `usage.autoPauseSeconds`
  (default 60 s, `0` = off) without keyboard/mouse input the assistant grays the
  DSH window, and real activity resumes it. The `pause`/`resume` API endpoints
  remain available but the UI no longer triggers them.
- **One shared “today usage” card.** The forced-rest screen and the daily-limit
  screen now render the same card — title/reason, today's total, per-app breakdown
  and that screen's action buttons — instead of two separate layouts.
- **Daily-limit screen only has two actions:** 「再使用 20 分钟」 / “Use 20 more
  minutes” and 「跳过」 / “Skip”. Skip only dismisses today's reminder in the current
  browser; it does not extend anything.
- **The settings UI is intentionally minimal.** The assistant page exposes only
  seven controls: daily limit, continuous limit, rest length, extension length,
  auto-rest idle seconds, sound, and app-tracking. Every advanced knob (extension
  cap, quiet hours, away/repeat chime settings, sampling intervals, retention,
  ring/solo toggles, …) remains in the settings JSON and the plugin API but is no
  longer surfaced in the UI.

### Fixed

- **Settings action row layout** — the save/discard buttons no longer stick to the
  bottom-left corner; they sit in a normal right-aligned footer inside the panel's
  content column, with proper padding and theme colors.

## [0.4.2] - Unreleased

A follow-up UX pass on 0.4.1. Versions 0.1.0–0.4.1 were never published.

### Added

- **Idle auto-pause** — new setting `usage.autoPauseSeconds` (default `60`
  seconds, `0` = off): when the keyboard/mouse has been idle that long, the
  assistant automatically enters the paused state and shows the same gray pause
  screen; real activity resumes it. `/state` now exposes `limit.pausedReason`
  (`"manual"` for the widget click, `"idle"` for the automatic pause).

### Changed

- **One-conversation mode now pins the UI to the running conversation** — when
  another conversation's agent is running, the client automatically jumps back to
  that conversation. The other conversation rows and workspace folder rows stay
  grayed out and non-clickable (a click shows the gentle reminder); if a non-owner
  conversation is somehow visible, its content is veiled/dimmed and sending is
  discouraged until the run finishes. Nothing is hidden, so there is still no
  animation, no layout change and no expanded/collapsed state to restore.

## [0.4.1] - Unreleased

A small UX fix release on top of 0.4.0. Versions 0.1.0–0.4.0 were never published.

### Changed

- **Floating two-ring widget moved lower** so it no longer overlaps the DSH top
  area and stays clear of the host's top-right controls; it is clamped inside the
  viewport on small windows.
- **`limits.dailyExtendLimit` now defaults to `0`, which means unlimited daily
  extensions** (a positive value is the maximum). The daily overlay omits the
  remaining-count line while unlimited and never disables “Use 20 more minutes” for
  a limit reason.
- **Buttons use explicit theme colors** — the settings save/discard, daily overlay
  extend/skip, rest skip and ring pause actions render primary/secondary styles
  inline, so they can no longer appear white-on-white in dark mode.

### Fixed

- **One-conversation mode now grays out instead of hiding**: while a conversation
  runs, the other conversation rows **and workspace folder rows** are dimmed and
  made non-clickable (a click shows the gentle reminder), while the current
  conversation row stays normal. Because nothing is hidden, folder
  expanded/collapsed state and the sidebar layout are untouched — this removes the
  broken “restore previous sidebar state” behavior from 0.4.0.
- Removed the in-app “pure plugin cannot block other apps” disclaimer from the rest
  screen; the capability boundary remains documented in the README/docs.

## [0.4.0] - Unreleased

First public release; versions 0.1.0, 0.2.0 and 0.3.0 were never published. v0.4 is
a UX pass over the v0.3 focus assistant: a floating two-ring widget, a real pause
mode, activity-gated rest, skip actions, an away-only repeating completion chime,
and smoother solo-mode hiding. Install it with:

```bash
dsh plugin --profile desktop add dsh-deep-focus
```

### Added

- **Floating two-ring widget** in the top-right of the DSH window
  (`shell.overlay`): one SVG ring for today's usage vs. the daily cap, one for
  continuous use vs. the continuous cap, plus a small label. It replaces the old
  header countdown chip.
- **Pause & gray mode** — clicking the widget calls `POST /pause`: counting stops
  immediately and the whole DSH window grays with a calm “已暂停计时” note (visual
  only, no pointer capture). The pause is released by real keyboard/mouse activity
  (`POST /resume`, or the Host's own activity check with a short grace period) —
  never by the click that started it.
- **Activity-gated forced rest** — a rest now finishes only when its time has
  elapsed **and** the user is back (real input detected). While the user is away it
  simply keeps waiting, with a 30-minute cap so it cannot get stuck. The rest screen
  shows `restNeedsActivity` when the time is up but nobody is there.
- **Skip actions** — 「跳过休息」 / “Skip rest” on the rest screen (`POST
  /rest/finish`, reason `skipped`), and 「跳过」 / “Skip” on the daily overlay
  (per-day acknowledgment) next to the existing 「再使用 20 分钟」.
- **Away-only repeating completion chime** — the completion chime stays silent
  while you are actively watching; when the window is unfocused/hidden or the
  machine has been idle for `alerts.awayIdleSeconds` it repeats every
  `alerts.repeatIntervalMs` (clamped 500–10000 ms) until input returns.
  `alerts.repeatUntilActive` turns the repetition off.
- **New settings** — `assistant.showRings`, `alerts.repeatUntilActive`,
  `alerts.repeatIntervalMs`, `alerts.awayIdleSeconds`; new `pause`/`resume` routes
  and `paused`/`resumed` events.
- **Animated solo mode** — the one-conversation mode now hides other conversations
  **and workspace folders**, fading them out and back over ~220 ms
  (`prefers-reduced-motion` falls back to instant), instead of hard-cutting rows.

### Changed

- The top-right countdown chip (`conversation.session.header.utilities`) was
  replaced by the floating two-ring widget in `shell.overlay`.
- The forced rest no longer ends just because its timer elapsed; the user must be
  back (or press skip). Rest time remains excluded from the daily total.
- The completion chime is now away-gated and repeatable instead of a single chime
  at completion.
- Settings schema v4: `assistant.showCountdown` became `assistant.showRings`, the
  alert group gained the repeat/away fields, and a stored settings file from any
  earlier schema (v1–v3) is discarded and replaced with v4 defaults.
- Solo mode lost its banner; the sidebar hiding itself is now the only cue.

### Removed

- The solo banner (「专注中：其它文件夹和会话已暂时隐藏…」) — nothing replaces it.
- The header countdown chip slot registration and its `dsh-deep-focus-countdown`
  id.
- `assistant.showCountdown` and `alerts.taskDone` settings (completion sound is
  controlled by `alerts.sound` plus the away/repeat fields).
- The “chime on completion even while watching” behavior.

### Fixed

- Workspace/folder rows are now hidden in solo mode too (previously only session
  rows disappeared).
- The daily overlay's secondary button no longer renders as a white, unstyled
  button in dark mode; it uses the theme tokens.
- A forced rest can no longer auto-finish while the machine is away just because
  the countdown reached zero.
