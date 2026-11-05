# Publishing

How to publish `dsh-deep-focus`. **GitHub Release is the primary channel**; npm is
optional and only needed if you want `dsh plugin add dsh-deep-focus` to resolve from
the registry.

## Package facts

| Field | Value |
| --- | --- |
| Package | `dsh-deep-focus` |
| Version series | `0.4.x` (SemVer) |
| License | MIT |
| Repository | `https://github.com/1033095780/dsh-deep-focus` (releases: `…/releases`, issues: `…/issues`) |
| Build step | none — `src/` ships as-is |
| Secrets | none for GitHub; npm Trusted Publishing uses OIDC, not a token |

## 1. GitHub release (primary)

1. **Bump the version**: `package.json` → `version`, and move the `CHANGELOG.md`
   `[Unreleased]` entries to `## [0.4.4] - YYYY-MM-DD`.
2. **Run the gates locally**:

   ```bash
   node --check src/index.js src/client.js
   node --test
   node scripts/verify.mjs
   npm pack --dry-run
   ```

3. **Commit and tag**:

   ```bash
   git add -A
   git commit -m "release: 0.4.4"
   git tag v0.4.4
   git push origin main --tags
   ```

4. **Create a GitHub Release** from `v0.4.4`. Users install it with:

   ```bash
   dsh plugin --profile desktop add https://github.com/1033095780/dsh-deep-focus
   ```

   (or by pointing the Plugins page at the repository / a local path). The release
   notes are the `CHANGELOG.md` entry for that version.

5. Verify from a clean profile: install, enable the bundle, check the assistant
   panel, rings, automatic rest and the daily overlay; confirm no tool call is ever
   blocked.

## 2. Optional: publish to npm

Only needed for registry-based installs (`dsh plugin add dsh-deep-focus`).

1. **Bootstrap once** (npm Trusted Publisher settings require an existing package):

   ```bash
   npm login
   npm publish --access public
   ```

2. Configure npm → package page → **Settings → Trusted Publisher → GitHub Actions**
   with the repository and workflow filename `publish.yml`. The workflow
   (`.github/workflows/publish.yml`) runs on `release: published`, requests
   `id-token: write`, checks that the tag matches `package.json`, runs the gates and
   publishes with `--provenance`. No token or secret is stored in the repository.
3. The workflow needs npm ≥ 11.5.1 (it installs it) and a `repository.url` in
   `package.json` for provenance.
4. Later releases: just publish the GitHub Release — the workflow handles npm.

## Verification checklist

- [ ] `npm view dsh-deep-focus version` (npm route) or `dsh plugin add <repo>` works
      from a clean profile.
- [ ] Plugins page shows the icon plus localized title/description.
- [ ] Assistant panel opens; rings show today/continuous progress **with the value
      inside each ring**, the continuous clock ticks every second, and the widget is
      a **button**: click it → pause; click again while paused → resume (in-flight
      clicks are ignored, aria-label switches between Pause/Resume timer).
- [ ] Idling for `usage.autoPauseSeconds` shows the shared today-usage card with
      「已暂停计时」 only after sustained idle (a single stale sample or a brief pause
      in input must not flash it); input resumes, and clicking the rings works as a
      manual pause too. There is no separate gray-only pause layer.
- [ ] Rest screen and daily overlay both show the **same today-usage card**; daily
      overlay has only 「再使用 20 分钟」 and 「跳过」 (skip does not extend). With DSH
      hidden, hitting the cap tries `window.focus()` + one system notification (best
      effort) and rings once.
- [ ] Chime: with one conversation running, finish it while away → it rings. With two
      running, finish only one → it stays silent; finish the second → it rings
      (repeats until input, capped ~2 min).
- [ ] Settings page exposes exactly the eight common controls (including the
      「专注时只允许一个对话」 switch); save/discard is right-aligned.
- [ ] One-conversation mode jumps back to the running conversation; other rows are
      grayed and not clickable; nothing is hidden; the switch turns the behavior
      off and on again. When the running set empties, the gray state is held ~1.5 s
      before restoring (no flicker on transient empty polls).
- [ ] Away chime: finish a task in your own conversation while unfocused/idle past
      `alerts.awayIdleSeconds` — it repeats until input, capped at ~2 minutes.
      Turn the same check on a subagent/teammate turn: it must stay silent.
- [ ] Disabling the plugin removes all UI immediately and restores the sidebar.
- [ ] `git clean -xdf`-safe: `node scripts/verify.mjs` passes without installs.

## README screenshots

Not committed yet; the READMEs carry a marked placeholder. Capture on DSH
`0.2.2-rc.1`, Windows, 1440×900, with no personal data visible:

| File | Content |
| --- | --- |
| `docs/images/rings-light.png` | interactive two-ring widget (values inside; click = pause/resume) |
| `docs/images/rest-gray-dark.png` | automatic-rest gray state |
| `docs/images/rest-card-dark.png` | rest screen with the shared today-usage card + 「跳过休息」 |
| `docs/images/daily-overlay-dark.png` | daily overlay on the same card (「再使用 20 分钟」/「跳过」) |
| `docs/images/assistant-panel-light.png` | assistant panel, 8-field settings (incl. the one-conversation switch) and right-aligned save row |

Save under `docs/images/`, link them from both READMEs, delete the
`<!-- screenshots:pending -->` marker, and run `node scripts/verify.mjs` (it checks
local image links).

## Marketplace listing (awesome-dsh-plugin)

```markdown
- [dsh-deep-focus](https://github.com/1033095780/dsh-deep-focus) — Focus assistant for DeepSeek Harness: click-to-pause two-ring usage widget, idle auto-rest, per-app statistics, a 3-hour daily cap, activity-gated 10-minute rests, one-conversation-at-a-time sidebar — pure plugin, never blocks tools. Install: `dsh plugin add dsh-deep-focus`.
```

- **Category:** `Workflow & Automation` (`Notifications` as fallback).
- **Do not claim** global blocking, bring-to-front, or counting while DSH is closed.
- PR checklist: public MIT repo, npm package name matches (if published), README
  covers install/config/privacy/limitations, `dsh.bundle.patch` + `dsh.client` +
  `engines.dsh` present, no telemetry.

## Not verified here

This kit did not publish anything: no npm release and no GitHub Release were run.
Screenshots do not exist yet. The public repository is
**https://github.com/1033095780/dsh-deep-focus**; `package.json` still needs its
`repository.url` updated to that URL before an npm provenance publish.
