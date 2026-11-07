# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.4.29] - 2026-11-07

### Added

- **The floating timer is draggable.** Press and drag the two-ring card anywhere; a real
  drag suppresses the pause click (a tap still pauses/resumes). The position is saved in
  `localStorage` (`dsh-deep-focus.rings-position`) and restored across reloads, clamped
  inside the window (default stays top-right), and kept visible on resize.

## [0.4.28] - 2026-11-06

### Fixed

- **The daily-limit screen stayed up (or appeared) while paused.** The cap was not
  evaluated during a pause. Pausing now releases the daily lock (UI shows the pause
  screen) and no lock is entered while paused; resuming re-locks if still over.
## [0.4.27] - 2026-11-06

### Fixed

- **Legacy mojibake rows are no longer rendered.** Pre-0.4.26 records can contain U+FFFD replacement characters (unrecoverable GBK bytes); the resolver now shows the readable ASCII prefix (`xtitclient_x64…`) or `未知应用` instead of garbage. New samples decode correctly.
## [0.4.26] - 2026-11-06

### Fixed

- **Non-ASCII app names showed as mojibake.** PowerShell wrote the process name to redirected stdout in the console code page (GBK) while the Host read UTF-8; the sampler now sends it as base64 UTF-8 (pure ASCII on the wire) and the Host decodes/validates it. Verified end-to-end with a Chinese name.
## [0.4.25] - 2026-11-06

Patch release.

### Fixed

- **A pause unlocked itself without any new input.** The Host now requires the last input to be measurably newer than the pause (`idleMs < sincePause - 500`), and the client needs a trusted ≥4 px pointer move or a key/wheel/touch event ≥400 ms after the card appears.
## [0.4.24] - 2026-11-06

Patch release.

### Fixed

- **The continuous clock still moved in 5-second steps.** It now advances by real elapsed wall time per 500 ms render (clamped to 2 s), anchors upward to the Host value, holds while away and snaps only when frozen. Verified by running the real bundle in headless Edge: one second per second.
## [0.4.23] - 2026-11-06

Patch release.

### Fixed

- **The floating rings disappeared.** The previous patch wrote the new "keep the display
  clock ticking" comment with a literal `\n`, which swallowed the following line
  declaration and made the widget throw at render time. The comment and declaration are
  proper lines again, and `scripts/verify.mjs` now fails if a line comment in
  `src/client.js` contains a literal `\n` (that class of corruption previously passed
  `node --check`).
## [0.4.22] - 2026-11-06

Patch release.

### Fixed

- **The continuous clock fell back to 5-second steps while the user was idle.** The
  500 ms interpolation was gated on the "away" check, so as soon as the machine had
  been quiet for ~30 s the display stopped ticking and only moved with the ~5 s Host
  sample. The display clock now ticks every 500 ms whenever it is not frozen
  (paused / resting / daily-locked / hidden / assistant off), independent of the away
  detection — detection can stay slow, the UI stays smooth.
## [0.4.21] - 2026-11-06

### Changed

- **A manual pause is immediate**: clicking the rings now shows the blocking pause card
  at once. The ~0.6 s settle guard remains only for the automatic idle pause, where it
  prevents the screen from flashing.
- **Pausing resumes as soon as you use the computer.** Inside DSH the client posts
  `/resume` on the first keyboard/mouse input (after a short guard), so resumption is
  near-instant instead of waiting for the ~5 s sampler. Activity in another application
  is still picked up by the system-wide sampler, within up to ~5 s. The card blocks the
  DSH UI while shown and disappears immediately on resume.

## [0.4.20] - 2026-11-06

Versions 0.1.0–0.4.19 were never published. The project has no npm package;
distribution is GitHub Releases + source only.

### Fixed

- **Any pause now resumes when the computer is used again, even in another
  application.** The sampler's idle signal is system-wide, so switching to another app
  and typing/moving the mouse resumes counting for both the automatic idle pause and a
  manual click-pause instead of leaving the timer paused (keeps today's accounting
  accurate). The pause card still blocks host-UI interaction while shown and
  disappears immediately on resume.

### Changed

- The pause card copy distinguishes the two modes (automatic idle vs manual), while
  both follow the same resume-on-activity rule; the 「继续计时」 button and
  Enter/Space/Escape remain available as explicit resume paths.

## [0.4.19] - 2026-11-05

### Fixed

- The completion chime could ring before every conversation finished. “All done” now
  comes from Host state only, requires two consecutive polls without a running root
  conversation, and no longer relies on `document.hasFocus()` (unreliable in the
  Electron shell) — being present never rings.

## [0.4.18] - 2026-11-05

### Fixed

- Today's minutes never move backwards within a day (a new day resets them), and the
  continuous ring shows real time even when the continuous limit is disabled.

## [0.4.17] - 2026-11-05

### Fixed

- The continuous clock is monotonic now: it only advances, drops only on a real reset,
  ticks every 500 ms instead of stepping against the 5 s sampler, and freezes on the
  Host value while paused/resting/locked. Today's minutes follow the same rule.

## [0.4.16] - 2026-11-05

### Fixed

- Ring values no longer escape the rings: the centered overlay anchors to its own ring
  column, numbers sit inside the 44 px rings, the unit sits under the number, and
  captions share a baseline.

## [0.4.15] - 2026-11-05

### Removed

- **npm publishing** — the Trusted Publishing/provenance workflow
  (`.github/workflows/publish.yml`) is deleted; releasing a tag no longer triggers any
  npm step. Distribution is GitHub Releases + source only: install with
  `dsh plugin add <repository URL or local path>`.

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

- Invisible primary buttons: the host's `brand-primary` token is pure white in the dark
  theme, so primary buttons/toggles now use an explicit blue accent readable in both
  themes.

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
