# Privacy

`dsh-deep-focus` runs locally inside the DeepSeek Harness Host process, stores a small
amount of JSON under your DSH home directory, and **never makes a network request**.

| Question | Answer |
| --- | --- |
| Telemetry? | No analytics, no crash reporting, no accounts. |
| Sent anywhere? | No. The Host has no outbound HTTP client or socket. |
| What does the sampler read? | Idle time and the **foreground application's process name** only. |
| Any window titles / keystrokes? | **No.** Never. |
| Blocks other applications? | No — overlays are drawn only inside the DSH window. |
| Stored data? | App key + display name + duration, focus/limit state, settings. |
| Data location? | `$DSH_HOME/plugin-data/dsh-deep-focus/`, local disk only. |
| Delete it? | Delete that directory or uninstall the plugin. |

## What is stored

```text
$DSH_HOME/plugin-data/dsh-deep-focus/
├── settings.json          # runtime settings (mode 0600)
├── limits.json            # daily lock/extension, rest and pause state
└── usage/
    └── YYYY-MM-DD.jsonl   # ~1 aggregate line per minute: { t, activeMs, apps }
```

- `$DSH_HOME` is the DSH home; unset means `~/.dsh`.
- A usage line contains only a timestamp, an active-time total and a map of
  lowercase executable names to milliseconds. **No window titles, URLs, keystrokes,
  file paths or screen content.**
- The browser keeps one `localStorage` item: the per-day daily-overlay “跳过”
  acknowledgment flag (`dsh-deep-focus.ack.YYYY-MM-DD`). No usage data.
- Settings files from v1–v3 are discarded and replaced by v4 defaults (never
  migrated).

## What the sampler reads

| OS | Mechanism | Data read |
| --- | --- | --- |
| Windows | `GetLastInputInfo` + `GetTickCount64`; `GetForegroundWindow` + `GetWindowThreadProcessId` + `Process.GetProcessById(pid).ProcessName` | idle ms; foreground process name |
| macOS | `ioreg` `HIDIdleTime`; `osascript` frontmost app (best effort) | idle ns; app name |
| Linux | `xprintidle`; `xdotool getactivewindow getwindowpid` + `/proc/<pid>/comm` | idle ms; process name |

Commands are fixed strings (no user data interpolated); the sampler child is
killed when the plugin unloads. Foreground detection is best effort on macOS/Linux;
when it fails, total idle-based activity keeps counting and app sampling reports
`off`.

A sample counts as active only when idle < `usage.idleThresholdSeconds`. **The
automatic rest and the away-aware completion chime reuse this same signal — no new
data is recorded** — and paused/resting time is excluded from the daily total.

## Retention and network

- Usage files are pruned after `usage.retentionDays` (default 30); legacy `stats/`
  files are pruned too. `settings.json` and `limits.json` stay until you delete them.
- No data is copied outside the data directory.
- The plugin calls no remote API, downloads nothing, bundles no analytics/crash SDK,
  and has no runtime npm dependencies.

## Removing your data

1. Disable or uninstall the plugin — all its UI disappears immediately and the
   sidebar returns to normal.
2. Delete `$DSH_HOME/plugin-data/dsh-deep-focus/` (on Windows e.g.
   `%USERPROFILE%\.dsh\plugin-data\dsh-deep-focus`).

Nothing is uploaded, so nothing else needs revoking.

## Security notes

This is a self-discipline aid, not a security boundary:

- It never blocks tool calls or interrupts another conversation's agent.
- It cannot bring DSH to the front, block other applications, or count/enforce while
  DSH is closed; rest and pause are not enforced outside DSH.
- Data is readable by your user account — treat it as personal activity metadata,
  not sensitive content.

Please do not paste the data files into public issue reports; timestamps and app
durations can reveal your working hours.
