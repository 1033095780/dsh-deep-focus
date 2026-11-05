# Privacy

`dsh-deep-focus` is deliberately boring about data. It runs locally inside the
DeepSeek Harness Host process, stores a small amount of JSON under your DSH home
directory, and **never makes a network request**.

v0.2 changed what is collected: instead of only measuring whole-machine idle time,
the sampler also records **which foreground application was in use** (application
name and duration). It still never reads window titles, keystrokes, clipboard
contents, or the contents of any application.

## Summary

| Question | Answer |
| --- | --- |
| Does the plugin collect telemetry? | No. No analytics, no crash reporting, no accounts. |
| Does it send data anywhere? | No. The Host half has no outbound HTTP client or socket. |
| What does the sampler read? | Idle time (seconds since last keyboard/mouse input) and the **foreground process name**. |
| What is stored about apps? | A stable app key (lowercase executable name), a friendly display name, and milliseconds. |
| Are window titles or keys stored? | No. Never. |
| Where is data stored? | `$DSH_HOME/plugin-data/dsh-deep-focus/` — local disk only. |
| Can I turn app tracking off? | Yes: set `usage.trackApps` to off; only total active time is kept. |
| Can I delete it? | Yes: delete that directory (or uninstall the plugin). |
| Is there a password? | No. v0.2 removed the unlock password entirely. |

## What is stored

Everything lives in one directory:

```text
$DSH_HOME/plugin-data/dsh-deep-focus/
├── settings.json            # runtime settings (mode 0600)
├── focus.json               # the current focus block, used to recover after a restart
├── budget.json              # overtime-lock state (reason, grace deadline)
├── usage/
│   └── YYYY-MM-DD.jsonl     # ~one aggregate line per minute: { t, activeMs, apps }
└── stats/
    └── YYYY-MM-DD.jsonl     # per-day focus/break aggregates for the 7-day chart
```

- `$DSH_HOME` is the usual DSH home directory. When it is not set, the plugin falls
  back to `~/.dsh`.
- `settings.json` is written with owner-only permissions (`0600`) on POSIX. It
  holds only the v0.2 settings (`focus`, `limits`, `alerts`, `usage`). There is no
  password hash: v0.2 ignores and drops legacy `security`/`lock` sections the next
  time settings are saved.
- `usage/*.jsonl` lines look like
  `{ "t": 1762345678901, "activeMs": 61234, "apps": { "chrome": 32100, "code": 29134 } }`.
  They contain **no window titles, no URLs, no keystrokes, no file paths, no
  screen content** — only application identifiers, display names (resolved in
  the browser from the local mapping) and durations.
- The browser half keeps no persistent browser storage. The last state snapshot
  lives in memory only and is re-fetched from the Host.

## What the foreground sampler reads

To tell "the machine is in use" and "which app is in use", the Host reads local
operating-system state:

| OS | Mechanism | Data read |
| --- | --- | --- |
| Windows | Long-lived `powershell -NoProfile` child: `GetLastInputInfo` + `GetTickCount64`, then `GetForegroundWindow` + `GetWindowThreadProcessId` + `Process.GetProcessById(pid).ProcessName` | Idle milliseconds; foreground process id and **executable/process name** |
| macOS | `ioreg -c IOHIDSystem` (`HIDIdleTime`); `osascript` asking System Events for the frontmost application (best effort) | Idle nanoseconds; frontmost application name |
| Linux | `xprintidle`; `xdotool getactivewindow getwindowpid` + `/proc/<pid>/comm` (best effort) | Idle milliseconds; active window's process name |

The commands are fixed strings; no user data is interpolated into a shell. The
sampler process is owned by the plugin and is killed when the plugin unloads.

A sample is counted as *active* only when the idle time is below
`usage.idleThresholdSeconds`. Nothing about *what you did inside* an application is
recorded — only that it was the foreground process at that moment.

## App names

`src/host/apps.js` maps process names to friendly labels (browser, QQ, WeChat,
VS Code, DeepSeek Harness, terminal, …). The mapping is a local constant; nothing
is looked up online. Unknown executables are stored under their own base name.

## Retention

- Per-day usage and stats files are pruned after `usage.retentionDays` days
  (default 30).
- `settings.json`, `focus.json` and `budget.json` are small and stay until you
  delete them.
- No data is ever copied outside the data directory.

## Network

None. The plugin:

- does not call any remote API, including the DeepSeek API;
- does not download sounds, fonts, images, or updates;
- does not include third-party advertising, analytics, or crash SDKs;
- has no runtime npm dependencies at all.

If you audit the code, the only external processes started are the platform
idle/foreground probes listed above.

## Removing your data

1. Disable or uninstall the plugin in DSH. Every UI element it renders disappears
   immediately and the sidebar returns to normal (all inline styles are restored).
2. Delete `$DSH_HOME/plugin-data/dsh-deep-focus/` (on Windows, the same path under
   your DSH home, e.g. `%USERPROFILE%\.dsh\plugin-data\dsh-deep-focus`).

That removes settings, focus state, overtime state, and all usage history. There is
nothing to revoke on a server because nothing is uploaded.

## Security notes

v0.2 has no enforcement mechanism to attack or bypass:

- There is **no tool guard**, no Host-side conversation lock, and no password.
- Focus mode only dims sidebar entries and shows a reminder; it never prevents an
  agent from working or a conversation from receiving messages.
- The overtime overlay is a nudge: limits are off by default, and “Use 20 more
  minutes” always works with a single click. Restarting DSH or disabling the plugin
  always gets you out.
- The data is readable by your user account; treat it as personal activity
  metadata (it reveals which apps you used and for how long), not as sensitive
  content.

## Reporting privacy issues

See the repository's issue tracker. Please do not include personal data from the
data directory in a report; the JSON files contain timestamps, app names and
durations, which may be enough to identify your working hours.
