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
- [ ] **Drag** the timer card to another spot: a real drag must NOT pause (no card
      appears) and the card follows the pointer; a plain click/tap still pauses. After
      a page reload the position is restored from `localStorage`, and shrinking the
      window clamps it fully inside the viewport (default stays top-right).
- [ ] Click the rings → pause: the pause card appears **immediately** (the ~0.6 s
      settle guard applies only to the automatic idle pause). The DSH content is
      blocked while shown. Moving the mouse / pressing a key inside DSH resumes almost
      instantly (the client posts `/resume` on the first input, no ~5 s sampler wait);
      activity in another app resumes within up to ~5 s via the system sampler. The
      「继续计时」 button and Enter/Space/Escape also resume explicitly.
- [ ] Idling for `usage.autoPauseSeconds` auto-pauses with the same blocking card
      (after the ~0.6 s guard) and resumes on keyboard/mouse activity too; rest and
      daily-limit screens use the same today-usage card.
- [ ] **Continuous decay:** with e.g. 20 min continuous used, a 1-minute pause reduces
      the value (never zero); about 10 minutes of pause/rest clears the full 20 min;
      skipping the rest keeps the decayed remainder; day rollover / assistant-off
      reset it.
- [ ] Daily overlay has only 「再使用 20 分钟」 and 「跳过」 (skip does not extend).
- [ ] Background limit screens: with DSH hidden/behind another app, trigger a continuous
      timeout and then the daily cap — each should retry `window.focus()` a couple of times
      and show **one clickable system notification**; clicking it returns to DSH. No
      duplicate notifications while the same screen stays; no native permission beyond the
      browser notification permission. (Honest limitation: switching back is best effort —
      Windows may keep another window in front, and the notification prompts the user to
      return.)
- [ ] **Foreground gating:** with a pause/rest screen up, switch to another application —
      today's usage keeps increasing and the continuous value is held (no decay, no reset);
      switch back to DSH → counting stops and (for a rest) decay begins. The v0.4.31
      best-effort focus attempt + clickable notification still apply.
- [ ] **Rest countdown end waits for you:** with the rest countdown running, do not touch
      the machine until it reaches 0 → the rest page stays in the “waiting for you” state
      (no counting, no new continuous run); activity in another app does not end it; only
      real mouse/keyboard use in DSH after the countdown ends the rest and resumes counting.
- [ ] **Tracking-only mode:** enable 「仅记录模式」/“Tracking only” in settings — rings,
      dashboard, history and app breakdown keep updating, but no daily/rest/pause overlay
      appears, no background focus/notification is attempted, the completion chime stays
      silent, and the one-conversation graying/auto-jump is off. Turning it off restores
      all rules.
- [ ] **Completion attention:** with DSH behind another app (system foreground = other
      app, not merely idle), finish all conversations → chime + **one** clickable
      notification 「所有对话已完成 · 点击回到 DeepSeek」 (click returns to DSH); with DSH
      in front → silent; finishing only some conversations → silent. With a subagent/teammate
      child still running, it must stay silent until that work also finishes
      (`state.activity.running === false`). Enable 「仅记录模式」 and repeat: the completion
      notice still works while limit prompts stay muted.
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
| `docs/images/rings-light.png` | two-column two-ring widget (values inside; draggable; click = pause) |
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
