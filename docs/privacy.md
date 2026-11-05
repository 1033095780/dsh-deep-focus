# Privacy

`dsh-deep-focus` is deliberately boring about data. It runs locally inside the
DeepSeek Harness Host process, stores a small amount of JSON under your DSH home
directory, and **never makes a network request**.

v0.3 keeps the v0.2 data collection (idle time + the foreground application's
process name) and adds limits/rest state. It still never reads window titles,
keystrokes, clipboard contents, or the contents of any application. It also never
enforces anything outside DSH: no other application is blocked, and nothing is
counted while DSH is closed.

## Summary

| Question | Answer |
| --- | --- |
| Does the plugin collect telemetry? | No. No analytics, no crash reporting, no accounts. |
| Does it send data anywhere? | No. The Host half has no outbound HTTP client or socket. |
| What does the sampler read? | Idle time (seconds since last keyboard/mouse input) and the **foreground process name**. |
| What is stored about apps? | A stable app key (lowercase executable name), a friendly display name, and milliseconds. |
| Are window titles or keys stored? | No. Never. |
| Does it block other applications? | No. Only DSH renders overlays; the OS is not touched. |
| Where is data stored? | `$DSH_HOME/plugin-data/dsh-deep-focus/` — local disk only. |
| Can I turn app tracking off? | Yes: set `usage.trackApps` to off; only total active time is kept. |
| Can I delete it? | Yes: delete that directory (or uninstall the plugin). |
| Is there a password? | No. There is nothing to unlock with one. |

## What is stored

Everything lives in one directory:

```text
$DSH_HOME/plugin-data/dsh-deep-focus/
├── settings.json            # v3 runtime settings (mode 0600)
├── limits.json              # today's daily lock, extension window/count, rest state
└── usage/
    └── YYYY-MM-DD.jsonl     # ~one aggregate line per minute: { t, activeMs, apps }
```

- `$DSH_HOME` is the usual DSH home directory. When it is not set, the plugin falls
  back to `~/.dsh`.
- `settings.json` is written with owner-only permissions (`0600`) on POSIX. It
  holds the v3 settings (`limits`, `assistant`, `alerts`, `usage`). There are no
  secrets in it.
- **Migration:** a settings file written by v1/v2 is not migrated — it is replaced
  with the v3 defaults the first time the plugin loads, because older schemas had
  different limits that the user did not choose under v0.3.
- `usage/*.jsonl` lines look like
  `{ "t": 1762345678901, "activeMs": 61234, "apps": { "chrome": 32100, "code": 29134 } }`.
  They contain **no window titles, no URLs, no keystrokes, no file paths, no
  screen content** — only application identifiers and durations.
- **Rest time is excluded:** while the forced rest is running, samples are not
  added to the daily total, the continuous counter, or the per-app buckets.
- The browser half stores **one** small item in `localStorage`: a per-day
  acknowledgment flag written by the daily overlay's “That's it for today” button
  (`dsh-deep-focus.ack.YYYY-MM-DD = "1"`). It contains no usage data. Everything
  else lives in memory and is re-fetched from the Host.

## What the foreground sampler reads

To tell "the machine is in use" and "which app is in use", the Host reads local
operating-system state:

| OS | Mechanism | Data read |
| --- | --- | --- |
| Windows | Long-lived `powershell -NoProfile` child: `GetLastInputInfo` + `GetTickCount64`, then `GetForegroundWindow` + `GetWindowThreadProcessId` + `Process.GetProcessById(pid).ProcessName` | Idle milliseconds; foreground process id and **executable/process name** |
| macOS | `ioreg -c IOHIDSystem` (`HIDIdleTime`); `osascript` asking System Events for the frontmost application (best effort) | Idle nanoseconds; frontmost application name |
| Linux | `xprintidle`; `xdotool getactivewindow getwindowpid` + `/proc/<pid>/comm` (best effort) | Idle milliseconds; active window's process name |

The commands are fixed strings; no user data is interpolated into a shell. The
sampler process is owned by the plugin and is killed when the plugin unloads. macOS
and Linux foreground detection is best effort: when it fails, total idle-based
activity keeps counting and app sampling reports off.

A sample is counted as *active* only when the idle time is below
`usage.idleThresholdSeconds`. Nothing about *what you did inside* an application is
recorded — only that it was the foreground process at that moment.

## App names

`src/host/apps.js` maps process names to friendly labels (browser, QQ, WeChat,
VS Code, DeepSeek Harness, terminal, …). The mapping is a local constant; nothing is
looked up online. Unknown executables are stored under their own base name.

## Retention

- Per-day usage files are pruned after `usage.retentionDays` days (default 30);
  legacy `stats/` files from older versions are pruned too.
- `settings.json` and `limits.json` are small and stay until you delete them.
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
   immediately, the solo-mode hiding is removed, and the sidebar returns to normal.
2. Delete `$DSH_HOME/plugin-data/dsh-deep-focus/` (on Windows, the same path under
   your DSH home, e.g. `%USERPROFILE%\.dsh\plugin-data\dsh-deep-focus`).

That removes settings, limits/rest state, and all usage history. There is nothing
to revoke on a server because nothing is uploaded.

## Security notes

The assistant is a self-discipline aid, not a security boundary:

- It **never blocks tool calls** and never interrupts another conversation's agent.
- It cannot bring DSH to the front, cannot block other applications, and cannot
  count or enforce anything while DSH is closed. Those would require a separate
  desktop guard, which v0.3 does not include.
- Its overlays and countdown exist only inside the DSH window; switching to another
  application is always possible. **Rest time is not enforced outside DSH.**
- The data is readable by your user account; treat it as personal activity
  metadata (it reveals which apps you used and for how long), not as sensitive
  content.

## Reporting privacy issues

See the repository's issue tracker. Please do not include personal data from the
data directory in a report; the JSON files contain timestamps, app names and
durations, which may be enough to identify your working hours.
