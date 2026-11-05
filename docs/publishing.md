# Publishing

`dsh-deep-focus` is distributed **only through GitHub Releases and the source
repository**. It is intentionally **not published to npm** — there is no npm
package, no registry publishing setup, and no registry publish step in CI.

## Distribution facts

| Field | Value |
| --- | --- |
| Repository | **https://github.com/1033095780/dsh-deep-focus** |
| Releases | https://github.com/1033095780/dsh-deep-focus/releases |
| Issues | https://github.com/1033095780/dsh-deep-focus/issues |
| Version series | `0.4.x` (SemVer) |
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

Then enable the bundle on the Plugins page. There is no build step and no runtime
dependency installation; disabling or uninstalling removes all UI immediately.

## Release procedure (GitHub only)

1. **Bump the version**: `package.json` → `version`, and move the `CHANGELOG.md`
   `[Unreleased]` entries to `## [0.4.15] - YYYY-MM-DD`.
2. **Run the gates locally**:

   ```bash
   node --check src/index.js src/client.js
   node --test
   node scripts/verify.mjs
   ```

3. **Commit and tag**:

   ```bash
   git add -A
   git commit -m "release: 0.4.15"
   git tag v0.4.15
   git push origin main --tags
   ```

4. **Create a GitHub Release** from `v0.4.15`:
   - title `v0.4.15` (or the version),
   - paste the `CHANGELOG.md` entry as the release notes,
   - attach the source archive (`Source code (zip)` / `(tar.gz)` links GitHub
     generates are enough — no build artifact exists).

   Do **not** add a registry publish step or a publish workflow; releasing a tag is
   the whole distribution step.

5. **Verify from a clean profile**: install from the release/tag URL or the checked
   out source, enable the bundle, and walk the checklist below.

## Verification checklist

- [ ] `dsh plugin --profile desktop add https://github.com/1033095780/dsh-deep-focus`
      (or the local path) works from a clean profile.
- [ ] Plugins page shows the icon plus the localized title/description.
- [ ] Assistant panel opens; rings are two equal columns with the values inside
      (today minutes / continuous mm:ss), the captions 今日已用 / 连续使用 are
      centered, and the continuous clock ticks every second.
- [ ] Click the rings → pause: the DSH content is **blocked** (no hover, nothing
      expands); the pause card shows 「继续计时」 and Enter/Space/Escape resume it.
      Moving the mouse alone must not resume.
- [ ] Idling for `usage.autoPauseSeconds` auto-pauses with the same blocking card;
      rest and daily-limit screens use the same today-usage card.
- [ ] Daily overlay has only 「再使用 20 分钟」 and 「跳过」 (skip does not extend); with
      DSH hidden, hitting the cap tries `window.focus()` + one system notification
      (best effort).
- [ ] Chime: with one conversation running, finish it while away → it rings; with
      two running, finishing only one stays silent and the second rings; repeats
      until input, capped ~2 min.
- [ ] One-conversation mode jumps back to the running conversation; other rows are
      grayed and not clickable; nothing is hidden; the eight settings (including
      「专注时只允许一个对话」) are present.
- [ ] Disabling the plugin removes all UI immediately and restores the sidebar.
- [ ] `git clean -xdf`-safe: `node scripts/verify.mjs` passes without installs.

## README screenshots

Not committed yet; the READMEs carry a marked placeholder. Capture on DSH
`0.2.2-rc.1`, Windows, 1440×900, with no personal data visible:

| File | Content |
| --- | --- |
| `docs/images/rings-light.png` | two-column two-ring widget (values inside; click = pause) |
| `docs/images/pause-lock-dark.png` | blocking pause card with the 「继续计时」 button |
| `docs/images/rest-card-dark.png` | rest screen with the shared today-usage card + 「跳过休息」 |
| `docs/images/daily-overlay-dark.png` | daily overlay on the same card |
| `docs/images/assistant-panel-light.png` | assistant panel, 8-field settings and right-aligned save row |

Save under `docs/images/`, link them from both READMEs, delete the
`<!-- screenshots:pending -->` marker, and run `node scripts/verify.mjs` (it checks
local image links).

## Marketplace listing (awesome-dsh-plugin)

```markdown
- [dsh-deep-focus](https://github.com/1033095780/dsh-deep-focus) — Focus assistant for DeepSeek Harness: click-to-pause two-ring widget (blocking pause with an explicit Continue), idle auto-rest, per-app statistics, a 3-hour daily cap, activity-gated 10-minute rests, one-conversation-at-a-time sidebar — pure plugin, never blocks tools. Install: `dsh plugin add https://github.com/1033095780/dsh-deep-focus`.
```

- **Category:** `Workflow & Automation` (`Notifications` as fallback).
- **Do not claim** global blocking, bring-to-front, or counting while DSH is closed;
  do not claim an npm package — this project is source/GitHub-only.
- PR checklist: public MIT repo, README covers install/config/privacy/limitations,
  `dsh.bundle.patch` + `dsh.client` + `engines.dsh` present, no telemetry.

## Not verified here

No GitHub Release was created from this workspace, so the release flow above and the
clean-profile install are unproven until the first tag. Screenshots do not exist yet.
