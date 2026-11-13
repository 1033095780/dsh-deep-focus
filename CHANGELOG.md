# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [1.0.0] - 2026-11-13

Complete rewrite: the plugin now has exactly one job — lock DSH to the conversation you
just sent a message in until its whole task tree finishes, optionally notify you on
DingTalk, and let you skip the lock.

### Added

- **Conversation task lock**: after sending a message, a full-screen overlay locks the UI
  to that conversation (title + elapsed time); other conversations are unusable until the
  lock is released.
- **Automatic release** when the root turn closes **and every subagent/child session it
  started is idle** (event-driven, with a short settle and a safety reconcile pass).
- **Optional DingTalk completion notice**: one text message starting with `[+] `
  (`[+] 会话已完成：<title>，用时 <n> 分钟，完成时间 HH:MM`) when auto-released and
  DingTalk is configured.
- **Skip button**: 「跳过」 releases the lock immediately and sends nothing.
- **Minimal settings page**: DingTalk enable switch, robot token (stored locally, never
  returned to the browser — only “set / last 4 chars”), save/keep/clear, and a test
  message button.
- API routes `/state`, `/settings`, `/lock/skip`, `/notifications/test`; scripted live
  e2e test (`scripts/e2e.mjs`).

### Changed

- Settings are now only `notifications.dingtalkEnabled` and `notifications.dingtalkToken`
  (contract v5); the Host is event-driven and keeps no background counter or helper
  process.
- The browser bundle is a single self-contained module polling 1 s while locked, 3 s when
  idle and 5 s while hidden; it hides the overlay after repeated API failures.

### Removed

- The earlier focus/timing product and all of its features, UI, API routes, settings and
  documentation (usage sampling, daily/continuous caps, forced breaks, pause, tracking
  mode, rings, dashboard statistics, chime/solo/sidebar behaviours) are gone. There is no
  settings migration; the old data directory is not read.
