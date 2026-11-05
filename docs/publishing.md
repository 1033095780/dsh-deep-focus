# Publishing

How to cut a release of `dsh-deep-focus`: publish to npm with **GitHub OIDC
(Trusted Publishing, no tokens)**, verify the package, then list it for
discovery. This document is the release checklist; it is not run by CI.

## Package facts

| Field | Value |
| --- | --- |
| npm package | `dsh-deep-focus` |
| Version scheme | Semantic Versioning (the current series is `0.2.z`) |
| License | MIT |
| Repository | `https://github.com/<OWNER>/dsh-deep-focus` (placeholder — replace `<OWNER>` everywhere) |
| Workflow that publishes | `.github/workflows/publish.yml`, triggered by a published GitHub Release |
| Secrets required | **None** (Trusted Publishing uses the short-lived OIDC token) |
| Build step | None — `src/` ships as-is |

## Before the first release

### 1. Add the repository fields to `package.json`

`npm publish --provenance` requires the package manifest to declare where its
source lives. The manifest in this workspace does not have those fields yet (the
release kit cannot edit `package.json`), so add them as part of the `0.2.0`
release commit:

```jsonc
{
  "repository": {
    "type": "git",
    "url": "https://github.com/<OWNER>/dsh-deep-focus.git"
  },
  "homepage": "https://github.com/<OWNER>/dsh-deep-focus#readme",
  "bugs": "https://github.com/<OWNER>/dsh-deep-focus/issues"
}
```

Without a matching `repository.url`, provenance generation fails after the
package is already being uploaded; add the fields before tagging.

### 2. Create the public GitHub repository

- Name it `dsh-deep-focus`, default branch `main`.
- Push this workspace's commit history; confirm CI is green on the tag.
- Confirm the npm name is still free: `npm view dsh-deep-focus version`
  (a `404` means it is available).

### 3. Prepare the npm account

- A public npm account with 2FA enabled.
- Access to the `dsh-deep-focus` package (first publisher becomes the owner).

### 4. Check the local environment

```bash
node --version   # >= 20 (CI uses 20 and 22)
npm --version    # >= 11.5.1 is required by the publish workflow; it upgrades npm itself
```

## Trusted Publishing setup (one time)

1. **Bootstrap the first version.** npm's Trusted Publisher settings live on the
   package page, so a brand-new package needs one initial publish. From your
   machine, on the exact tag you intend to release:

   ```bash
   npm login
   npm publish --access public
   ```

   (A bootstrap publish does not have provenance. That is fine; subsequent
   releases from GitHub Actions will. `0.1.0` was never published, so `0.2.0` is
   the first public version.)

2. Open `https://www.npmjs.com/package/dsh-deep-focus/access` →
   **Trusted Publisher** → **GitHub Actions** and fill in:
   - Organization/user: the GitHub account that owns the repository
   - Repository: `dsh-deep-focus`
   - Workflow filename: `publish.yml`
   - Environment: leave empty unless you add one to the workflow.

3. Confirm the workflow's permissions match: `.github/workflows/publish.yml`
   declares `id-token: write` and `contents: read`, and uses **no** npm token or
   repository secret.

4. After the first CI release succeeds, remove any local npm token you used for
   the bootstrap (`npm logout`) so the repository cannot fall back to a
   long-lived credential.

See the npm documentation for the current rules:
[Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/).

## Release procedure

1. **Update the version**
   - `package.json` → `version` (`0.2.0` for this rewrite).
   - `CHANGELOG.md` → move the `[Unreleased]` entries to
     `## [0.2.0] - YYYY-MM-DD`.
   - No dependency or lockfile changes are needed (the plugin has no dependencies).

2. **Run the gates locally**

   ```bash
   node --check src/index.js src/client.js
   npm test
   node scripts/verify.mjs
   npm pack --dry-run
   ```

3. **Commit and tag**

   ```bash
   git add -A
   git commit -m "release: 0.2.0"
   git tag v0.2.0
   git push origin main --tags
   ```

4. **Create the GitHub Release** from tag `v0.2.0`. Publishing the release (not
   drafting it) triggers `publish.yml`. The workflow refuses to publish when the
   tag (`v0.2.0` → `0.2.0`) does not match `package.json`'s version.

5. **Watch the run** in the Actions tab. It re-runs syntax checks, `verify.mjs`
   and `npm test`, then runs `npm publish --provenance --access public`.

6. **Verify on npm**

   ```bash
   npm view dsh-deep-focus version dist-tags repository
   ```

   The package page should show a **Provenance** badge and the released tag's
   commit.

## Verification checklist

Before announcing the release:

- [ ] `npm view dsh-deep-focus version` returns the new version.
- [ ] The npm page shows the provenance badge and the README in English/Chinese.
- [ ] `npm pack --dry-run` lists: `src/**`, `cordis.patch.yml`, `README.md`,
      `README.zh.md`, `LICENSE`, `CHANGELOG.md`, `docs/**` — and **no**
      `node_modules`, tests, `.tmp`, or local data.
- [ ] Install from npm into a throwaway profile:
      `dsh plugin --profile scratch add dsh-deep-focus`, then confirm the Plugins
      page lists the bundle with its icon and localized title/description.
- [ ] In a clean profile: the composer pill appears, the panel starts a 1-minute
      block, the completion toast and chime fire, the settings page saves, and the
      7-day chart renders.
- [ ] **Focus mode**: with a block running, other sidebar conversations are grayed
      and a click shows the gentle reminder without switching; the focused
      conversation stays usable.
- [ ] **Usage panel**: the sidebar entry appears below the Plugins row, today's
      per-app times list correctly, and the 7-day trend loads.
- [ ] **Overtime**: set `limits.sessionMinutes` to 1, confirm the overlay appears,
      click “Use 20 more minutes” and verify `limits.unlockMinutes` of grace, then
      confirm “Take a break” clears it. Confirm no password is requested.
- [ ] **No blocking**: during a focus block, start an agent turn in another
      conversation and confirm it runs without any tool refusal.
- [ ] `scripts/verify.mjs` passes on a clean checkout (`git clean -xdf`-safe: it
      needs no install step).
- [ ] Disable the plugin while a block runs: the UI disappears immediately and the
      sidebar returns to normal.

## README screenshots

No screenshots are committed yet; the READMEs use a clearly marked placeholder.
Capture these on DSH **0.2.2-rc.1** on Windows, at a consistent window size
(1440×900 is fine), with no personal task names, conversation lists, app lists, or
file paths visible.

| File | Theme | Content |
| --- | --- | --- |
| `docs/images/pill-idle-light.png` | Light | Composer toolbar pill at rest (play glyph + "Focus"/「专注」). |
| `docs/images/focus-mode-dark.png` | Dark | A focus block running: sidebar with the other conversations grayed out, focus panel open, owner conversation readable. |
| `docs/images/usage-panel-light.png` | Light | The **Usage** panel from the sidebar below the Plugins row: today's total, per-app bars, 7-day trend. |
| `docs/images/panel-running-dark.png` | Dark | Focus panel bottom-right with the progress ring, presets and today's mini stats (including the top app). |
| `docs/images/overtime-overlay-dark.png` | Dark | The gentle overtime overlay: reason, today's usage, 「再使用 20 分钟」 / “Use 20 more minutes” and 「休息一下」 / “Take a break” — **no password field**. |
| `docs/images/toast-completed-dark.png` (optional) | Dark | Completion toast (and break countdown if visible) at the end of a block. |

Steps after capturing:

1. Save the files under `docs/images/` (they ship with the npm package because
   `docs` is in `package.json` `files`).
2. Add image links to both READMEs in the screenshot section and delete the
   `<!-- screenshots:pending -->` marker from each file.
3. Run `node scripts/verify.mjs` — it then checks that every local image link
   exists, so a missing file fails the release gate.

## Listing for discovery (awesome-dsh-plugin)

The DSH plugin market reads configured plugin indexes, and the
`awesome-dsh-plugin` list is the usual discovery path for third-party plugins.
Open a PR with one entry in the list's Markdown file:

```markdown
- [dsh-deep-focus](https://github.com/<OWNER>/dsh-deep-focus) — Gentle focus for DeepSeek Harness: pomodoro blocks, a soft one-conversation-at-a-time sidebar reminder (never blocks tools), per-app usage statistics, and an optional one-click “use 20 more minutes” overtime nudge. Install: `dsh plugin add dsh-deep-focus`.
```

- **Category recommendation:** `Workflow & Automation` (focus/session guidance).
  `Notifications` is the fallback if the maintainers prefer a toasts/alerts
  category.
- **Do not include** claims the plugin cannot keep: it does not block tools or
  other agents, does not track time while DSH is closed, and the overtime overlay
  is a nudge, not enforcement.

PR checklist (match the list's contribution rules if they are stricter):

- [ ] Repository is public, license is MIT, `main` branch is green.
- [ ] Package is published on npm with the exact name `dsh-deep-focus`.
- [ ] README covers install, configuration, data/privacy, known limitations.
- [ ] `package.json` declares `dsh.bundle.patch`, `dsh.client`, `engines.dsh`, and
      ships `src/locale/*.json` + `src/icon.svg`.
- [ ] One-line entry follows the list's link format and stays on a single line.
- [ ] No telemetry and no network access, as documented in `docs/privacy.md`.

## Not verified by this release kit

- **No npm publish was executed** from this workspace (offline release-kit task).
  The workflow's npm/Trusted-Publishing behavior is configured but unproven until
  the first tag.
- **No screenshots** exist yet, so the READMEs carry placeholders instead of image
  links.
- **GitHub URLs are placeholders** (`<OWNER>`); replace them when the repository
  exists.
- `package.json` still needs the `repository` block described above before a
  provenance publish can succeed.
- `SECURITY.md` and issue/PR templates are not part of this release kit; add them
  before promoting the plugin widely.
