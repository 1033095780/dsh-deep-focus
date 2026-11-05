# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.4.13] - 2026-11-05

Patch release. Versions 0.1.0–0.4.9 were never published.

### Fixed

- **One-conversation mode could stop working:** a briefly empty client running-set
  snapshot overrode the Host's `solo.primary`. The Host value is authoritative now;
  the client snapshot is only a fallback.

## [0.4.12] - 2026-11-05

Patch release. Versions 0.1.0–0.4.9 were never published.

### Changed

- The floating rings' captions are no longer too terse: 「今日已用」/「连续使用」
  (en: "Today used"/"Continuous use"), slightly larger type, and the aria summary
  now reads 「今日已用 20 分钟，连续使用 01:16」 so the widget is self-explanatory.

## [0.4.11] - 2026-11-05

Patch release. Versions 0.1.0–0.4.9 were never published.

### Fixed

- **Invisible primary buttons** (the host's `brand-primary` token is pure white in
  the dark theme). Primary buttons and toggles now use an explicit blue accent that is
  readable in both themes.

## [0.4.9] - 2026-11-05

Follow-up to 0.4.8 (which was published moments earlier). Versions 0.1.0–0.4.7
were never published.

### Fixed

- **Sidebar graying could still flicker**: the solo controller's hysteresis memory
  was cleared by a React effect cleanup on every dependency change, so the "hold the
  gray for ~1.5 s" behaviour never took effect in the real page. The cleanup now runs
  only on unmount, so the previous owner survives transient empty running sets.

## [0.4.17] - 2026-11-05

Patch release. Versions 0.1.0–0.4.15 were never published.

### Fixed

- **The continuous clock stuttered and could jump backwards.** It is now a monotonic
  local value: it only advances, drops solely on a real reset (rest/pause start), ticks
  every 500 ms instead of 1 s (no sawtooth against the 5 s sampler) and freezes exactly
  on the Host value while paused/resting/locked. Today's minutes follow the same rule.

## [0.4.16] - 2026-11-05

Patch release. Versions 0.1.0–0.4.14 were never published.

### Fixed

- **Ring widget values escaped the rings** (the centred overlay anchored to the wrong
  ancestor). It now anchors to its own ring column; numbers sit inside the 44 px
  rings, the unit sits under the number, captions share a baseline. Verified by
  rendering the exact CSS/markup with a headless browser (docs/images/rings-widget.png).

## [0.4.15] - 2026-11-05

Patch release. Versions 0.1.0–0.4.14 were never published (there is no npm package
at all).

### Removed

- **npm publishing**: the Trusted Publishing / provenance workflow
  (`.github/workflows/publish.yml`) is deleted, so releasing a tag no longer
  triggers any npm step. Distribution is now GitHub Releases + source only; install
  with `dsh plugin add <repository URL or local path>`.

## [0.4.14] - 2026-11-05

Patch release. Versions 0.1.0–0.4.13 were never published.

### Changed

- **Pause is now a real, blocking lock.** While paused (manual click on the rings or
  the automatic sustained-idle pause) the DSH content is not interactive: the overlay
  captures hover/click/focus, so nothing expands or reacts underneath. Resume only via
  the 「继续计时」 button on the card (or Enter/Space/Escape on it); moving the mouse
  alone no longer resumes. Clicks on the card background do nothing and the forced
  rest / daily screens keep the same consistent card behaviour.

### Fixed

- **Ring widget alignment**: the two rings are now equal-width columns with centered
  values and captions (今日已用 / 连续使用), the continuous mm:ss is clearly readable
  inside the ring, and the card padding/baseline are balanced. The glass card,
  top-right position, click-to-pause button and smooth 1 s clock are unchanged.

## [0.4.10] - 2026-11-05

Patch release. Versions 0.1.0–0.4.9 were never published.

### Added

- **Click the two-ring widget to pause or resume**: the card is an interactive
  button again (`POST /pause`, and `POST /resume` while paused) with an in-flight
  guard against double-clicks, a pressed/disabled state, keyboard support
  (Enter/Space) and 「暂停计时」/「继续计时」 aria labels. The automatic sustained-idle
  pause and the smooth 1 s ring clock stay exactly as they were; both paths lead to
  the same shared pause card, and mouse/keyboard activity or a second click resumes.

## [0.4.8] - 2026-11-05

Patch release. Versions 0.1.0–0.4.7 were never published.

### Changed

- **Floating rings show their values**: each ring now has its number in the middle
  (today: minutes used; continuous: mm:ss), and the continuous clock is interpolated
  locally so it ticks smoothly every second instead of stepping with the ~5 s
  sampler.
- Sidebar graying is held for ~1.5 s after the running set becomes empty before it
  restores, so transient empty polls no longer make rows flicker back to normal.

### Fixed

- **Auto-pause no longer flashes**: the host enters the pause state only after
  sustained idle (two consecutive fresh samples), any active sample resets the
  counter, stale samples are ignored, and the pause card appears only once the
  state has held ~0.6 s. The shared card appears only when the pause is real.

## [0.4.7] - 2026-11-05

Patch release. Versions 0.1.0–0.4.6 were never published.

### Changed

- **Unified overlay card**: idle auto-pause, manual pause, the 10-minute forced rest
  and the 3-hour daily-limit screen all render the same today-usage card
  (title/reason + today's total + per-app breakdown) and differ only in title and
  actions. The old separate gray-only pause layer is gone.
- **All-done completion chime**: it rings only when **all running conversations have
  finished** (the root running set goes from non-empty to empty) and you are away.
  If several conversations run and only some finish, it stays silent; repeated
  chimes still stop on input and are capped at ~2 minutes.

### Added

- **Background daily-limit alert**: when the daily cap is reached while DSH is hidden
  or unfocused, the plugin tries `window.focus()` and posts one clickable system
  notification (plus a chime) to bring you back. Best effort only — a pure plugin
  cannot force the OS foreground window.

## [0.4.6] - 2026-11-05

Patch release. Versions 0.1.0–0.4.5 were never published.

### Fixed

- **One-conversation mode now pins to exactly one primary conversation.** It uses
  the running root conversation whose turn started most recently; every other
  conversation — **including other running ones** — is grayed and non-clickable, and
  the UI auto-jumps to the primary. This fixes the case where two conversations
  could be visible/normal at the same time.

### Added

- `/state.solo` now exposes `primary` (the primary session id, or `null`) alongside
  `active` and `sessions`.

## [0.4.5] - 2026-11-05

Patch release before the first public GitHub release. Versions 0.1.0–0.4.4 were
never published.

### Added

- Eighth settings control: **「专注时只允许一个对话」** (`assistant.soloSession`),
  which turns the one-conversation pinning (auto-jump + grayed, non-clickable
  sidebar) on or off.

### Fixed

- **Completion chime is root-only**: it now rings only when **your own conversation's**
  whole turn completes while you are away. Background subagent/teammate turns no
  longer trigger it. It repeats until keyboard/mouse input and is hard-capped at
  ~2 minutes, and it stops as soon as the window becomes visible/focused.

## [0.4.4] - 2026-11-05

First public release. Versions 0.1.0–0.4.3 were never published; 0.4.4 is the
initial GitHub release.

A pure DeepSeek Harness plugin that keeps one conversation in focus, tracks
whole-machine usage while DSH runs, and enforces a daily and a continuous limit
entirely inside DSH.

### Added

- **Display-only two-ring widget** (top-right): today's usage vs. the daily cap and
  continuous use vs. the continuous cap.
- **Automatic rest**: after `usage.autoPauseSeconds` (default 60 s, `0` = off) of
  keyboard/mouse idle the DSH window grays; real input resumes it.
- **Daily cap** (default 180 min): gray overlay with the shared “today usage” card —
  today's total, per-app breakdown — and 「再使用 20 分钟」 / 「跳过」.
- **Continuous cap** (30 min) with an activity-gated 10-minute rest; rest time is
  excluded from the daily total.
- **Shared today-usage card** for the rest and daily screens, with right-aligned
  action rows.
- **One conversation at a time**: auto-jump to the running conversation, grayed and
  non-clickable other conversation/folder rows, and a veil fallback; nothing is
  hidden and background agents keep working.
- **Away-only repeating completion chime** (window unfocused/hidden or idle past
  `alerts.awayIdleSeconds`), plus the Focus assistant panel with per-app statistics,
  a 7-day trend, an enable/pause switch and a short 7-field settings form.
- `scripts/e2e.mjs`: live HTTP smoke test for a running plugin.

### Changed

- Limits default to the product rules (3 h daily, 30 min continuous, 10 min rest);
  daily extensions are unlimited by default (`limits.dailyExtendLimit` 0 = unlimited,
  a positive value caps them).
- Settings UI is intentionally minimal: advanced knobs remain in the settings JSON
  and plugin API but are not exposed on the panel.

### Fixed

- Automatic rest is stable after resuming: returning to the machine no longer
  re-pauses immediately.
- The settings save/discard row is a normal right-aligned footer instead of a stuck
  bottom-left button.
- Folder/session sidebar state is never rewritten: the one-conversation mode grays
  and blocks clicks instead of hiding, so expanded folders are preserved.

### Notes

- Pure plugin: it cannot bring DSH to the front, block other applications, or count
  usage while DSH is closed. Those need a companion desktop guard, which is not part
  of this release.
