# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.2.0] - Unreleased

First public release (the unreleased 0.1.0 draft is superseded and was never
published). This version is a product rewrite driven by user feedback: the plugin
no longer blocks anything, focus mode is gentle sidebar guidance, usage is tracked
per foreground application, and the overtime overlay is dismissed with one click.

Install it with:

```bash
dsh plugin --profile desktop add dsh-deep-focus
```

### Added

- **Per-application usage statistics** — samples the foreground application and
  records app name + duration (DeepSeek Harness, browsers, QQ, WeChat, VS Code,
  terminals, …). New `GET /apps?days=7` API, a **Usage** panel registered in the
  sidebar below the Plugins row (`sidebar.panellist` + keyed `main` panel), today's
  totals, a per-app breakdown, and a 7-day trend.
- **Gentle focus mode** — while a focus block runs, other conversations are grayed
  out in the sidebar; clicking one shows a friendly reminder instead of switching.
  The focused conversation stays fully usable. Controlled by
  `focus.grayOutOtherSessions`.
- **Click-to-continue overtime overlay** — when a limit the user opted into is
  exceeded, a gentle full-screen overlay offers “Use 20 more minutes” (one click,
  `limits.unlockMinutes`, default 20) and “Take a break”. No password, no quiz.
- New settings: `focus.grayOutOtherSessions`, `usage.trackApps`; all three overtime
  limits now default to `0` (off).
- A documented v2 wire contract (`src/shared/contract.js`) with the `/apps` route
  and the v2 `/state` shape.

### Changed

- **Focus mode is UI-only.** The Host no longer participates in conversation
  control: other conversations' agents keep working, and the current conversation
  is never locked out.
- **Usage tracking** moved from idle-time-only totals to foreground-app
  aggregation; daily JSONL files now store one aggregate line per flush
  (`{ t, activeMs, apps }`) instead of per-sample deltas.
- **Settings schema v2** — groups are `focus`, `limits`, `alerts`, `usage`; the
  configuration table in the READMEs is regenerated from the contract.
- **Robustness** — when the Host is unreachable or the plugin is disabled, the
  browser half hides every element it renders and immediately restores all sidebar
  styles instead of leaving stale gray rows or swallowed clicks.
- **Docs** — README (EN/zh), `docs/design.md`, `docs/privacy.md`,
  `docs/publishing.md` and the packaging smoke test were rewritten for the v0.2
  product.

### Removed

- **Tool guard and all tool blocking** — no `ctx.tools.guard`, no tool-call denial,
  no Host-enforced single-conversation lock; `tools` was removed from the plugin's
  injected services.
- **Password support** — no scrypt hashing, no password settings, no
  password-unlock request body, no “enter your password” UI.
- **v1 lock settings** — `lock.*` (single conversation / block tools / sidebar
  lock / exempt subagents), `limits.dailyUnlockLimit`, `limits.strictNoUnlock` and
  `usage.detectMedia` are gone.
- The full-screen “locked” flow with a password field and Escape dismissal,
  replaced by the gentle overtime overlay.
