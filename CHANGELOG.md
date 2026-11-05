# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.3.0] - Unreleased

First public release. Versions 0.1.0 and 0.2.0 were never published; 0.2.0 started
the "pure plugin, no blocking" direction, and 0.3.0 turns it into a focus assistant
with default usage limits. Install it with:

```bash
dsh plugin --profile desktop add dsh-deep-focus
```

### Added

- **「专注助手」 / “Focus assistant” panel** — one sidebar entry below the Plugins
  row (`sidebar.panellist` + keyed `main` page) with an overview (today's usage,
  continuous timer, daily/continuous progress, per-app breakdown, 7-day trend),
  the full settings form, and an enable/pause switch. It replaces the separate
  “Usage” panel.
- **Daily usage cap, on by default** — whole-machine active time while DSH runs is
  capped at **180 minutes (3 hours)** by default. When reached, DSH shows a gray
  overlay with today's total, a per-app breakdown and a **“Use 20 more minutes”**
  action (`limits.extendMinutes`, default 20; up to `limits.dailyExtendLimit`,
  default 2 per day). “That's it for today” simply hides the overlay for the
  current day.
- **Continuous-use cap → forced rest, on by default** — after **30 continuous
  minutes** the assistant immediately starts a **10-minute rest**: a calm
  full-screen rest screen inside DSH, with the rest time excluded from the daily
  total and the continuous counter reset when it ends.
- **Top-right countdown chip** in the DSH window header
  (`conversation.session.header.utilities`): continuous time remaining, rest time
  remaining, or “today's cap used up”. Toggleable with `assistant.showCountdown`.
- **One conversation at a time, default on** — while any root conversation's agent
  is running, other folders and conversations are temporarily hidden from the
  sidebar (one injected style node + banner) and restored when it finishes.
  Background agents keep working; no tool call is blocked.
- **New Host state machine and API** — `limits`/rest evaluation and new routes
  `GET /state`, `POST /assistant`, `POST /rest/start`, `POST /rest/finish`,
  `POST /extend` (plus the existing `/apps` and `/settings`). The plugin entry no
  longer renders a pomodoro timer.
- **New settings groups** — `limits` (180/30/10/20/2 defaults), `assistant`
  (enabled, solo session, hide other sessions, countdown), `alerts`, `usage`.
- Documentation and the packaging smoke test were rewritten for v0.3, including an
  explicit pure-plugin capability-boundary section.

### Changed

- **Defaults now enforce** — the assistant is enabled out of the box with the 3-hour
  daily cap and 30-minute continuous cap. `assistant.enabled` can be turned off to
  keep statistics only.
- **Settings schema v3** — new groups `limits`, `assistant`, `alerts`, `usage`; a
  stored settings file from an older schema is discarded and replaced with the v3
  defaults.
- **Usage statistics moved** under the Focus assistant panel; per-app tracking
  itself is unchanged (foreground application name + duration only).
- **Storage state** now keeps the limits/rest state instead of the removed focus
  block state.
- **Rest time is excluded** from the daily usage total and from per-app totals.

### Removed

- **The pomodoro timer and everything around it** — work/break blocks, the composer
  focus pill, 25/5 presets and rounds, long breaks, pomodoro counters, the
  `/focus/*` API routes, focus events, and `src/host/focus.js`.
- **The v0.2 overtime flow** — the `focus`/`budget` settings
  (`limits.dailyActiveMinutes`, `continuousWorkMinutes`, `sessionMinutes`,
  `unlockMinutes`) and the click-to-continue overlay are replaced by the daily cap
  and its extension action.
- **The separate “Usage” sidebar entry** — it is now part of the Focus assistant
  panel.
- **“Locked” / focus-block copy** that implied a hard lock; the assistant only
  guides inside DSH and never blocks tools or other agents.

### Notes

- v0.3 is a **pure DSH plugin**: it cannot bring DSH to the front, cannot block
  other applications, and cannot count usage while DSH is closed. A companion
  desktop guard that would cover those cases is a possible later phase and is not
  part of this release.
