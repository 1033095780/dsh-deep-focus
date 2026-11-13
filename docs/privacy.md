# Privacy

`dsh-deep-focus` runs locally inside the DeepSeek Harness Host, stores two settings on
your machine, and contacts exactly one remote endpoint — the DingTalk webhook — and only
when you ask it to send a notification.

| Question | Answer |
| --- | --- |
| Telemetry? | No analytics, no crash reporting, no accounts. |
| What is stored? | DingTalk enabled flag + robot token, in a local JSON file. |
| Where? | `$DSH_HOME/plugin-data/dsh-deep-focus/settings.json` (`$DSH_HOME` defaults to `~/.dsh`). |
| Is the token sent to the browser? | No. The API exposes only “configured” and the last 4 characters. |
| What leaves the machine? | Only DingTalk text messages you configured: `[+] 会话已完成：<title>，用时 <n> 分钟，完成时间 HH:MM` and the `[+]` test message. |
| To where? | `https://oapi.dingtalk.com/robot/send?access_token=<your token>` only. |
| Message content included? | No — only the conversation title, elapsed minutes and finish time. No prompts, replies, files or code. |
| Background activity? | None. No sampling, no network polling, no access to other apps. |
| Delete data? | Delete `$DSH_HOME/plugin-data/dsh-deep-focus/` or uninstall the plugin. |

## What is stored

```text
$DSH_HOME/plugin-data/dsh-deep-focus/
└── settings.json   # { version, notifications: { dingtalkEnabled, dingtalkToken } }
```

The file is written atomically and is readable by your user account. The lock overlay is
never persisted; restarting DSH always starts unlocked.

## Local completion reminder

On an automatic lock completion (never on 「跳过」) the browser may show a local computer
notification 「会话已完成」 and always shows a ~5 s in-page banner. They are rendered by the
browser and need only the optional browser notification permission: the title/body contain
just the conversation title and elapsed minutes, they make **no network requests**, and
they never include the DingTalk token or message content. If the browser denies the
permission or cannot show notifications, the plugin silently falls back to the in-page
banner.

## Network and permissions

- The only outbound requests are DingTalk webhook posts for a completion message or a
  test message. They carry the token in the URL, as DingTalk robots require.
- No browser notification permission, no microphone/camera/clipboard/file access, no
  native code, no helper processes.
- The Host sends no data at all while the plugin is idle or locked.

## DingTalk side

DingTalk receives the message above and the robot token; retention and visibility there
are governed by your DingTalk organisation, not by this plugin. Use a robot dedicated to
this purpose and rotate the token if it leaks. Messages start with `[+] ` so they are easy
to filter in DingTalk.

## Security notes

- Treat `plugin-data/dsh-deep-focus` as private: anyone with read access to your user
  files can see the robot token.
- The plugin never prints the token to logs or error messages.
- It cannot stop the model or other applications; skipping the overlay does not cancel
  the running work.
- Do not paste the settings file into public issue reports.
