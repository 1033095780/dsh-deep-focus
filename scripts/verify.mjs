#!/usr/bin/env node
/**
 * Offline packaging smoke test for dsh-deep-focus v0.4.
 *
 * Plain `node scripts/verify.mjs` — no install step, no network. It exits
 * non-zero when the published package would be broken: missing entry points,
 * unparsable JSON/XML, locale drift, a contract that no longer matches what the
 * README documents, a reintroduced pomodoro/tool-blocking/password concept, an old
 * header chip or solo banner lingering in `src/`, or source files importing
 * something the DSH runtime cannot resolve.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_NAME = 'dsh-deep-focus'
const REQUIRED_FILES = [
  'README.md',
  'README.zh.md',
  'LICENSE',
  'CHANGELOG.md',
  '.gitignore',
  'cordis.patch.yml',
  'src/host/apps.js',
  'src/host/limits.js',
  'docs/design.md',
  'docs/privacy.md',
  'docs/publishing.md',
  'scripts/verify.mjs',
  '.github/workflows/ci.yml',
  '.github/workflows/publish.yml',
]
const ALLOWED_BARE_IMPORTS = new Set(['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'])

const checks = []
function check(name, fn) {
  checks.push({ name, fn })
}

function fail(message) {
  throw new Error(message)
}

function abs(relativePath) {
  return join(ROOT, relativePath)
}

function readText(relativePath) {
  if (!existsSync(abs(relativePath))) fail(`missing file: ${relativePath}`)
  return readFileSync(abs(relativePath), 'utf8')
}

function readJson(relativePath) {
  const text = readText(relativePath)
  try {
    return JSON.parse(text)
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`)
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getPath(object, dottedKey) {
  return dottedKey.split('.').reduce((value, part) => (value === undefined || value === null ? undefined : value[part]), object)
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

/** Minimal XML well-formedness check (enough for an SVG icon, no dependencies). */
function assertXml(text, label) {
  let index = 0
  const stack = []
  let root = null
  while (index < text.length) {
    const tagStart = text.indexOf('<', index)
    if (tagStart === -1) {
      if (text.slice(index).includes('>')) fail(`${label}: stray ">" in text content`)
      break
    }
    if (text.slice(index, tagStart).includes('>')) fail(`${label}: stray ">" in text content`)
    if (text.startsWith('<!--', tagStart)) {
      const end = text.indexOf('-->', tagStart + 4)
      if (end === -1) fail(`${label}: unterminated comment`)
      index = end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', tagStart)) {
      const end = text.indexOf(']]>', tagStart + 9)
      if (end === -1) fail(`${label}: unterminated CDATA section`)
      index = end + 3
      continue
    }
    if (text.startsWith('<?', tagStart) || text.startsWith('<!', tagStart)) {
      const end = text.indexOf('>', tagStart)
      if (end === -1) fail(`${label}: unterminated declaration`)
      index = end + 1
      continue
    }
    let quote = null
    let tagEnd = -1
    for (let cursor = tagStart + 1; cursor < text.length; cursor += 1) {
      const character = text[cursor]
      if (quote) {
        if (character === quote) quote = null
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '>') {
        tagEnd = cursor
        break
      }
    }
    if (tagEnd === -1) fail(`${label}: unterminated tag`)
    const raw = text.slice(tagStart + 1, tagEnd).trim()
    index = tagEnd + 1
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim()
      if (!name) fail(`${label}: empty closing tag`)
      const open = stack.pop()
      if (!open) fail(`${label}: closing </${name}> without an open tag`)
      if (open !== name) fail(`${label}: </${name}> closes <${open}>`)
      continue
    }
    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1).trim() : raw
    const nameMatch = body.match(/^[A-Za-z_][\w:.-]*/)
    if (!nameMatch) fail(`${label}: invalid tag <${raw}>`)
    const name = nameMatch[0]
    let rest = body.slice(name.length)
    if (rest.trim() && !/^\s+[A-Za-z_:]/.test(rest)) fail(`${label}: malformed tag <${raw}>`)
    while (rest.trim()) {
      const attribute = rest.match(/^\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*')/)
      if (!attribute) fail(`${label}: malformed attributes in <${raw}>`)
      rest = rest.slice(attribute[0].length)
    }
    if (stack.length === 0) {
      if (root !== null) fail(`${label}: more than one root element`)
      root = name
    }
    if (!selfClosing) stack.push(name)
  }
  if (stack.length > 0) fail(`${label}: unclosed <${stack[stack.length - 1]}>`)
  if (root !== 'svg') fail(`${label}: root element is <${root ?? 'none'}>, expected <svg>`)
  return root
}

function flattenKeys(object, prefix = '') {
  const keys = []
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) keys.push(...flattenKeys(value, path))
    else keys.push(path)
  }
  return keys
}

function collectLocalMarkdownTargets(relativePath) {
  const text = readText(relativePath)
  const targets = []
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue
    const pathPart = target.split('#')[0]
    if (!pathPart || pathPart.startsWith('<')) continue
    targets.push(pathPart)
  }
  return targets
}

function assertLocalLinksExist(relativePath) {
  for (const target of collectLocalMarkdownTargets(relativePath)) {
    const absoluteTarget = resolve(dirname(abs(relativePath)), target)
    if (!existsSync(absoluteTarget)) {
      fail(`${relativePath}: link target does not exist: ${target}`)
    }
  }
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

// --- checks -----------------------------------------------------------------

let pkg

check('package.json parses', () => {
  pkg = readJson('package.json')
  if (pkg.name !== PACKAGE_NAME) fail(`package.json name is "${pkg.name}", expected "${PACKAGE_NAME}"`)
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    fail(`package.json version is not valid SemVer: ${pkg.version}`)
  }
  if (pkg.license !== 'MIT') fail(`package.json license is "${pkg.license}", expected "MIT"`)
  if (pkg.type !== 'module') fail('package.json must declare "type": "module" (the Host half is ESM)')
  return `${pkg.name}@${pkg.version}`
})

check('entry points exist', () => {
  if (typeof pkg.main !== 'string') fail('package.json has no "main" entry')
  const missing = []
  const resolved = []
  const checkTarget = (target, label) => {
    if (typeof target !== 'string') fail(`package.json "${label}" must be a relative path string`)
    const isExports = label.startsWith('exports')
    if (isExports && !target.startsWith('./')) fail(`package.json "${label}" must start with "./"`)
    const clean = target.startsWith('./') ? target.slice(2) : target
    if (clean.includes('*')) {
      const directory = dirname(clean)
      const suffix = clean.slice(clean.indexOf('*') + 1)
      const absoluteDirectory = abs(directory)
      if (!existsSync(absoluteDirectory)) fail(`package.json "${label}" wildcard directory is missing: ${directory}`)
      const matches = readdirSync(absoluteDirectory).filter((name) => name.endsWith(suffix) && !name.startsWith('.'))
      if (matches.length === 0) fail(`package.json "${label}" wildcard matches no file in ${directory}`)
      resolved.push(...matches.map((name) => `${directory}/${name}`))
      return
    }
    if (!existsSync(abs(clean))) missing.push(`${label} -> ${target}`)
    else resolved.push(clean)
  }
  checkTarget(pkg.main, 'main')
  for (const [key, value] of Object.entries(pkg.exports ?? {})) checkTarget(value, `exports["${key}"]`)
  if (missing.length) fail(`export targets missing on disk: ${missing.join(', ')}`)
  return `${resolved.length} path(s)`
})

check('package files exist', () => {
  if (pkg.main) {
    const mainTarget = pkg.main.replace(/^\.\//, '')
    if (!existsSync(abs(mainTarget))) fail(`"main" points at a missing file: ${pkg.main}`)
  }
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) fail('package.json "files" must be a non-empty array')
  const missing = pkg.files.filter((entry) => !existsSync(abs(entry)))
  if (missing.length) fail(`package.json "files" entries missing on disk: ${missing.join(', ')}`)
  if (pkg.files.some((entry) => entry.includes('node_modules'))) fail('package.json "files" must not include node_modules')
  return pkg.files.length + ' entries'
})

check('DSH bundle manifest', () => {
  const dsh = pkg.dsh
  if (!isPlainObject(dsh)) fail('package.json has no "dsh" manifest section')
  if (!isPlainObject(dsh.bundle) || typeof dsh.bundle.patch !== 'string') {
    fail('package.json is missing dsh.bundle.patch')
  }
  const patchPath = dsh.bundle.patch.replace(/^\.\//, '')
  const patch = readText(patchPath)
  if (patch.trim().length === 0) fail(`${patchPath} is empty; DSH fails to load an empty patch layer`)
  for (const field of ['id', 'name']) {
    if (!new RegExp(`^\\s*-?\\s*${field}:\\s*${PACKAGE_NAME}\\s*$`, 'm').test(patch)) {
      fail(`${patchPath} does not include "${field}: ${PACKAGE_NAME}"`)
    }
  }
  if (!isPlainObject(dsh.client)) fail('package.json is missing dsh.client (the browser half would not load)')
  if (dsh.client.platform !== 'web') fail(`dsh.client.platform is "${dsh.client.platform}", expected "web"`)
  if (!pkg.exports || typeof pkg.exports['./client'] !== 'string') {
    fail('package.json exports has no "./client" entry for the browser half')
  }
  return 'bundle + client'
})

check('engines declared', () => {
  if (!isPlainObject(pkg.engines)) fail('package.json has no "engines" section')
  if (typeof pkg.engines.node !== 'string') fail('package.json engines.node is missing')
  if (typeof pkg.engines.dsh !== 'string' || pkg.engines.dsh.trim() === '') {
    fail('package.json engines.dsh is missing; DSH compatibility must be declared')
  }
  return `node ${pkg.engines.node}, dsh ${pkg.engines.dsh}`
})

check('locale files parse and match', () => {
  const localeDirectory = abs('src/locale')
  if (!existsSync(localeDirectory)) fail('src/locale is missing')
  const files = readdirSync(localeDirectory).filter((name) => name.endsWith('.json'))
  if (files.length < 2) fail('expected at least English and Chinese locale files in src/locale')
  const locales = {}
  for (const file of files) {
    locales[file] = readJson(`src/locale/${file}`)
  }
  const englishKeys = flattenKeys(locales['en.json'] ?? {})
  const baseKeys = new Set(englishKeys)
  for (const [file, locale] of Object.entries(locales)) {
    const keys = new Set(flattenKeys(locale))
    const missing = [...baseKeys].filter((key) => !keys.has(key))
    const extra = [...keys].filter((key) => !baseKeys.has(key))
    if (missing.length || extra.length) {
      fail(`${file} locale keys differ from en.json (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
    }
    for (const key of ['meta.title', 'meta.description']) {
      if (!keys.has(key)) fail(`${file} has no ${key}`)
    }
    for (const key of keys) {
      const value = key.split('.').reduce((node, part) => node?.[part], locale)
      if (typeof value !== 'string' || value.trim() === '') fail(`${file}: "${key}" must be a non-empty string`)
    }
  }
  const wildcard = pkg.exports?.['./locale/*.json']
  if (typeof wildcard !== 'string') fail('package.json exports has no "./locale/*.json" entry')
  return `${files.length} locales, ${englishKeys.length} keys`
})

check('icon is valid SVG', () => {
  const iconExport = pkg.exports?.['./icon']
  const iconPath = typeof iconExport === 'string' ? iconExport.replace(/^\.\//, '') : pkg.icon
  if (typeof iconPath !== 'string') fail('package.json exports no "./icon" entry and has no "icon" field')
  const icon = readText(iconPath)
  assertXml(icon, iconPath)
  if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(icon)) {
    fail(`${iconPath}: the <svg> root must declare the SVG namespace`)
  }
  if (!/viewBox\s*=|width\s*=/.test(icon)) fail(`${iconPath}: the <svg> root needs a viewBox or width`)
  return iconPath
})

check('contract.js is a sane v4 contract', async () => {
  const contractPath = abs('src/shared/contract.js')
  if (!existsSync(contractPath)) fail('src/shared/contract.js is missing')
  let contract
  try {
    contract = await import(pathToFileURL(contractPath).href)
  } catch (error) {
    fail(`src/shared/contract.js cannot be imported: ${error.message}`)
  }
  const defaults = contract.DEFAULT_SETTINGS
  if (!isPlainObject(defaults)) fail('contract.js does not export DEFAULT_SETTINGS')
  if (defaults.version !== 4) fail(`DEFAULT_SETTINGS.version is ${defaults.version}, expected 4 (v0.4 contract)`)
  for (const section of ['limits', 'assistant', 'alerts', 'usage']) {
    if (!isPlainObject(defaults[section])) fail(`DEFAULT_SETTINGS.${section} is missing`)
  }
  for (const removed of ['focus', 'lock', 'security']) {
    if (removed in defaults) fail(`DEFAULT_SETTINGS.${removed} must not exist in the v0.4 contract`)
  }
  const expectedDefaults = {
    'limits.dailyMinutes': 180,
    'limits.continuousMinutes': 30,
    'limits.restMinutes': 10,
    'limits.extendMinutes': 20,
    'limits.dailyExtendLimit': 0,
    'alerts.repeatIntervalMs': 1000,
    'alerts.awayIdleSeconds': 30,
    'usage.autoPauseSeconds': 60,
  }
  for (const [key, expected] of Object.entries(expectedDefaults)) {
    if (getPath(defaults, key) !== expected) {
      fail(`DEFAULT_SETTINGS.${key} is ${getPath(defaults, key)}, expected the agreed v0.4 default ${expected}`)
    }
  }
  const numericKeys = [
    'limits.dailyMinutes',
    'limits.continuousMinutes',
    'limits.restMinutes',
    'limits.extendMinutes',
    'limits.dailyExtendLimit',
    'alerts.repeatIntervalMs',
    'alerts.awayIdleSeconds',
    'usage.sampleSeconds',
    'usage.idleThresholdSeconds',
    'usage.retentionDays',
    'usage.autoPauseSeconds',
  ]
  for (const key of numericKeys) {
    const value = getPath(defaults, key)
    if (!Number.isInteger(value) || value < 0) fail(`DEFAULT_SETTINGS.${key} must be a non-negative integer (got ${value})`)
  }
  for (const key of ['limits.restMinutes', 'limits.extendMinutes', 'alerts.repeatIntervalMs', 'alerts.awayIdleSeconds', 'usage.sampleSeconds', 'usage.idleThresholdSeconds']) {
    if (getPath(defaults, key) < 1) fail(`DEFAULT_SETTINGS.${key} must be at least 1`)
  }
  for (const key of ['limits.dailyMinutes', 'limits.continuousMinutes', 'limits.dailyExtendLimit', 'usage.autoPauseSeconds']) {
    if (getPath(defaults, key) < 0) fail(`DEFAULT_SETTINGS.${key} cannot be negative`)
  }
  if (getPath(defaults, 'usage.autoPauseSeconds') < 0) fail('usage.autoPauseSeconds must be 0 (off) or a positive idle threshold')
  if (getPath(defaults, 'alerts.repeatIntervalMs') < 500 || getPath(defaults, 'alerts.repeatIntervalMs') > 10_000) {
    fail('alerts.repeatIntervalMs default must stay inside the supported 500–10000 ms range')
  }
  const volume = defaults.alerts.volume
  if (typeof volume !== 'number' || volume < 0 || volume > 1) fail('alerts.volume must be a number between 0 and 1')
  for (const key of ['quietHoursStart', 'quietHoursEnd']) {
    const value = defaults.alerts[key]
    if (value !== null && (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) {
      fail(`alerts.${key} must be null or "HH:MM" (got ${JSON.stringify(value)})`)
    }
  }
  const booleanKeys = [
    'assistant.enabled',
    'assistant.soloSession',
    'assistant.hideOtherSessions',
    'assistant.showRings',
    'alerts.sound',
    'alerts.repeatUntilActive',
    'usage.trackApps',
  ]
  for (const key of booleanKeys) {
    if (typeof getPath(defaults, key) !== 'boolean') fail(`DEFAULT_SETTINGS.${key} must be a boolean`)
  }
  for (const key of ['assistant.enabled', 'assistant.soloSession', 'assistant.hideOtherSessions', 'assistant.showRings', 'alerts.repeatUntilActive']) {
    if (getPath(defaults, key) !== true) fail(`DEFAULT_SETTINGS.${key} must default to true in v0.4`)
  }
  for (const removedKey of ['dailyActiveMinutes', 'continuousWorkMinutes', 'sessionMinutes', 'unlockMinutes']) {
    if (removedKey in defaults.limits) fail(`DEFAULT_SETTINGS.limits.${removedKey} was removed in v0.3`)
  }
  if ('detectMedia' in defaults.usage) fail('DEFAULT_SETTINGS.usage.detectMedia was removed in v0.3')
  if ('turnDone' in defaults.alerts) fail('DEFAULT_SETTINGS.alerts.turnDone was removed in v0.3')
  if ('taskDone' in defaults.alerts) fail('DEFAULT_SETTINGS.alerts.taskDone was removed in v0.4')
  if ('showCountdown' in defaults.assistant) fail('DEFAULT_SETTINGS.assistant.showCountdown was renamed to assistant.showRings in v0.4')
  const serializedDefaults = JSON.stringify(defaults).toLowerCase()
  if (serializedDefaults.includes('password') || serializedDefaults.includes('security')) {
    fail('DEFAULT_SETTINGS must not contain password/security fields in v0.4')
  }
  if (typeof contract.API_BASE !== 'string' || !/^\/[\w/-]+\/api$/.test(contract.API_BASE)) {
    fail(`contract.API_BASE looks wrong: ${contract.API_BASE}`)
  }
  if (!isPlainObject(contract.ROUTES)) fail('contract.js does not export ROUTES')
  for (const route of ['state', 'apps', 'settings', 'assistant', 'pause', 'resume', 'restStart', 'restFinish', 'extend']) {
    if (typeof contract.ROUTES[route] !== 'string') fail(`contract.js ROUTES.${route} is missing`)
  }
  for (const removedRoute of ['focusStart', 'focusPause', 'focusResume', 'focusStop', 'focusComplete']) {
    if (removedRoute in contract.ROUTES) fail(`contract.js still exposes the removed pomodoro route ROUTES.${removedRoute}`)
  }
  for (const route of Object.values(contract.ROUTES)) {
    if (typeof route !== 'string' || !route.startsWith(contract.API_BASE)) fail(`ROUTES entry does not live under API_BASE: ${route}`)
  }
  if (!isPlainObject(contract.EVENT) || Object.keys(contract.EVENT).length === 0) {
    fail('contract.js does not export EVENT')
  }
  for (const event of ['taskCompleted', 'paused', 'resumed', 'restDue', 'restStarted', 'restFinished', 'dailyLocked', 'extended', 'assistantOff', 'assistantOn']) {
    if (typeof contract.EVENT[event] !== 'string') fail(`contract.js EVENT.${event} is missing`)
  }
  if ('PHASE' in contract) fail('contract.js still exports PHASE (the pomodoro phase enum was removed in v0.3)')
  if ('LOCK_REASON' in contract) fail('contract.js still exports LOCK_REASON (removed in v0.3)')
  return `v${defaults.version}: ${numericKeys.length} numeric, ${Object.keys(contract.ROUTES).length} routes`
})

check('v0.4 removed the old header chip and solo banner', () => {
  const banned = [
    'conversation.session.header.utilities',
    'dsh-deep-focus-countdown',
    'dsh-deep-focus-solo-banner',
    'solo.banner',
    'showCountdown',
    'taskDone',
  ]
  const problems = []
  for (const file of walkFiles(abs('src')).filter((entry) => entry.endsWith('.js') || entry.endsWith('.ps1'))) {
    const relativeFile = file.slice(ROOT.length + 1).split('\\').join('/')
    const code = file.endsWith('.js') ? stripComments(readFileSync(file, 'utf8')) : readFileSync(file, 'utf8')
    for (const token of banned) {
      if (code.includes(token)) problems.push(`${relativeFile}: still contains "${token}"`)
    }
  }
  if (problems.length) fail(problems.join('; '))
  return 'no header chip, no solo banner, no showCountdown/taskDone'
})

check('v0.3 removed the pomodoro machinery', () => {
  if (existsSync(abs('src/host/focus.js'))) fail('src/host/focus.js still exists; v0.3 removed the pomodoro state machine')
  const sourceFiles = walkFiles(abs('src')).filter((file) => file.endsWith('.js') || file.endsWith('.ps1'))
  const banned = [
    { pattern: /pomodoro/i, label: 'pomodoro' },
    { pattern: /番茄/, label: '番茄' },
    { pattern: /\bworkMinutes\b|\bbreakMinutes\b|\blongBreak/, label: 'work/break settings' },
    { pattern: /pomodorosToday/, label: 'pomodoro counter' },
    { pattern: /focusStarted|focusCompleted|breakCompleted|focusStopped/, label: 'pomodoro events' },
    { pattern: /\bPHASE\b/, label: 'pomodoro phase enum' },
    { pattern: /\/focus\/(?:start|pause|resume|stop|complete)/, label: 'pomodoro routes' },
  ]
  const problems = []
  for (const file of sourceFiles) {
    const relativeFile = file.slice(ROOT.length + 1).split('\\').join('/')
    const code = stripComments(readFileSync(file, 'utf8'))
    for (const rule of banned) {
      if (rule.pattern.test(code)) problems.push(`${relativeFile}: ${rule.label}`)
    }
  }
  if (problems.length) fail(problems.join('; '))
  return 'no pomodoro code or strings under src'
})

check('v0.3 ships no tool blocking', () => {
  if (existsSync(abs('src/host/lock.js'))) fail('src/host/lock.js exists; v0.3 keeps the pure-plugin no-tool-blocking rule')
  const sourceFiles = walkFiles(abs('src')).filter((file) => file.endsWith('.js'))
  const problems = []
  for (const file of sourceFiles) {
    const relativeFile = file.slice(ROOT.length + 1).split('\\').join('/')
    const code = stripComments(readFileSync(file, 'utf8'))
    if (/\btools\s*\.\s*guard\s*\(/.test(code)) problems.push(`${relativeFile}: registers ctx.tools.guard`)
    if (/\bregisterToolGuard\b|\bdecideToolDenial\b|\bdenialReason\b/.test(code)) {
      problems.push(`${relativeFile}: contains old tool-denial logic`)
    }
  }
  const index = stripComments(readText('src/index.js'))
  const injectMatch = index.match(/export\s+const\s+inject\s*=\s*\[([\s\S]*?)\]/)
  if (injectMatch !== null && /['"]tools['"]/.test(injectMatch[1])) fail("src/index.js still injects 'tools'")
  if (problems.length) fail(problems.join('; '))
  return 'no tool guard, no tools injection'
})

check('v0.3 has no password support', () => {
  const problems = []
  for (const file of walkFiles(abs('src')).filter((entry) => entry.endsWith('.js'))) {
    const relativeFile = file.slice(ROOT.length + 1).split('\\').join('/')
    const code = stripComments(readFileSync(file, 'utf8'))
    if (/\bscrypt\b|\bpasswordHash\b|\bpasswordSalt\b|\bverifyPassword\b|\bsetPassword\b|\bclearPassword\b/.test(code)) {
      problems.push(relativeFile)
    }
  }
  if (problems.length) fail(`password code still present in: ${problems.join(', ')}`)
  return 'no password code anywhere in src'
})

check('README settings tables match contract.js', async () => {
  let module
  try {
    module = await import(pathToFileURL(abs('scripts/config-table.mjs')).href)
  } catch (error) {
    fail(`scripts/config-table.mjs cannot be imported: ${error.message}`)
  }
  return module.checkConfigTables()
})

check('READMEs describe the v0.4 product', () => {
  const en = readText('README.md')
  const zh = readText('README.zh.md')
  // v0.3 rules are still part of the product.
  if (!/focus assistant/i.test(en)) fail('README.md must introduce the “Focus assistant” panel')
  if (!/(?:3 hours|180 minutes)/i.test(en) || !/daily/i.test(en)) fail('README.md must document the 3-hour daily cap')
  if (!/30 (?:continuous minutes|minutes of continuous|continuous)/i.test(en)) fail('README.md must document the 30-minute continuous cap')
  if (!/10-minute (?:forced )?rest/i.test(en)) fail('README.md must document the 10-minute forced rest')
  if (!/20 more minutes/i.test(en)) fail('README.md must document the “Use 20 more minutes” action')
  if (!/one conversation at a time/i.test(en)) fail('README.md must document the one-conversation-at-a-time mode')
  if (!/no pomodoro/i.test(en)) fail('README.md must state that the pomodoro timer is gone')
  if (!/never blocks?/i.test(en) || !/tool/i.test(en)) fail('README.md must state that the plugin never blocks tools')
  if (!/cannot bring DSH to the front/i.test(en)) fail('README.md capability boundary must state it cannot bring DSH to the front')
  if (!/cannot block other applications/i.test(en)) fail('README.md capability boundary must state it cannot block other applications')
  if (!/DSH is closed/i.test(en)) fail('README.md capability boundary must state usage is not counted while DSH is closed')
  if (!/desktop (?:guard|daemon)/i.test(en) || !/later phase/i.test(en)) {
    fail('README.md must describe the desktop guard as a possible later phase, not part of this version')
  }
  // v0.4 UX changes.
  if (!/floating/i.test(en) || !/(?:two|dual)[- ]?ring/i.test(en)) {
    fail('README.md must document the floating two-ring widget')
  }
  if (!/top-right|top right/i.test(en)) fail('README.md must document that the rings float in the top-right')
  if (!/display[- ]only|read[- ]only|not clickable/i.test(en)) {
    fail('README.md must document that the floating rings are display-only')
  }
  if (!/auto(?:matic)?(?:ally)? (?:rest|pause)|idle auto-rest|automatic rest/i.test(en) || !/usage\.autoPauseSeconds/i.test(en)) {
    fail('README.md must document the automatic idle rest and usage.autoPauseSeconds')
  }
  if (!/move the mouse or type|movement|resumes? (?:it|counting)/i.test(en)) {
    fail('README.md must document that the automatic rest resumes on keyboard/mouse activity')
  }
  if (!/today[- ]usage card/i.test(en) || !/(?:shared|same)/i.test(en)) {
    fail('README.md must document the shared today-usage card used by both screens')
  }
  if (!/only two actions|two actions/i.test(en)) {
    fail('README.md must document that the daily overlay has two actions')
  }
  if (!/skip[^.]{0,140}(?:without extend|does not extend|no extension)/i.test(en)) {
    fail('README.md must state that daily “Skip” does not extend')
  }
  if (!/seven (?:common )?(?:settings|controls)|7 (?:common )?(?:settings|controls)/i.test(en)) {
    fail('README.md must document that the settings UI exposes seven common controls')
  }
  if (!/advanced[^.]{0,120}(?:JSON|API|not shown|not exposed)/i.test(en)) {
    fail('README.md must state that advanced knobs stay in settings JSON/API and are not exposed in the UI')
  }
  if (!/jump(?:s)? back|auto-jump|pins? the ui|returns? to the running/i.test(en)) {
    fail('README.md must document that one-conversation mode jumps back to the running conversation')
  }
  if (!/veil|veiled|dimmed/i.test(en)) {
    fail('README.md must document the veiled/dimmed content of a visible non-owner conversation')
  }
  if (!/skip rest/i.test(en)) fail('README.md must document the forced-rest “Skip rest” action')
  if (!/“Skip”|Skip button|\bSkip\b/.test(en)) fail('README.md must document the daily overlay “Skip” action')
  if (!/away/i.test(en) || !/repeat/i.test(en) || !/chime/i.test(en)) {
    fail('README.md must document that the completion chime only repeats while you are away')
  }
  if (!/folders?/i.test(en) || !/gray(?:s|ed)? out|dim(?:s|med)?/i.test(en)) {
    fail('README.md must document that solo mode grays out workspace folders too')
  }
  if (!/not clickable|non-clickable|cannot be clicked|cannot click/i.test(en)) {
    fail('README.md must document that grayed-out conversation/folder rows are not clickable')
  }
  if (!/0\s*=\s*unlimited/i.test(en)) {
    fail('README.md must document that limits.dailyExtendLimit 0 = unlimited')
  }
  if (!/no banner|without a banner|no banner text/i.test(en)) fail('README.md must state that solo mode shows no banner')
  // Chinese mirrors.
  if (!/专注助手/.test(zh)) fail('README.zh.md must introduce the「专注助手」panel')
  if (!/(?:3 小时|180 分钟)/.test(zh) || !/每日/.test(zh)) fail('README.zh.md must document the 3-hour daily cap')
  if (!/30 分钟/.test(zh)) fail('README.zh.md must document the 30-minute continuous cap')
  if (!/10 分钟/.test(zh)) fail('README.zh.md must document the 10-minute forced rest')
  if (!/再使用 20 分钟/.test(zh)) fail('README.zh.md must document the「再使用 20 分钟」action')
  if (!/一次只/.test(zh)) fail('README.zh.md must document the one-conversation-at-a-time mode')
  if (!/没有番茄/.test(zh)) fail('README.zh.md must state that the pomodoro timer is gone')
  if (!/绝不(?:拦截|拒绝)/.test(zh)) fail('README.zh.md must state 绝不拦截 / 绝不拒绝 (no tool blocking)')
  if (!/不能把 DSH|不能把DSH/.test(zh)) fail('README.zh.md capability boundary must state it cannot bring DSH to the front')
  if (!/不能阻止其它应用/.test(zh)) fail('README.zh.md capability boundary must state it cannot block other applications')
  if (!/DSH 关闭时|DSH关闭时/.test(zh)) fail('README.zh.md capability boundary must state usage is not counted while DSH is closed')
  if (!/桌面守护程序/.test(zh) || !/后续可选阶段/.test(zh)) {
    fail('README.zh.md must describe the desktop guard as a possible later phase')
  }
  if (!/双环/.test(zh) || !/悬浮/.test(zh)) fail('README.zh.md must document the floating two-ring widget')
  if (!/右上角/.test(zh)) fail('README.zh.md must document that the rings float in the top-right')
  if (!/仅显示|只显示/.test(zh)) {
    fail('README.zh.md must document that the floating rings are display-only')
  }
  if (!/自动(?:休息|暂停)/.test(zh) || !/usage\.autoPauseSeconds/.test(zh)) {
    fail('README.zh.md must document the automatic idle rest and usage.autoPauseSeconds')
  }
  if (!/动(?:一下)?鼠标|动键鼠|移动鼠标/.test(zh)) {
    fail('README.zh.md must document that the automatic rest resumes on keyboard/mouse activity')
  }
  if (!/今日用量/.test(zh) || !/(?:共用|同一张|同一个)/.test(zh)) {
    fail('README.zh.md must document the shared today-usage card used by both screens')
  }
  if (!/两个操作/.test(zh)) {
    fail('README.zh.md must document that the daily overlay has two actions')
  }
  if (!/跳过[^。]{0,80}(?:不续期|不会续期|不延长)/.test(zh)) {
    fail('README.zh.md must state that daily「跳过」does not extend')
  }
  if (!/(?:7|七) ?(?:个|项)[^。]{0,30}(?:设置|控制)/.test(zh)) {
    fail('README.zh.md must document that the settings UI exposes seven common controls')
  }
  if (!/高级[^。]{0,80}(?:JSON|API|界面)/.test(zh)) {
    fail('README.zh.md must state that advanced knobs stay in settings JSON/API and are not exposed in the UI')
  }
  if (!/自动跳回|跳回正在运行/.test(zh)) {
    fail('README.zh.md must document that one-conversation mode jumps back to the running conversation')
  }
  if (!/遮罩|变暗/.test(zh)) {
    fail('README.zh.md must document the veiled/dimmed content of a visible non-owner conversation')
  }
  if (!/跳过休息/.test(zh)) fail('README.zh.md must document the forced-rest「跳过休息」action')
  if (!/跳过/.test(zh)) fail('README.zh.md must document the daily overlay「跳过」action')
  if (!/离开/.test(zh) || !/重复/.test(zh) || !/提示音/.test(zh)) {
    fail('README.zh.md must document that the completion chime only repeats while you are away')
  }
  if (!/文件夹/.test(zh) || !/置灰|变灰/.test(zh)) {
    fail('README.zh.md must document that solo mode grays out workspace folders too')
  }
  if (!/不可点|无法点击|不可点击/.test(zh)) {
    fail('README.zh.md must document that grayed-out conversation/folder rows are not clickable')
  }
  if (!/0\s*=\s*不限/.test(zh)) {
    fail('README.zh.md must document that limits.dailyExtendLimit 0 = unlimited')
  }
  if (!/不(?:再)?显示(?:任何)?提示横幅|没有提示条|去掉提示条/.test(zh)) fail('README.zh.md must state that solo mode shows no banner')
  const forbidden = [
    /25\s*[\/:]\s*5/,
    /focus block/i,
    /work\/break/i,
    /pomodoro presets/i,
    /composer pill/i,
    /the Usage panel/i,
    /countdown chip/i,
    /conversation\.session\.header\.utilities/,
    /dsh-deep-focus-countdown/,
    /其它文件夹和会话已暂时隐藏/,
    /fade out|fade back in/i,
    /sidebar hiding|hide other conversations|hides? other conversations/i,
    /隐藏其它会话|隐藏其他会话/,
    /click(?:ing)? the (?:widget|rings)[^.\n]{0,80}(?:pause|gray)/i,
    /点击[^。\n]{0,20}(?:双环)[^。\n]{0,20}(?:暂停|变灰)/,
    /enter (?:your |the )?password/i,
    /unlock password/i,
    /密码解锁/,
    /输入(?:解锁)?密码/,
    /tool calls are refused/i,
    /工具调用被拒绝/,
  ]
  for (const pattern of forbidden) {
    if (pattern.test(en) || pattern.test(zh)) fail(`README still advertises a removed earlier-version concept: ${pattern}`)
  }
  return 'v0.4.x: display-only rings/auto-rest/shared usage card/rest+skip/away chime/auto-jump+gray+veil/7 settings, unlimited extends, v0.3 rules'
})

check('package version is the v0.4 series', () => {
  if (!/^0\.4\.\d+$/.test(pkg.version)) {
    fail(`package.json version is "${pkg.version}"; the release kit documents v0.4.x (0.4.1–0.4.3 patch releases included)`)
  }
  return pkg.version
})

check('required files exist', () => {
  const missing = REQUIRED_FILES.filter((file) => !existsSync(abs(file)))
  if (missing.length) fail(`missing release files: ${missing.join(', ')}`)
  return REQUIRED_FILES.length + ' files'
})

check('LICENSE and CHANGELOG', () => {
  const license = readText('LICENSE')
  if (!license.startsWith('MIT License')) fail('LICENSE does not start with "MIT License"')
  if (!license.includes('Copyright (c) 2026 dsh-deep-focus contributors')) {
    fail('LICENSE has an unexpected copyright line')
  }
  const changelog = readText('CHANGELOG.md')
  if (!changelog.includes('## [Unreleased]')) fail('CHANGELOG.md has no [Unreleased] section')
  if (!changelog.includes(`## [${pkg.version}]`)) fail(`CHANGELOG.md has no entry for version ${pkg.version}`)
  for (const heading of ['### Added', '### Changed', '### Removed', '### Fixed']) {
    if (!changelog.includes(heading)) fail(`CHANGELOG.md v0.4 entry is missing "${heading}"`)
  }
  if (!/0\.1\.0[^\n]*0\.4\.[0-9][^\n]*never published/i.test(changelog)) {
    fail('CHANGELOG.md must note that 0.1.0–0.4.x were never published')
  }
  return `MIT, changelog covers ${pkg.version}`
})

check('source imports are resolvable', () => {
  const sourceFiles = walkFiles(abs('src')).filter((file) => file.endsWith('.js'))
  if (sourceFiles.length === 0) fail('no JavaScript source files found under src/')
  const problems = []
  for (const file of sourceFiles) {
    const relativeFile = file.slice(ROOT.length + 1).split('\\').join('/')
    const code = stripComments(readFileSync(file, 'utf8'))
    const specifiers = new Set()
    const patterns = [
      /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
      /\bimport\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
      /\bexport\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
    ]
    for (const pattern of patterns) {
      for (const match of code.matchAll(pattern)) specifiers.add(match[1])
    }
    for (const specifier of specifiers) {
      if (specifier.startsWith('node:')) continue
      if (isRelativeSpecifier(specifier)) {
        const target = resolve(dirname(file), specifier)
        if (!existsSync(target)) problems.push(`${relativeFile}: relative import "${specifier}" does not exist`)
        continue
      }
      if (ALLOWED_BARE_IMPORTS.has(specifier)) continue
      problems.push(`${relativeFile}: imports "${specifier}", which is not a DSH-resolvable dependency`)
    }
  }
  if (problems.length) fail(problems.join('; '))
  return `${sourceFiles.length} files`
})

check('source entry exports', () => {
  const index = readText('src/index.js')
  if (!/\bexport\s+(?:async\s+)?function\s+apply\b|\bexport\s+(?:const|let)\s+apply\b/.test(index)) {
    fail('src/index.js must export apply(ctx)')
  }
  if (!/\binject\b/.test(index)) fail('src/index.js must declare the services it injects')
  const client = readText('src/client.js')
  if (!client.includes('__ModuleLoader__')) {
    fail('src/client.js must be a DSH browser module (window.__ModuleLoader__.load)')
  }
  if (!/\bapply\s*\(/.test(client.match(/__ModuleLoader__[\s\S]*/)?.[0] ?? '')) {
    fail('src/client.js does not expose an apply(ctx) for its browser half')
  }
  return 'apply + inject + client registration'
})

check('tests exist', () => {
  const testDirectory = abs('test')
  if (!existsSync(testDirectory)) fail('test/ is missing; CI runs "npm test" (node --test)')
  const testFiles = walkFiles(testDirectory).filter((file) => file.endsWith('.test.mjs') || file.endsWith('.test.js'))
  if (testFiles.length === 0) fail('test/ contains no *.test.mjs files')
  return `${testFiles.length} test file(s)`
})

check('markdown links resolve locally', () => {
  const markdownFiles = ['README.md', 'README.zh.md', ...walkFiles(abs('docs')).map((file) => file.slice(ROOT.length + 1).split('\\').join('/')).filter((file) => file.endsWith('.md'))]
  for (const file of markdownFiles) assertLocalLinksExist(file)
  return `${markdownFiles.length} markdown file(s)`
})

check('README screenshot section is honest', () => {
  for (const file of ['README.md', 'README.zh.md']) {
    const text = readText(file)
    if (text.includes('<!-- screenshots:pending -->')) continue
    // Once the placeholder is replaced, real local screenshots must exist.
    const images = [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)]
      .map((match) => match[1])
      .filter((target) => !/^(?:https?:)/i.test(target))
    if (images.length === 0) {
      fail(`${file}: no screenshots yet, so the <!-- screenshots:pending --> marker must stay in the screenshot section`)
    }
  }
  return 'placeholder marked, or real local screenshots present'
})

check('publish workflow uses OIDC only', () => {
  const publish = readText('.github/workflows/publish.yml')
  const ci = readText('.github/workflows/ci.yml')
  if (!/^\s+id-token:\s*write\b.*$/m.test(publish)) {
    fail('.github/workflows/publish.yml must request "id-token: write" for Trusted Publishing')
  }
  if (/NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./i.test(publish)) {
    fail('.github/workflows/publish.yml must not use tokens or repository secrets')
  }
  if (!publish.includes('npm publish')) fail('.github/workflows/publish.yml does not run npm publish')
  if (!/node-version:\s*\[\s*20\s*,\s*22\s*\]/.test(ci)) {
    fail('.github/workflows/ci.yml must test on Node 20 and 22')
  }
  for (const step of ['node scripts/verify.mjs', 'npm test', '--check']) {
    if (!ci.includes(step)) fail(`.github/workflows/ci.yml does not run "${step}"`)
  }
  return 'OIDC publish, CI on Node 20/22'
})

check('privacy docs match the v0.4 data collection', () => {
  const combined = readText('README.md') + readText('README.zh.md') + readText('docs/privacy.md')
  if (!combined.includes('$DSH_HOME/plugin-data/dsh-deep-focus')) {
    fail('READMEs and docs/privacy.md must document $DSH_HOME/plugin-data/dsh-deep-focus')
  }
  if (!/no network|不联网|never makes a network/i.test(combined)) {
    fail('READMEs or docs/privacy.md must state that the plugin never uses the network')
  }
  if (!/foreground|前台/.test(combined)) fail('docs must describe foreground-application sampling')
  if (!/window title|窗口标题/.test(combined)) fail('docs must state that window titles are not recorded')
  if (!/app name|应用名/.test(combined)) fail('docs must state that only app names and durations are stored')
  if (!/limits\.json/.test(combined)) fail('docs must document the limits.json state file')
  if (!/rest time is excluded|休息.*不计入|rest.*not (?:counted|added)/i.test(combined)) {
    fail('docs must state that rest time is excluded from the daily total')
  }
  if (!/pause|暂停/i.test(combined)) fail('docs must mention the pause/gray mode')
  if (!/no new data|nothing new is recorded|不新增/i.test(combined)) {
    fail('docs must state that the pause/away logic records no new data')
  }
  return 'foreground apps, names + durations, rest excluded, pause reuses idle signal, local'
})

// --- runner -----------------------------------------------------------------

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
