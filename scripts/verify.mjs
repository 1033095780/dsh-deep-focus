#!/usr/bin/env node
/**
 * Offline release gate for dsh-deep-focus v1 (conversation lock + DingTalk notice).
 *
 * Plain `node scripts/verify.mjs` — no install step, no network. It fails when the
 * package would ship stale files/features, when the contract and docs disagree, when a
 * DingTalk token appears in the repository, or when the release docs are stale.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_NAME = 'dsh-deep-focus'
const REQUIRED_FILES = [
  'README.md',
  'README.zh.md',
  'LICENSE',
  'CHANGELOG.md',
  'cordis.patch.yml',
  'src/index.js',
  'src/client.js',
  'src/shared/contract.js',
  'src/icon.svg',
  'scripts/verify.mjs',
  'scripts/config-table.mjs',
  'scripts/e2e.mjs',
  'docs/design.md',
  'docs/privacy.md',
  'docs/publishing.md',
  '.github/workflows/ci.yml',
]
/** Files/paths from the removed focus/timer product; their presence is a failure. */
const LEGACY_PATHS = [
  'src/host/sampler.js',
  'src/host/tracker.js',
  'src/host/limits.js',
  'src/host/apps.js',
  'src/host/events.js',
  'src/host/win32-idle.ps1',
  'docs/images/rings-widget.png',
  'docs/images/clock-verification.png',
]
const CLIENT_MAX_BYTES = 80_000
const DOC_SIZE_BUDGET = {
  'README.md': [3_000, 12_000],
  'README.zh.md': [2_500, 12_000],
  'docs/design.md': [2_000, 10_000],
  'docs/privacy.md': [1_500, 6_000],
  'docs/publishing.md': [2_000, 8_000],
  'CHANGELOG.md': [400, 6_000],
}

const checks = []
function check(name, fn) {
  checks.push({ name, fn })
}
function fail(message) {
  throw new Error(message)
}
function abs(relative) {
  return join(ROOT, relative)
}
function readText(relative) {
  if (!existsSync(abs(relative))) fail(`missing file: ${relative}`)
  return readFileSync(abs(relative), 'utf8')
}
function readJson(relative) {
  try {
    return JSON.parse(readText(relative))
  } catch (error) {
    fail(`${relative} is not valid JSON: ${error.message}`)
  }
}
function walkFiles(directory) {
  const found = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walkFiles(path))
    else if (entry.isFile()) found.push(path)
  }
  return found
}
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
function assertLocalLinks(relative) {
  const text = readText(relative)
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue
    const pathPart = target.split('#')[0]
    if (!pathPart) continue
    if (!existsSync(resolve(dirname(abs(relative)), pathPart))) {
      fail(`${relative}: link target does not exist: ${target}`)
    }
  }
}

let pkg
let contract

// --- packaging ---------------------------------------------------------------

check('package.json parses', () => {
  pkg = readJson('package.json')
  if (pkg.name !== PACKAGE_NAME) fail(`package name is "${pkg.name}", expected "${PACKAGE_NAME}"`)
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    fail(`package version is not a plain SemVer: ${pkg.version}`)
  }
  if (!/^1\.\d+\.\d+$/.test(pkg.version)) fail(`expected a 1.x version, found ${pkg.version}`)
  if (pkg.license !== 'MIT') fail('package.json must declare the MIT license')
  if (pkg.type !== 'module') fail('package.json must declare "type": "module"')
  return pkg.version
})

check('entry points and published files exist', () => {
  const targets = [pkg.main]
  for (const value of Object.values(pkg.exports ?? {})) {
    if (typeof value === 'string') targets.push(value.replace(/^\.\//, ''))
  }
  for (const target of targets) {
    if (typeof target !== 'string' || target === '') fail('package.json has an empty entry point')
    if (!existsSync(abs(target.replace(/^\.\//, '')))) fail(`entry point missing: ${target}`)
  }
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) fail('package.json "files" must be a non-empty array')
  for (const entry of pkg.files) {
    if (!existsSync(abs(entry))) fail(`package.json "files" entry missing: ${entry}`)
  }
  for (const shared of ['src/index.js', 'src/client.js', 'src/shared/contract.js']) {
    if (!pkg.files.some((entry) => shared === entry || shared.startsWith(`${entry}/`))) {
      fail(`package.json "files" does not include ${shared}`)
    }
  }
  return `${targets.length} entry points, ${pkg.files.length} files entries`
})

check('DSH bundle manifest and patch', () => {
  if (!pkg.exports?.['./client'] || !pkg.exports?.['./icon']) fail('exports must include "./client" and "./icon"')
  if (pkg.dsh?.client?.platform !== 'web') fail('dsh.client.platform must be "web"')
  if (typeof pkg.dsh?.bundle?.patch !== 'string') fail('dsh.bundle.patch is missing')
  const patch = readText(pkg.dsh.bundle.patch.replace(/^\.\//, ''))
  for (const field of ['id', 'name']) {
    if (!new RegExp(`^\\s*-?\\s*${field}:\\s*${PACKAGE_NAME}\\s*$`, 'm').test(patch)) {
      fail(`bundle patch must contain "${field}: ${PACKAGE_NAME}"`)
    }
  }
  if (typeof pkg.engines?.node !== 'string') fail('engines.node is missing')
  if (typeof pkg.engines?.dsh !== 'string' || pkg.engines.dsh.trim() === '') fail('engines.dsh is missing')
  return 'bundle patch, web client, engines'
})

check('required release files exist', () => {
  const missing = REQUIRED_FILES.filter((file) => !existsSync(abs(file)))
  if (missing.length) fail(`missing files: ${missing.join(', ')}`)
  return `${REQUIRED_FILES.length} files`
})

check('legacy focus/timer product files are gone', () => {
  const present = LEGACY_PATHS.filter((file) => existsSync(abs(file)))
  if (present.length) fail(`old product files still exist: ${present.join(', ')}`)
  const oldTests = walkFiles(abs('test')).filter((file) =>
    /(sampler|tracker|limits|apps|events|activity)\.test\.mjs$/.test(file),
  )
  if (oldTests.length) fail(`old product tests still exist: ${oldTests.map((file) => file.slice(ROOT.length + 1)).join(', ')}`)
  return 'no sampler/tracker/limits/apps/events/win32-idle leftovers'
})

// --- contract ----------------------------------------------------------------

check('contract is the v5 notification contract', async () => {
  contract = await import(pathToFileURL(abs('src/shared/contract.js')).href).catch((error) => {
    fail(`contract.js cannot be imported: ${error.message}`)
  })
  if (contract.CONTRACT_VERSION !== 5) fail(`CONTRACT_VERSION must be 5, found ${contract.CONTRACT_VERSION}`)
  if (contract.SETTINGS_VERSION !== 5) fail(`SETTINGS_VERSION must be 5, found ${contract.SETTINGS_VERSION}`)
  const defaults = contract.DEFAULT_SETTINGS
  if (defaults?.version !== 5) fail('DEFAULT_SETTINGS.version must be 5')
  const notifications = defaults?.notifications
  if (!notifications || typeof notifications !== 'object') fail('DEFAULT_SETTINGS.notifications is missing')
  const keys = Object.keys(notifications)
  if (keys.length !== 2 || !keys.includes('dingtalkEnabled') || !keys.includes('dingtalkToken')) {
    fail(`notifications must have exactly dingtalkEnabled and dingtalkToken, found: ${keys.join(', ')}`)
  }
  if (notifications.dingtalkEnabled !== false) fail('dingtalkEnabled default must be false')
  if (notifications.dingtalkToken !== '') fail('dingtalkToken default must be empty')
  const routeValues = Object.values(contract.ROUTES ?? {})
  for (const route of ['/state', '/settings', '/lock/skip', '/notifications/test']) {
    if (!routeValues.includes(route)) fail(`contract ROUTES is missing ${route}`)
  }
  if (routeValues.length !== 4) fail(`contract ROUTES must have exactly 4 entries, found ${routeValues.length}`)
  if (typeof contract.publicSettings !== 'function') fail('publicSettings() is missing')
  const publicView = contract.publicSettings(defaults)
  if ('dingtalkToken' in (publicView.notifications ?? {})) fail('publicSettings must never expose the token')
  if (publicView.notifications?.dingtalkTokenSet !== false) fail('publicSettings must expose dingtalkTokenSet')
  if (typeof contract.applySettingsPatch !== 'function') fail('applySettingsPatch() is missing')
  const base = { version: 5, notifications: { dingtalkEnabled: true, dingtalkToken: 'keep-me' } }
  const kept = contract.applySettingsPatch(base, { notifications: { dingtalkToken: '' } })
  if (kept.notifications.dingtalkToken !== 'keep-me') fail('empty token patch must keep the stored token')
  const cleared = contract.applySettingsPatch(base, { notifications: { dingtalkToken: null } })
  if (cleared.notifications.dingtalkToken !== '') fail('null token patch must clear the token')
  const replaced = contract.applySettingsPatch(base, { notifications: { dingtalkToken: 'new-token' } })
  if (replaced.notifications.dingtalkToken !== 'new-token') fail('non-empty token patch must replace the token')
  if (contract.DINGTALK_PREFIX !== '[+] ') fail('DINGTALK_PREFIX must be "[+] "')
  if (!contract.DINGTALK_WEBHOOK.endsWith('access_token=')) fail('DINGTALK_WEBHOOK must end with access_token=')
  const message = contract.buildCompletionMessage({ title: 'Demo', minutes: 3, finishedAt: new Date() })
  if (!message.startsWith('[+] ')) fail('completion message must start with "[+] "')
  if (!message.includes('Demo')) fail('completion message must include the conversation title')
  return 'v5, two notification fields, token never exposed'
})

check('no legacy feature wording in shipped source', () => {
  const sourceFiles = walkFiles(abs('src')).filter((file) => /\.(js|json|svg|ps1|css)$/.test(file))
  // storage.js intentionally references the old data-file names to clean them up; the
  // cleanup block is asserted separately below instead of being word-scanned.
  const scanned = sourceFiles.filter((file) => file.slice(ROOT.length + 1).split('\\').join('/') !== 'src/host/storage.js')
  const forbidden = [
    [/\bpomodor/i, 'pomodoro'],
    [/\brings?\b/i, 'rings'],
    [/\btracking[- ]?only\b/i, 'tracking-only'],
    [/\b(?:dailyLimit|continuousMinutes|restMinutes|autoPauseSeconds|showRings|soloSession|hideOtherSessions|extendMinutes)\b/, 'old settings'],
    [/\bwin32-idle\b/, 'win32-idle'],
    [/\b(?:sampler|tracker)\b/i, 'sampler/tracker'],
    [/\busage\b/i, 'usage'],
    [/\bpaused?\b/i, 'pause'],
    [/\brest(?:ing|s|ed)?\b/i, 'rest'],
    [/\blimits?\b/i, 'limit'],
  ]
  const hits = []
  for (const file of scanned) {
    const relative = file.slice(ROOT.length + 1).split('\\').join('/')
    const text = stripComments(readFileSync(file, 'utf8'))
    for (const [pattern, label] of forbidden) {
      const match = text.match(pattern)
      if (match) hits.push(`${relative}: "${match[0]}" (${label})`)
    }
  }
  if (hits.length) fail(`old product wording in src/: ${hits.slice(0, 8).join('; ')}`)
  const storage = readText('src/host/storage.js')
  if (!/removed timing\/focus product/i.test(storage)) {
    fail('src/host/storage.js must only mention the old product in its explicit cleanup block')
  }
  return `${scanned.length} source files clean (storage cleanup excepted)`
})

// --- release docs ------------------------------------------------------------

check('READMEs describe the new product', () => {
  const en = readText('README.md')
  const zh = readText('README.zh.md')
  const requiredEn = [
    [/lock/i, 'the conversation lock'],
    [/after (?:you )?send(?:ing)? a message|send a message[^.]{0,100}lock|sending a message/i, 'the lock trigger'],
    [/(?:full[- ]screen|overlay)/i, 'the full-screen overlay'],
    [/subagents?|child sessions?/i, 'subagent-inclusive completion'],
    [/unlocks? automatically|automatically unlocks?|auto-?unlock/i, 'automatic release'],
    [/DingTalk/i, 'DingTalk notifications'],
    [/\[\+\]/i, 'the [+] message prefix'],
    [/skip|跳过/i, 'the skip action'],
    [/not published to npm/i, 'the source-only distribution'],
    [/dsh plugin[^\n]*add/i, 'the source install command'],
    [/token[^.]{0,160}(?:local|this machine|plugin-data|never)[^.]{0,80}/i, 'token stored locally only'],
    [/no telemetry|no analytics/i, 'the no-telemetry statement'],
    [/test message/i, 'the DingTalk test message'],
    [/limitations/i, 'the limitations section'],
    [/FAQ/i, 'the FAQ section'],
  ]
  const requiredZh = [
    [/锁定/, 'the conversation lock'],
    [/(?:发(?:送)?消息|发消息)/, 'the lock trigger'],
    [/(?:全屏|遮罩)/, 'the full-screen overlay'],
    [/子代理|子会话/, 'subagent-inclusive completion'],
    [/自动解锁|自动解除/, 'automatic release'],
    [/钉钉/, 'DingTalk notifications'],
    [/\[\+\]/, 'the [+] message prefix'],
    [/跳过/, 'the skip action'],
    [/不发布到 npm/, 'the source-only distribution'],
    [/dsh plugin[^\n]*add/, 'the source install command'],
    [/token[^。]{0,120}(?:本机|本地|plugin-data|不会)/, 'token stored locally only'],
    [/没有遥测|无遥测|没有分析|无分析/, 'the no-telemetry statement'],
    [/测试消息/, 'the DingTalk test message'],
    [/限制/, 'the limitations section'],
    [/FAQ/, 'the FAQ section'],
  ]
  for (const [pattern, label] of requiredEn) {
    if (!pattern.test(en)) fail(`README.md no longer documents ${label}`)
  }
  for (const [pattern, label] of requiredZh) {
    if (!pattern.test(zh)) fail(`README.zh.md no longer documents ${label}`)
  }
  const forbidden = [
    /\bpomodoro/i,
    /\brings?\b/i,
    /\btracking[- ]?only\b/i,
    /\busage\b/i,
    /\bpaused?\b/i,
    /\brest(?:ing|s|ed)?\b/i,
    /\blimits?\b/i,
    /计时|用量|双环|番茄钟|仅记录|暂停|休息/,
  ]
  for (const pattern of forbidden) {
    if (pattern.test(en) || pattern.test(zh)) fail(`README still carries removed product wording: ${pattern}`)
  }
  return 'lock/skip/subagents/DingTalk [+] documented'
})

check('README settings table matches contract.js', async () => {
  const module = await import(pathToFileURL(abs('scripts/config-table.mjs')).href).catch((error) => {
    fail(`scripts/config-table.mjs cannot be imported: ${error.message}`)
  })
  return module.checkConfigTables()
})

check('docs describe the current product', () => {
  const design = readText('docs/design.md')
  const privacy = readText('docs/privacy.md')
  const publishing = readText('docs/publishing.md')
  const requiredDesign = [
    [/lock (?:lifecycle|state machine)|lock is (?:created|released)/i, 'the lock lifecycle'],
    [/\/state/, 'the /state route'],
    [/\/lock\/skip/, 'the /lock/skip route'],
    [/\/notifications\/test/, 'the test notification route'],
    [/DingTalk/i, 'the DingTalk sender'],
    [/subagents?|child sessions?/i, 'subagent-inclusive release'],
  ]
  for (const [pattern, label] of requiredDesign) {
    if (!pattern.test(design)) fail(`docs/design.md no longer documents ${label}`)
  }
  for (const [pattern, label] of [
    [/token/i, 'the token'],
    [/plugin-data/, 'the local data directory'],
    [/oapi\.dingtalk\.com/, 'the only remote endpoint'],
    [/no telemetry|no analytics/i, 'the no-telemetry statement'],
  ]) {
    if (!pattern.test(privacy)) fail(`docs/privacy.md no longer documents ${label}`)
  }
  if (!/GitHub/i.test(publishing) || !/not published to npm/i.test(publishing)) {
    fail('docs/publishing.md must describe GitHub-only distribution')
  }
  if (/npm\s+publish/i.test(publishing)) fail('docs/publishing.md must not describe an npm publish step')
  return 'design/privacy/publishing aligned'
})

check('CHANGELOG has a dated current release', () => {
  const changelog = readText('CHANGELOG.md')
  if (!changelog.includes('## [Unreleased]')) fail('CHANGELOG.md has no [Unreleased] section')
  const heading = new RegExp(`^## \\[${pkg.version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm')
  if (!heading.test(changelog)) fail(`CHANGELOG.md needs a dated "[${pkg.version}] - YYYY-MM-DD" entry`)
  if (!changelog.includes('## [1.0.0] - 2026-11-13')) fail('CHANGELOG.md must date the 1.0.0 entry 2026-11-13')
  for (const section of ['### Added', '### Changed', '### Removed']) {
    if (!changelog.includes(section)) fail(`CHANGELOG.md is missing "${section}"`)
  }
  if (/npm\s+publish/i.test(changelog)) fail('CHANGELOG.md must not describe an npm publish step')
  return `dated ${pkg.version} entry`
})

check('LICENSE and local links', () => {
  const license = readText('LICENSE')
  if (!license.startsWith('MIT License')) fail('LICENSE must start with "MIT License"')
  const markdown = ['README.md', 'README.zh.md']
  for (const file of walkFiles(abs('docs')).map((path) => path.slice(ROOT.length + 1).split('\\').join('/'))) {
    if (file.endsWith('.md')) markdown.push(file)
  }
  for (const file of markdown) assertLocalLinks(file)
  return `${markdown.length} markdown files, MIT license`
})

// --- workflows ---------------------------------------------------------------

check('GitHub-only CI workflow', () => {
  if (existsSync(abs('.github/workflows/publish.yml'))) fail('.github/workflows/publish.yml must not exist')
  const workflows = readdirSync(abs('.github/workflows')).filter((name) => /\.ya?ml$/.test(name))
  for (const file of workflows) {
    if (/\bnpm\s+publish\b/i.test(readText(`.github/workflows/${file}`))) {
      fail(`.github/workflows/${file} runs npm publish`)
    }
  }
  const ci = readText('.github/workflows/ci.yml')
  if (!/node-version:\s*\[\s*20\s*,\s*22\s*\]/.test(ci)) fail('ci.yml must run on Node 20 and 22')
  for (const step of ['node scripts/verify.mjs', 'npm test', '--check']) {
    if (!ci.includes(step)) fail(`ci.yml does not run "${step}"`)
  }
  return `CI on Node 20/22, no npm publishing (${workflows.length} workflow)`
})

// --- security ----------------------------------------------------------------

function trackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    return output.split('\0').filter(Boolean)
  } catch {
    return walkFiles(ROOT)
      .map((path) => path.slice(ROOT.length + 1).split('\\').join('/'))
      .filter((file) => !file.startsWith('.git/') && !file.startsWith('node_modules/') && !file.startsWith('.tmp/'))
  }
}

check('no DingTalk token or secret literal is committed', () => {
  const files = trackedFiles()
  const textFiles = files
    .filter((file) => /\.(md|json|js|mjs|cjs|yml|yaml|txt|ps1|svg|html)$/i.test(file))
    .filter((file) => existsSync(abs(file)))
  const patterns = [
    [/access_token=[A-Za-z0-9._-]{16,}/, 'DingTalk access_token value'],
    [/dingtalkToken["']?\s*[:=]\s*["'][A-Za-z0-9._-]{24,}["']/i, 'hard-coded DingTalk token'],
    [/["'][A-Za-z0-9]{32,}["']/, 'a 32+ char secret-like literal'],
  ]
  const hits = []
  for (const file of textFiles) {
    if (file === 'scripts/verify.mjs') continue
    const text = readText(file)
    for (const [pattern, label] of patterns) {
      const match = text.match(pattern)
      if (match) hits.push(`${file}: ${label} (${match[0].slice(0, 12)}…)`)
    }
  }
  if (hits.length) fail(`possible committed token/secret: ${hits.join('; ')}`)
  return `${textFiles.length} tracked text files clean of token literals`
})

// --- client ------------------------------------------------------------------

check('client bundle is self-contained', () => {
  const client = readText('src/client.js')
  if (Buffer.byteLength(client) > CLIENT_MAX_BYTES) {
    fail(`src/client.js is too large (${Buffer.byteLength(client)} bytes > ${CLIENT_MAX_BYTES})`)
  }
  if (!client.includes('__ModuleLoader__')) fail('src/client.js must be a DSH browser module')
  const imports = [...client.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1])
  const allowed = new Set(['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'])
  for (const specifier of imports) {
    if (!allowed.has(specifier)) fail(`client requires "${specifier}", which is not a DSH-resolvable dependency`)
  }
  const esm = [...client.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
  for (const specifier of esm) {
    if (!allowed.has(specifier)) fail(`client imports "${specifier}", which is not a DSH-resolvable dependency`)
  }
  if (/https?:\/\//.test(stripComments(client))) fail('client must not contact external URLs directly')
  if (!client.includes('dsh-deep-focus-lock')) fail('client must register the dsh-deep-focus-lock overlay')
  for (const legacy of [/\brings?\b/i, /\bpomodor/i, /\busage\b/i, /\bpaused?\b/i, /\brest(?:ing|s)?\b/i, /\blimits?\b/i]) {
    if (legacy.test(stripComments(client))) fail(`client still contains removed feature wording: ${legacy}`)
  }
  return `${Buffer.byteLength(client)} bytes, react-only, lock overlay registered`
})

// --- sizes and extra scripts -------------------------------------------------

check('release docs stay within budget', () => {
  for (const [file, [min, max]] of Object.entries(DOC_SIZE_BUDGET)) {
    const size = readText(file).length
    if (size < min) fail(`${file} looks truncated (${size} chars < ${min})`)
    if (size > max) fail(`${file} is too large (${size} chars > ${max})`)
  }
  return 'READMEs, docs and changelog within budget'
})

check('host API wiring is present', () => {
  const api = readText('src/host/api.js')
  for (const route of ['ROUTES.state', 'ROUTES.settings', 'ROUTES.skip', 'ROUTES.testNotify']) {
    if (!api.includes(route)) fail(`src/host/api.js does not use ${route}`)
  }
  if (!api.includes('registerApi')) fail('src/host/api.js must export registerApi')
  const index = readText('src/index.js')
  for (const wiring of ['createStorage', 'createSettingsStore', 'createLockController', 'createApi', 'registerApi', 'cleanupLegacyData']) {
    if (!index.includes(wiring)) fail(`src/index.js is missing ${wiring}`)
  }
  const lock = readText('src/host/lock.js')
  if (!/skip/i.test(lock) || !/active/.test(lock)) fail('src/host/lock.js must expose a skippable active lock view')
  const dingtalk = readText('src/host/dingtalk.js')
  if (!/sendCompletion/.test(dingtalk) || !/sendTest/.test(dingtalk)) {
    fail('src/host/dingtalk.js must expose sendCompletion and sendTest')
  }
  return 'routes registered, controller/notifier wired'
})

check('helper scripts are present and syntax-clean', async () => {
  for (const file of ['scripts/e2e.mjs', 'scripts/config-table.mjs']) {
    const code = readText(file)
    if (!/node scripts\//.test(code) && !/process\.argv/.test(code)) fail(`${file} does not look runnable`)
  }
  const e2e = readText('scripts/e2e.mjs')
  for (const expected of ['/state', '/settings', '/lock/skip', '/notifications/test']) {
    if (!e2e.includes(expected)) fail(`scripts/e2e.mjs does not exercise ${expected}`)
  }
  const tests = walkFiles(abs('test')).filter((file) => file.endsWith('.test.mjs'))
  if (tests.length === 0) fail('test/ contains no test files')
  return `${tests.length} test files, e2e covers all routes`
})

// --- runner ------------------------------------------------------------------

async function main() {
  const failures = []
  for (const { name, fn } of checks) {
    try {
      const detail = await fn()
      console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      failures.push({ name, message })
      console.log(`FAIL  ${name}: ${message}`)
    }
  }
  const passed = checks.length - failures.length
  console.log('')
  if (failures.length > 0) {
    console.log(`verify: ${failures.length} check(s) failed, ${passed}/${checks.length} passed`)
    process.exitCode = 1
    return
  }
  console.log(`verify: all ${checks.length} checks passed`)
}

await main()
