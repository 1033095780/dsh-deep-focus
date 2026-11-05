#!/usr/bin/env node
/**
 * Offline packaging smoke test for dsh-deep-focus.
 *
 * Plain `node scripts/verify.mjs` — no install step, no network. It exits
 * non-zero when the published package would be broken: missing entry points,
 * unparsable JSON/XML, locale drift, a contract that no longer matches what the
 * README documents, or source files importing something the DSH runtime cannot
 * resolve.
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

check('contract.js is importable and sane', async () => {
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
  if (defaults.version !== 1) fail(`DEFAULT_SETTINGS.version is ${defaults.version}, expected 1`)
  for (const section of ['focus', 'limits', 'lock', 'alerts', 'usage', 'security']) {
    if (!isPlainObject(defaults[section])) fail(`DEFAULT_SETTINGS.${section} is missing`)
  }
  const numericKeys = [
    'focus.workMinutes',
    'focus.breakMinutes',
    'focus.longBreakMinutes',
    'focus.longBreakEvery',
    'focus.idlePauseSeconds',
    'limits.dailyActiveMinutes',
    'limits.continuousWorkMinutes',
    'limits.sessionMinutes',
    'limits.unlockMinutes',
    'limits.dailyUnlockLimit',
    'usage.sampleSeconds',
    'usage.idleThresholdSeconds',
    'usage.retentionDays',
  ]
  for (const key of numericKeys) {
    const value = getPath(defaults, key)
    if (!Number.isInteger(value) || value < 0) fail(`DEFAULT_SETTINGS.${key} must be a non-negative integer (got ${value})`)
  }
  for (const key of ['focus.workMinutes', 'focus.breakMinutes', 'usage.sampleSeconds', 'usage.idleThresholdSeconds']) {
    if (getPath(defaults, key) < 1) fail(`DEFAULT_SETTINGS.${key} must be at least 1`)
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
    'focus.autoStartBreak',
    'focus.autoStartNext',
    'focus.autoResumeOnReturn',
    'limits.strictNoUnlock',
    'lock.singleConversation',
    'lock.blockToolsOutsideFocus',
    'lock.lockSidebarOutsideFocus',
    'lock.exemptSubagents',
    'alerts.taskDone',
    'alerts.turnDone',
    'alerts.sound',
    'usage.detectMedia',
  ]
  for (const key of booleanKeys) {
    if (typeof getPath(defaults, key) !== 'boolean') fail(`DEFAULT_SETTINGS.${key} must be a boolean`)
  }
  if (defaults.security.passwordHash !== null || defaults.security.passwordSalt !== null) {
    fail('security defaults must start empty (passwordHash/passwordSalt = null)')
  }
  if (typeof contract.API_BASE !== 'string' || !/^\/[\w/-]+\/api$/.test(contract.API_BASE)) {
    fail(`contract.API_BASE looks wrong: ${contract.API_BASE}`)
  }
  if (!isPlainObject(contract.ROUTES)) fail('contract.js does not export ROUTES')
  for (const route of Object.values(contract.ROUTES)) {
    if (typeof route !== 'string' || !route.startsWith(contract.API_BASE)) fail(`ROUTES entry does not live under API_BASE: ${route}`)
  }
  for (const group of ['PHASE', 'EVENT', 'LOCK_REASON']) {
    if (!isPlainObject(contract[group]) || Object.keys(contract[group]).length === 0) fail(`contract.js does not export ${group}`)
  }
  return `${numericKeys.length} numeric + ${Object.keys(contract.ROUTES).length} routes`
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
    fail('src/index.js must export apply(ctx, config)')
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
  if (!existsSync(testDirectory)) fail('test/ is missing; CI runs "npm test" (node --test test/)')
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

check('runtime data directory is documented', () => {
  const combined = readText('README.md') + readText('README.zh.md') + readText('docs/privacy.md')
  if (!combined.includes('$DSH_HOME/plugin-data/dsh-deep-focus')) {
    fail('READMEs and docs/privacy.md must document $DSH_HOME/plugin-data/dsh-deep-focus')
  }
  if (!/no network|不联网|never makes a network/i.test(combined)) {
    fail('READMEs or docs/privacy.md must state that the plugin never uses the network')
  }
  if (!/restart|重启/i.test(combined)) {
    fail('READMEs or docs/privacy.md must state that restarting DSH bypasses the lock')
  }
  return 'documented'
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
