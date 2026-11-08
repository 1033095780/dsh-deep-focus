# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.4.35] - 2026-11-08

### Changed

- **Completion attention now works when you are in another app.** When all running
  conversations have finished, the plugin detects "outside DSH" from the system-level
  foreground signal (not only idle), rings the chime and shows one clickable system
  notification 「所有对话已完成 · 点击回到 DeepSeek」 (click returns to DSH). No prompt when
  DSH is in front; a partial completion stays silent. This informational notice also
  works in tracking-only mode.

## [0.4.34] - 2026-11-07

### Added

- **Tracking-only mode** (`assistant.trackingOnly`): record and display usage only —
  the rings, dashboard, history and per-app breakdown keep working — while disabling the
  daily lock, continuous forced rest, auto/manual pause, rest screens, background
  focus/notification attempts, the completion chime and the one-conversation restriction.
  Nothing is counted differently; turn it off to restore normal rules.

## [0.4.33] - 2026-11-07

### Changed

- **A finished rest no longer auto-resumes counting.** When the rest countdown after a
  continuous timeout reaches 0, the rest page stays in a “waiting for you” state instead of
  restarting the timer or a new continuous run (you may still be away). Waiting counts
  nothing and does not grow/decay the continuous value. The rest ends only when you
  genuinely come back and use the mouse/keyboard in DSH **after** the countdown (foreground
  activity); activity in another application does not end it. Skipping the rest still
  works, and the v0.4.31 best-effort attention behaviour is unchanged.

## [0.4.32] - 2026-11-07

### Changed

- **Pause/rest only take effect while DSH is the foreground application.** While the user
  is working in another app, today's usage keeps counting and the continuous counter
  neither decays nor resets — the pause/rest page simply waits for them. Only when DSH is
  actually back in front (the pause/rest page is the active window) does counting stop and
  the continuous decay begin. The v0.4.31 best-effort foreground switch + clickable
  notification still apply.

## [0.4.31] - 2026-11-07

### Added

- **Background limit-screen attention.** When a limit screen appears (continuous timeout
  → rest/pause page, or the daily lock) while DSH is behind another app, the client retries
  `window.focus()` a couple of times; **switching back is best effort**. When it does not
  happen, it posts **one clickable system notification** prompting you to return to
  DeepSeek (「连续使用超时 · 需要休息」 / 「今日使用已超时」); clicking it focuses DSH. Windows
  may keep another app in front, so the notification is the reliable fallback. No native
  code or extra permission beyond browser notifications.

## [0.4.30] - 2026-11-07

### Changed

- **Continuous usage decays during pause/rest instead of resetting.** Recovery time now
  reduces the continuous counter at `continuousMinutes / restMinutes` per minute, so the
  full cap clears after about `limits.restMinutes` of pause/rest (default 30 min → 10 min;
  e.g. 20 min used → ~10 min rest → 0). A short pause only reduces it and resuming
  continues from the remainder — a single click never zeros the run. Day rollover,
  assistant-off and invalid/sleep sampler gaps still reset it.

## [0.4.29] - 2026-11-07

### Added

- **The floating timer is draggable.** Press and drag the two-ring card anywhere; a real
  drag suppresses the pause click (a tap still pauses/resumes). The position is saved in
  `localStorage` (`dsh-deep-focus.rings-position`) and restored across reloads, clamped
  inside the window (default stays top-right), and kept visible on resize.

## [0.4.22]–[0.4.28] - 2026-11-06

### Fixed

- Daily-limit screen no longer stays up while paused (pause releases the lock; resume
  re-locks if still over).
- Legacy mojibake rows show the readable ASCII prefix or `未知应用`; non-ASCII app names
  are decoded from base64 UTF-8.
- A pause no longer unlocks itself without new input; the continuous display clock ticks
  smoothly at 500 ms and no longer falls back to 5 s steps while idle.
- The floating rings render again (a literal `\n` in a line comment is rejected by verify).

## [0.4.21] - 2026-11-06

### Changed

- **A manual pause is immediate** (the ~0.6 s settle guard stays only for the automatic
  idle pause) and resumes as soon as you use the computer: the client posts `/resume` on
  the first in-DSH input, while activity in another app is picked up by the system-wide
  sampler within up to ~5 s.

## [0.4.20] - 2026-11-06

Versions 0.1.0–0.4.19 were never published. The project has no npm package;
distribution is GitHub Releases + source only.

### Fixed

- **Any pause resumes when the computer is used again, even in another application.** The
  sampler's idle signal is system-wide, so activity elsewhere resumes counting instead of
  leaving the timer paused (keeps today's accounting accurate).

### Changed

- The pause card copy distinguishes the two modes (automatic idle vs manual), while
  both follow the same resume-on-activity rule; the 「继续计时」 button and
  Enter/Space/Escape remain available as explicit resume paths.

## [0.4.19] - 2026-11-05

### Fixed

- The completion chime could ring before every conversation finished; “all done” now
  comes from Host state only (two consecutive polls without a running root) and no longer
  relies on `document.hasFocus()`.

## [0.4.18] - 2026-11-05

### Fixed

- Today's minutes never move backwards within a day, and the continuous ring shows real
  time even when the continuous limit is disabled.

## [0.4.17] - 2026-11-05

### Fixed

- The continuous clock is monotonic: it only advances, drops only on a real reset, ticks
  every 500 ms, and freezes on the Host value while paused/resting/locked. Today's minutes
  follow the same rule.

## [0.4.16] - 2026-11-05

### Fixed

- Ring values no longer escape: the overlay anchors to its own ring column, values sit
  inside the 44 px rings, and captions share a baseline.

## [0.4.15] - 2026-11-05

### Removed

- **npm publishing** — the Trusted Publishing/provenance workflow is deleted; releasing a
  tag no longer triggers any npm step. Distribution is GitHub Releases + source only:
  install with `dsh plugin add <repository URL or local path>`.

## [0.4.14] - 2026-11-05

### Changed

- **Pause is a blocking lock**: the overlay captures hover/click/focus, so nothing
  reacts underneath. Resume only via 「继续计时」 / Continue or Enter/Space/Escape;
  moving the mouse alone does not resume (manual pause).

### Fixed

- Ring widget alignment: equal-width columns, centered values and captions, readable
  continuous mm:ss inside the ring.

## [0.4.13] - 2026-11-05

### Fixed

- One-conversation mode could stop working when a briefly empty client running-set
  snapshot overrode the Host's `solo.primary`; the Host value is authoritative now.

## [0.4.12] - 2026-11-05

### Changed

- Ring captions are 「今日已用」/「连续使用」 (en: “Today used”/“Continuous use”) with
  slightly larger type, and the aria summary reads the current values.

## [0.4.11] - 2026-11-05

### Fixed

- Invisible primary buttons: `brand-primary` is pure white in the dark theme, so primary
  buttons/toggles now use an explicit blue accent readable in both themes.

## [0.4.10] - 2026-11-05

### Added

- Click the two-ring widget to pause manually (click again to resume), with in-flight
  guard, pressed state, keyboard support and pause/resume aria labels.

## [0.4.9] - 2026-11-05

### Fixed

- Sidebar graying could still flicker: the hysteresis memory was cleared by a React
  effect cleanup on every dependency change; it now survives transient empty running
  sets and holds the gray for ~1.5 s.

## [0.4.8] - 2026-11-05

### Changed

- Rings show their value inside (today minutes; continuous mm:ss) and the continuous
  clock ticks smoothly; sidebar graying is held ~1.5 s after the running set empties.

### Fixed

- Auto-pause no longer flashes: sustained idle (two consecutive fresh samples) is
  required, activity resets the counter, stale samples are ignored, and the card
  appears only after ~0.6 s.

## [0.4.7] - 2026-11-05

### Changed

- Idle auto-pause, manual pause, forced rest and the daily-limit screen share one
  today-usage card (title/reason + today's total + per-app breakdown); the old gray
  pause layer is gone.
- The completion chime rings only when **all** running conversations finish (root
  running set non-empty → empty) while you are away; partial completions stay silent.

### Added

- Background daily-limit alert: with DSH hidden/unfocused at the cap, try
  `window.focus()` + one clickable system notification (+ chime). Best effort only — a
  pure plugin cannot force the OS foreground window.

## [0.4.6] - 2026-11-05

### Fixed

- One-conversation mode pins to exactly one primary conversation (newest running root);
  every other row — including other running conversations — is grayed, non-clickable,
  and the UI auto-jumps to the primary.

### Added

- `/state.solo.primary` (primary session id or `null`) alongside `active`/`sessions`.

## [0.4.5] - 2026-11-05

### Added

- Eighth settings control 「专注时只允许一个对话」 (`assistant.soloSession`) toggling the
  one-conversation pinning.

### Fixed

- Completion chime is root-only (subagent/teammate turns stay silent), repeats until
  input, capped ~2 minutes, stops when visible/focused.

## [0.4.4] - 2026-11-05

First public release: whole-machine usage tracking (per foreground app), a 3-hour daily
cap, a 30-minute continuous cap with an activity-gated 10-minute rest, the shared
today-usage card, per-app stats, one-conversation sidebar guidance (never blocks
tools), the source-only install, and `scripts/e2e.mjs` live smoke test.
