# Publishing

How to cut a release of `dsh-deep-focus`: publish to npm with **GitHub OIDC
(Trusted Publishing, no tokens)**, verify the package, then list it for
discovery. This document is the release checklist; it is not run by CI.

## Package facts

| Field | Value |
| --- | --- |
| npm package | `dsh-deep-focus` |
| Version scheme | Semantic Versioning (`0.y.z` for the first public series) |
| License | MIT |
| Repository | `https://github.com/<OWNER>/dsh-deep-focus` (placeholder — replace `<OWNER>` everywhere) |
| Workflow that publishes | `.github/workflows/publish.yml`, triggered by a published GitHub Release |
| Secrets required | **None** (Trusted Publishing uses the short-lived OIDC token) |
| Build step | None — `src/` ships as-is |

## Before the first release

### 1. Add the repository fields to `package.json`

`npm publish --provenance` requires the package manifest to declare where its
source lives. The manifest in this workspace does not have those fields yet
(the release kit cannot edit `package.json`), so add them as part of the release
commit:

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
   releases from GitHub Actions will.)

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
   - `package.json` → `version` (e.g. `0.1.0`).
   - `CHANGELOG.md` → move `[Unreleased]` entries to `## [0.1.0] - YYYY-MM-DD`.
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
   git commit -m "release: 0.1.0"
   git tag v0.1.0
   git push origin main --tags
   ```

4. **Create the GitHub Release** from tag `v0.1.0`. Publishing the release (not
   drafting it) triggers `publish.yml`. The workflow refuses to publish when the
   tag (`v0.1.0` → `0.1.0`) does not match `package.json`'s version.

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
- [ ] Lock test: set `limits.dailyActiveMinutes` to 1 (or use a 1-minute session
      limit), trigger the lock, confirm tool calls are refused in other
      conversations, and confirm password unlock grants 20 minutes.
- [ ] `scripts/verify.mjs` passes on a clean checkout (`git clean -xdf`-safe: it
      needs no install step).

## README screenshots

No screenshots are committed yet; the READMEs use a clearly marked placeholder.
Capture these on DSH **0.2.2-rc.1** on Windows, at a consistent window size
(1440×900 is fine), with no personal task names, conversation lists, or file
paths visible.

| File | Theme | Content |
| --- | --- | --- |
| `docs/images/pill-idle-light.png` | Light | Composer toolbar pill at rest (play glyph + "Focus"/「专注」). |
| `docs/images/panel-running-dark.png` | Dark | Focus panel open bottom-right, a 25-minute block running with the progress ring and today's mini stats. |
| `docs/images/lock-overlay-dark.png` | Dark | Full-screen lock overlay with the reason, today's usage, password field and the forced-break action. |
| `docs/images/settings-stats-light.png` | Light | Settings → Deep focus section: grouped settings plus the 7-day bar chart. |
| `docs/images/sidebar-lock-light.png` (optional) | Light | Sidebar while locked: non-owner conversations dimmed, owner conversation reachable. |
| `docs/images/toast-completed-dark.png` (optional) | Dark | Completion toast (and break countdown if visible) at the end of a block. |

Steps after capturing:

1. Save the files under `docs/images/` (they ship with the npm package because
   `docs` is in `package.json` `files`).
2. Add image links to both READMEs in the screenshot section and delete the
   `<!-- screenshots:pending -->` marker from each file.
3. Run `node scripts/verify.mjs` — it now checks that every local image link
   exists, so a missing file fails the release gate.

## Listing for discovery (awesome-dsh-plugin)

The DSH plugin market reads configured plugin indexes, and the
`awesome-dsh-plugin` list is the usual discovery path for third-party plugins.
Open a PR with one entry in the list's Markdown file:

```markdown
- [dsh-deep-focus](https://github.com/<OWNER>/dsh-deep-focus) — Pomodoro focus blocks, a one-conversation lock, whole-machine activity tracking while DSH runs, and an overtime lock you unlock with your password for another 20 minutes. Install: `dsh plugin add dsh-deep-focus`.
```

- **Category recommendation:** `Workflow & Automation` (focus/session control).
  `Notifications` is the fallback if the maintainers prefer a toasts/alerts
  category.
- **Do not include** marketing claims the plugin cannot keep: it does not block
  the OS, does not track time while DSH is closed, and the lock is not a security
  boundary.

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
