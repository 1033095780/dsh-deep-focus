# Privacy

`dsh-deep-focus` is deliberately boring about data. It runs locally inside the
DeepSeek Harness Host process, stores a small amount of JSON under your DSH home
directory, and **never makes a network request**.

## Summary

| Question | Answer |
| --- | --- |
| Does the plugin collect telemetry? | No. No analytics, no crash reporting, no accounts. |
| Does it send data anywhere? | No. The Host half has no `fetch`, no HTTP client, and no outbound socket. |
| What does the sampler read? | Only **how many seconds the whole machine has been idle** (no keyboard/mouse content). |
| Where is data stored? | `$DSH_HOME/plugin-data/dsh-deep-focus/` — local disk only. |
| Can I delete it? | Yes: delete that directory (or uninstall the plugin). |
| Is the password protected? | A salted scrypt hash is stored locally; the plaintext is never written to disk. |

## What is stored

Everything lives in one directory:

```text
$DSH_HOME/plugin-data/dsh-deep-focus/
├── settings.json            # runtime settings + salted scrypt password hash (mode 0600)
├── focus.json               # the current focus block, used to recover after a restart
├── budget.json              # today's lock state and unlock counter
├── usage/
│   └── YYYY-MM-DD.jsonl     # activity deltas in milliseconds, one line per flush (~10 s)
└── stats/
    └── YYYY-MM-DD.jsonl     # per-day aggregates used by the "last 7 days" chart
```

- `$DSH_HOME` is the usual DSH home directory. When it is not set, the plugin
  falls back to `~/.dsh`.
- `settings.json` is written with owner-only permissions (`0600`) on POSIX. It
  holds the plugin settings and `security.passwordHash` / `security.passwordSalt`
  (random 16-byte salt, 64-byte scrypt key, N=16384, r=8, p=1). The plaintext
  password exists only in memory for the duration of the request; it is never
  written, logged, or returned by any API.
- Activity records contain only `{ t, day, ms }` values: a timestamp, a local
  calendar day key, and how many milliseconds were active. They contain **no
  application names, window titles, URLs, keystrokes, or file paths**.
- `focus.json` holds the current focus block (phase, task name, session id,
  timestamps); `budget.json` holds the lock reason, grace deadline and today's
  unlock counter. Neither contains content from your conversations.
- The browser half keeps no persistent browser storage. The last state snapshot
  lives in memory only and is re-fetched from the Host.

## What the idle sampler reads

To tell "the machine is in use" from "the machine is idle", the Host reads the
operating system's idle timer:

| OS | Mechanism | Data read |
| --- | --- | --- |
| Windows | Long-lived `powershell -NoProfile` child calling `GetLastInputInfo` + `GetTickCount64` | Milliseconds since the last keyboard/mouse input |
| macOS | `ioreg -c IOHIDSystem`, `HIDIdleTime` | Nanoseconds since the last HID input, converted to milliseconds |
| Linux | `xprintidle` (X11) | Idle milliseconds; if the tool is unavailable the sampler reports `degraded`/`off` |

The commands are fixed strings; no user data is interpolated into a shell. The
sampler process is owned by the plugin and is killed when the plugin unloads.
This is the same "AFK" measurement approach used by projects such as
[ActivityWatch](https://activitywatch.net/).

A sample is counted as *active* only when the idle time is below
`usage.idleThresholdSeconds`. Nothing about *what* you did is recorded — only
whether input happened recently.

## Retention

- Per-day activity files are pruned after `usage.retentionDays` days (default 30).
- `settings.json` and `focus.json` are small and stay until you delete them.
- No data is ever copied outside the data directory.

## Network

None. The plugin:

- does not call any remote API, including the DeepSeek API;
- does not download sounds, fonts, images, or updates;
- does not include third-party advertising, analytics, or crash SDKs;
- has no runtime npm dependencies at all.

If you audit the code, the only external processes started are the platform
idle-time commands listed above.

## Removing your data

1. Uninstall/disable the plugin in DSH.
2. Delete `$DSH_HOME/plugin-data/dsh-deep-focus/` (on Windows, the same path under
   your DSH home, e.g. `%USERPROFILE%\.dsh\plugin-data\dsh-deep-focus`).

That removes settings, the password hash, the current focus block, and all
activity history. There is nothing to revoke on a server because nothing is
uploaded.

## Security notes (read this)

The overtime lock is a **self-discipline mechanism, not a security boundary**:

- The password is checked locally; anyone who can read or edit the data directory
  can clear it, and restarting DSH bypasses a lock (the lock state lives in the
  process, and focus recovery is intentionally forgiving).
- The lock does not encrypt anything, block the operating system, or prevent you
  from quitting the app.
- Treat the password as a deliberate speed bump, not as protection against an
  attacker with access to your user account.

The same applies to the one-conversation lock: the Host-side tool guard is a real
interruption for agents, but the sidebar interception is best effort and depends on
DSH DOM details.

## Reporting privacy issues

See the repository's issue tracker. Please do not include personal data from the
data directory in a report; the JSON files contain timestamps and durations, which
may be enough to identify your working hours.
