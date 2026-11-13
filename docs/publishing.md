# Publishing

`dsh-deep-focus` is distributed **only through GitHub Releases and the source
repository**. It is intentionally **not published to npm** — there is no npm package and
no registry publishing workflow.

## Distribution facts

| Field | Value |
| --- | --- |
| Repository | **https://github.com/1033095780/dsh-deep-focus** |
| Releases | https://github.com/1033095780/dsh-deep-focus/releases |
| Issues | https://github.com/1033095780/dsh-deep-focus/issues |
| Version series | `1.x` (SemVer) |
| License | MIT |
| npm package | **none** (not published) |
| Build step | none — `src/` ships as-is |

## Install from source

From the repository (or a release tag):

```bash
dsh plugin --profile desktop add https://github.com/1033095780/dsh-deep-focus
```

From a local checkout:

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-deep-focus
```

Then enable the bundle on the Plugins page.

## Release procedure (GitHub only)

1. **Bump the version**: `package.json` → `version`, and move the `CHANGELOG.md`
   `[Unreleased]` entries to `## [1.0.0] - YYYY-MM-DD`.
2. **Run the gates locally**:

   ```bash
   node --check src/index.js src/client.js
   node --test
   node scripts/verify.mjs
   ```

3. **Commit and tag**:

   ```bash
   git add -A
   git commit -m "release: 1.0.0"
   git tag v1.0.0
   git push origin main --tags
   ```

4. **Create a GitHub Release** from `v1.0.0`:
   - title `v1.0.0`,
   - paste the `CHANGELOG.md` entry as release notes,
   - attach the source archive GitHub generates (there is no build artifact).
5. **Verify from a clean profile**: install from the release URL, enable the bundle, and
   walk the checklist below.

## Verification checklist

- [ ] `dsh plugin --profile desktop add https://github.com/1033095780/dsh-deep-focus`
      (or the local path) works from a clean profile; the Plugins page shows the plugin.
- [ ] Sending a message in a conversation shows the full-screen overlay with
      「任务进行中」, the conversation title and a ticking elapsed time; the app underneath
      cannot be clicked.
- [ ] Starting a subagent inside the locked conversation keeps the overlay up; when the
      subagent and the root turn are both done the overlay disappears automatically.
- [ ] With DingTalk enabled and a token configured, auto-release sends one `[+] ` message
      (`[+] 会话已完成：…`); pressing 「跳过」 releases immediately **without** a message.
- [ ] Settings page: enable switch, password token field (shows “set / last 4 chars” when
      stored), save keeps an empty token, 「清除」 removes it, and 「发送测试消息」 sends one
      `[+]` test message (disabled/rejected when unconfigured).
- [ ] The token is not present in any `/state` or `/settings` response, only
      `dingtalkTokenSet`/`dingtalkTokenHint`.
- [ ] Reloading DSH does not leave a stale overlay; the lock is memory-only.
- [ ] No network requests while idle/locked (inspect DevTools); only DingTalk calls when
      a message is sent.
- [ ] Disabling/uninstalling the plugin removes the overlay and settings page.
- [ ] `git clean -xdf`-safe: `node scripts/verify.mjs` passes without installs.

## README screenshots

Not committed yet; the READMEs currently have no image links. Suggested captures on DSH
`0.2.2-rc.1`, Windows, 1440×900, with no personal or token data visible:

| File | Content |
| --- | --- |
| `docs/images/lock-overlay-dark.png` | full-screen lock overlay with title, elapsed time, DingTalk status and 「跳过」 |
| `docs/images/settings-dingtalk-light.png` | settings page with the enable switch, masked token field and test button |
| `docs/images/dingtalk-message.png` | a `[+] 会话已完成：…` message in DingTalk (blur names) |

Save under `docs/images/`, link them from both READMEs, then run
`node scripts/verify.mjs` (it checks local image links).

## Marketplace listing (awesome-dsh-plugin)

```markdown
- [dsh-deep-focus](https://github.com/1033095780/dsh-deep-focus) — Lock DeepSeek Harness to one conversation until its whole task tree finishes, then optionally notify you on DingTalk with a `[+]` completion message; skip the overlay to unlock at once. Install: `dsh plugin add https://github.com/1033095780/dsh-deep-focus`.
```

- **Category:** `Workflow & Automation`.
- **Do not claim** that the model can be stopped, that other applications are blocked, or
  that an npm package exists — this project is source/GitHub-only.
- PR checklist: public MIT repo, README covers install/settings/privacy/limitations,
  `dsh.bundle.patch` + `dsh.client` + `engines.dsh` present, no telemetry, token never
  committed.

## Not verified here

No GitHub Release was created from this workspace; the release flow and clean-profile
install are unproven until the first tag. Screenshots do not exist yet.
