# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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
