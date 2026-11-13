# dsh-deep-focus

A one-feature bundle for DeepSeek Harness (repository:
<https://github.com/1033095780/dsh-deep-focus>): after you **send a message in a
conversation**, the UI locks to that conversation until it **and all of its
subagents/child sessions are completely finished**. Then it unlocks automatically and,
when configured, sends a **DingTalk completion message** starting with `[+] `. A
「跳过」 button on the overlay unlocks immediately.

English | [简体中文](README.zh.md)

## What it does

1. You send a message in a conversation.
2. A full-screen overlay covers DSH, showing 「任务进行中」, the conversation title and the
   elapsed time. Other conversations cannot be used while it is up.
3. When that conversation's turn **and every subagent/child session it started** have
   finished, the overlay disappears automatically.
4. If DingTalk is configured, one text message is sent to your DingTalk robot:
   `[+] 会话已完成：<title>，用时 <n> 分钟，完成时间 HH:MM`
   (the time comes from the host clock; the token never leaves your machine).

Partial completion does not unlock: while any child session is still working the overlay
stays up. Errors also end the turn and unlock.

## Why

Long agent runs are easy to leave unattended, and it is easy to accidentally start a
second task in another conversation meanwhile. This plugin makes one conversation the
only usable one until its whole task tree is done, then pings you on DingTalk so you can
come back at the right moment.

## Requirements

- DeepSeek Harness `0.2.2-rc.1` (also accepts `0.2.0-rc.2` / `0.2.1-rc.2`), desktop install.
- Node 20+ is only needed for development; the plugin ships as source and has no build step.
- A DingTalk group robot (optional) if you want completion messages.

## Install

This project is **not published to npm**. Install it from the repository or a local
checkout:

```bash
dsh plugin --profile desktop add https://github.com/1033095780/dsh-deep-focus
# or
dsh plugin --profile desktop add /absolute/path/to/dsh-deep-focus
```

No runtime dependencies and no build step; disabling or uninstalling removes the overlay
and settings page immediately.

## Enable

Open the **Plugins** page, enable the bundle, then restart/reload the DSH window if the
overlay does not appear on the next message.

## Settings

Open the **Conversation lock** sidebar entry (「会话锁」) → 「DingTalk notification」:

| Control | Meaning |
| --- | --- |
| Enable DingTalk notification | Turns completion messages on/off. The lock works either way. |
| DingTalk robot access_token | Paste the `access_token=...` value from your DingTalk group robot webhook. It is stored only in the local plugin data directory and is never sent back to the browser (only “set / last 4 characters” is shown). Leave the field empty to keep the current token; use 「清除」 to remove it. |
| Save | Stores the settings locally. |
| Send test message | Sends a `[+] ` test message now; it is disabled until a token is configured and reports success/failure inline. |

The completion message is sent only when a locked conversation finishes (never on skip).
It begins with `[+] ` so your DingTalk filter can find it.

<!-- config-table:start -->
| Setting | Default | Unit | Notes |
| --- | ---: | ---: | --- |
| `notifications.dingtalkEnabled` | Off | — | Send a completion message to DingTalk when a locked conversation finishes. The lock itself works either way. |
| `notifications.dingtalkToken` | (unset) | — | DingTalk group-robot access token. Stored only in the local plugin data directory; the browser only sees “set” and the last 4 characters. |
<!-- config-table:end -->

## Skipping

Click 「跳过」 on the overlay to unlock immediately. No DingTalk message is sent on skip;
the current conversation keeps running — the overlay only stops blocking the UI.

## Privacy

- The DingTalk robot token is stored in `$DSH_HOME/plugin-data/dsh-deep-focus/settings.json`
  on your machine. It is never included in the browser state (only “configured” and the
  last 4 characters) and is never uploaded anywhere except, at your request, to the
  DingTalk webhook when a completion message or test message is sent.
- The only network requests are to `oapi.dingtalk.com` for those messages. There is no
  telemetry, no account, no analytics and no background sampling.
- Completion messages contain the conversation title, elapsed minutes and finish time —
  no message content, file paths, code or browsing activity.

See [docs/privacy.md](docs/privacy.md).

## Performance

- The Host is event-driven: it reacts to session/turn events and keeps no sampler process.
- The client uses one lightweight state store and a chained `setTimeout` poll: 1 s while
  locked, 3 s when idle, 5 s when the window is hidden. No intervals are left running.
- If the Host becomes unreachable, the overlay hides after three consecutive failed polls
  so a broken connection cannot block the UI forever.

## Limitations

- Best effort, pure plugin: it cannot stop the model, kill a run, control other
  applications or force the DSH window to the foreground. Closing DSH ends the lock.
- A conversation is considered finished when the turn closes; a model/network error also
  closes it and unlocks.
- DingTalk messages need a working network path and a valid robot token; when DingTalk is
  not configured, the product is lock + skip only.
- The token is stored in a local JSON file readable by your user account; treat
  `plugin-data/dsh-deep-focus` as private.

## FAQ

**Does it lock other conversations?** They are behind the overlay and cannot be used
while it is up. The locked conversation itself is the only usable one.

**What counts as “finished”?** The root turn closed **and** every subagent/child session
it started is idle. While any child works, the overlay stays.

**Can I skip?** Yes — 「跳过」 unlocks at once and sends nothing to DingTalk.

**Why did no DingTalk message arrive?** Check the enable switch, the token, the robot's
security settings and the network. Press 「发送测试消息」 first.

**Where is the token stored?** `$DSH_HOME/plugin-data/dsh-deep-focus/settings.json`
(defaults to `~/.dsh`). Delete that directory to remove it.

**Does it read my messages?** No. It only uses conversation titles and turn events; the
settings page and overlay never receive message content.

## License

[MIT](LICENSE) © 2026 dsh-deep-focus contributors.
