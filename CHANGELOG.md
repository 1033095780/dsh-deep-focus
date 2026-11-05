# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.0] - Unreleased

First public release of `dsh-deep-focus`, a DeepSeek Harness plugin that keeps one
conversation in focus while you work. Install it with:

```bash
dsh plugin --profile desktop add dsh-deep-focus
```

### Added

- **Pomodoro focus blocks** — focus/break cycles (25/5 by default, long break every
  four rounds), countdown pill in the composer, in-app panel, completion toast and a
  synthesized two-tone chime. Plans recover from the stored deadline, so refreshing the
  page or reopening the app does not restart the timer.
- **One-conversation lock** — while a focus block or an agent turn is running, the other
  conversations in the sidebar are dimmed and cannot be entered, and the Host refuses
  their tool calls. Subagents and Agent Teams members owned by the locked conversation
  are exempt.
- **Whole-machine activity tracking while DSH runs** — samples system idle time
  (`GetLastInputInfo` on Windows, `HIDIdleTime` on macOS, X11/DBus on Linux) every few
  seconds and counts a sample as active only when keyboard or mouse input was recent.
  Today's active time, continuous work time and a 7-day bar chart are shown in the
  plugin's settings section.
- **Overtime lock with password unlock** — locks the app when the daily active, continuous
  work, or single-session limit is exceeded. Typing the locally stored unlock password
  grants another 20 minutes; a strict mode allows only a forced break, and an optional
  daily unlock cap limits retries.
- Bilingual UI and plugin metadata (English / Chinese), light and dark theme support
  through DSH theme tokens.
- Local-only persistence in `$DSH_HOME/plugin-data/dsh-deep-focus/`; no network access,
  no telemetry.
- Offline packaging smoke test (`node scripts/verify.mjs`), GitHub Actions CI on Node 20
  and 22, and an npm publish workflow using Trusted Publishing (OIDC) with no tokens in
  the repository.
- Documentation: `docs/design.md`, `docs/privacy.md`, `docs/publishing.md`.

### Known limitations

- Activity is only sampled while DSH is running; time with DSH closed is not tracked and
  is shown as untracked.
- Windows is the first-class, tested platform; macOS and Linux sampling is best effort.
- The sidebar lock is best effort (DOM interception); the Host-side tool guard is the hard
  boundary.
- The password unlock is friction, not a security boundary: restarting DSH or editing the
  local data directory bypasses the lock.
