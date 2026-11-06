#!/usr/bin/env node
/**
 * Offline packaging and release-readiness smoke test for dsh-deep-focus.
 *
 * Plain `node scripts/verify.mjs` — no install step, no network. It exits non-zero
 * when the published package would be broken or the release docs contradict the
 * code: missing entry points, unparsable JSON, locale drift, a wrong v4 contract,
 * a reintroduced pomodoro/tool-blocking/password concept, stale planning files,
 * READMEs that no longer describe the current product, or docs that outgrow their
 * size budget.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_NAME = 'dsh-deep-focus'
const ALLOWED_BARE_IMPORTS = new Set(['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'])
const REQUIRED_FILES = [
  'README.md',
  'README.zh.md',
  'LICENSE',
  'CHANGELOG.md',
  '.gitignore',
  'cordis.patch.yml',
  'src/host/apps.js',
  'src/host/limits.js',
  'scripts/verify.mjs',
  'scripts/config-table.mjs',
  'scripts/e2e.mjs',
  'docs/design.md',
  'docs/privacy.md',
  'docs/publishing.md',
  '.github/workflows/ci.yml',
]
const DELETED_FILES = ['PLAN.md', 'PLAN-v0.3.md', 'Agents.md']
const DOC_SIZE_BUDGET = {
  'README.md': [4_000, 14_000],
  'README.zh.md': [4_000, 14_000],
  'docs/design.md': [4_000, 16_000],
  'docs/privacy.md': [2_000, 9_000],
  'docs/publishing.md': [3_000, 10_000],
  'CHANGELOG.md': [600, 10_000],
}

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

/** Very small SVG sanity check: root element, namespace, balanced tags, no script. */
function assertSvg(text, label) {
  const trimmed = text.trim()
  if (!/^<svg[\s>]/.test(trimmed)) fail(`${label}: does not start with an <svg> root element`)
  if (!/<\/svg>\s*$/.test(trimmed)) fail(`${label}: does not end with </svg>`)
  if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(trimmed)) {
    fail(`${label}: SVG root must declare the SVG namespace`)
  }
  if (!/viewBox\s*=|width\s*=/.test(trimmed)) fail(`${label}: needs a viewBox or width`)
  if (/<script[\s>]/i.test(trimmed)) fail(`${label}: an icon must not contain scripts`)
  const opens = [...trimmed.matchAll(/<([A-Za-z][\w:-]*)(?![^>]*\/>)/g)].length
  const closes = [...trimmed.matchAll(/<\/([A-Za-z][\w:-]*)>/g)].length
  if (opens !== closes) fail(`${label}: unbalanced tags (${opens} open, ${closes} close)`)
}

function assertLocalLinks(relativePath) {
  const text = readText(relativePath)
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1]
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue
    const pathPart = target.split('#')[0]
    if (!pathPart) continue
    if (!existsSync(resolve(dirname(abs(relativePath)), pathPart))) {
      fail(`${relativePath}: link target does not exist: ${target}`)
    }
  }
}

let pkg

// --- packaging ---------------------------------------------------------------

check('package.json parses', () => {
  pkg = readJson('package.json')
  if (pkg.name !== PACKAGE_NAME) fail(`package.json name is "${pkg.name}", expected "${PACKAGE_NAME}"`)
  if (typeof pkg.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) {
    fail(`package.json version is not valid SemVer: ${pkg.version}`)
  }
  if (!/^0\.4\.\d+$/.test(pkg.version)) fail(`package.json version "${pkg.version}" is outside the documented 0.4.x series`)
  if (pkg.license !== 'MIT') fail('package.json must declare the MIT license')
  if (pkg.type !== 'module') fail('package.json must declare "type": "module"')
  return pkg.version
})

check('entry points exist', () => {
  const resolved = []
  const checkTarget = (target, label, requireDotSlash) => {
    if (typeof target !== 'string') fail(`package.json "${label}" must be a path string`)
    if (requireDotSlash && !target.startsWith('./')) fail(`package.json "${label}" must start with "./"`)
    const clean = target.replace(/^\.\//, '')
    if (clean.includes('*')) {
      const directory = dirname(clean)
      const suffix = clean.slice(clean.indexOf('*') + 1)
      if (!existsSync(abs(directory))) fail(`package.json "${label}" wildcard directory is missing: ${directory}`)
      const matches = readdirSync(abs(directory)).filter((name) => name.endsWith(suffix))
      if (matches.length === 0) fail(`package.json "${label}" wildcard matches no file`)
      resolved.push(...matches)
      return
    }
    if (!existsSync(abs(clean))) fail(`package.json "${label}" points at a missing file: ${target}`)
    resolved.push(clean)
  }
  checkTarget(pkg.main, 'main', false)
  for (const [key, value] of Object.entries(pkg.exports ?? {})) checkTarget(value, `exports["${key}"]`, true)
  return `${resolved.length} paths`
})

check('package files exist', () => {
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) fail('package.json "files" must be a non-empty array')
  const missing = pkg.files.filter((entry) => !existsSync(abs(entry)))
  if (missing.length) fail(`package.json "files" entries missing: ${missing.join(', ')}`)
  if (pkg.files.some((entry) => entry.includes('node_modules'))) fail('package.json "files" must not include node_modules')
  return `${pkg.files.length} entries`
})

check('DSH bundle manifest', () => {
  if (!isPlainObject(pkg.dsh)) fail('package.json has no "dsh" manifest section')
  if (!isPlainObject(pkg.dsh.bundle) || typeof pkg.dsh.bundle.patch !== 'string') {
    fail('package.json is missing dsh.bundle.patch')
  }
  const patch = readText(pkg.dsh.bundle.patch.replace(/^\.\//, ''))
  for (const field of ['id', 'name']) {
    if (!new RegExp(`^\\s*-?\\s*${field}:\\s*${PACKAGE_NAME}\\s*$`, 'm').test(patch)) {
      fail(`bundle patch does not include "${field}: ${PACKAGE_NAME}"`)
    }
  }
  if (!isPlainObject(pkg.dsh.client) || pkg.dsh.client.platform !== 'web') {
    fail('package.json must declare dsh.client with platform "web"')
  }
  if (typeof pkg.exports?.['./client'] !== 'string') fail('package.json exports has no "./client" entry')
  return 'bundle + client'
})

check('engines declared', () => {
  if (!isPlainObject(pkg.engines)) fail('package.json has no engines section')
  if (typeof pkg.engines.node !== 'string') fail('engines.node is missing')
  if (typeof pkg.engines.dsh !== 'string' || pkg.engines.dsh.trim() === '') fail('engines.dsh is missing')
  return `node ${pkg.engines.node}, dsh ${pkg.engines.dsh}`
})

check('locale files parse and match', () => {
  const directory = abs('src/locale')
  if (!existsSync(directory)) fail('src/locale is missing')
  const files = readdirSync(directory).filter((name) => name.endsWith('.json'))
  if (files.length < 2) fail('need at least English and Chinese locale files')
  const flatten = (object, prefix = '') => {
    const keys = []
    for (const [key, value] of Object.entries(object)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (isPlainObject(value)) keys.push(...flatten(value, path))
      else keys.push(path)
    }
    return keys
  }
  const locales = Object.fromEntries(files.map((file) => [file, readJson(`src/locale/${file}`)]))
  const baseKeys = new Set(flatten(locales['en.json'] ?? {}))
  for (const [file, locale] of Object.entries(locales)) {
    const keys = new Set(flatten(locale))
    const missing = [...baseKeys].filter((key) => !keys.has(key))
    const extra = [...keys].filter((key) => !baseKeys.has(key))
    if (missing.length || extra.length) fail(`${file} locale keys differ from en.json (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
    for (const required of ['meta.title', 'meta.description']) {
      if (!keys.has(required)) fail(`${file} has no ${required}`)
    }
    for (const key of keys) {
      const value = key.split('.').reduce((node, part) => node?.[part], locale)
      if (typeof value !== 'string' || value.trim() === '') fail(`${file}: "${key}" must be a non-empty string`)
    }
  }
  if (typeof pkg.exports?.['./locale/*.json'] !== 'string') fail('package.json exports has no "./locale/*.json" entry')
  return `${files.length} locales, ${baseKeys.size} keys`
})

check('icon is a valid SVG', () => {
  const iconExport = pkg.exports?.['./icon']
  const iconPath = typeof iconExport === 'string' ? iconExport.replace(/^\.\//, '') : pkg.icon
  if (typeof iconPath !== 'string') fail('package.json exports no "./icon" entry')
  assertSvg(readText(iconPath), iconPath)
  return iconPath
})

// --- contract and behavioural guarantees -------------------------------------

check('contract.js is a sane v4 contract', async () => {
  const contract = await import(pathToFileURL(abs('src/shared/contract.js')).href).catch((error) => {
    fail(`src/shared/contract.js cannot be imported: ${error.message}`)
  })
  const defaults = contract.DEFAULT_SETTINGS
  if (!isPlainObject(defaults)) fail('contract.js does not export DEFAULT_SETTINGS')
  if (defaults.version !== 4) fail(`DEFAULT_SETTINGS.version is ${defaults.version}, expected 4`)
  for (const section of ['limits', 'assistant', 'alerts', 'usage']) {
    if (!isPlainObject(defaults[section])) fail(`DEFAULT_SETTINGS.${section} is missing`)
  }
  for (const removed of ['focus', 'lock', 'security']) {
    if (removed in defaults) fail(`DEFAULT_SETTINGS.${removed} must not exist in the v4 contract`)
  }
  const expected = {
    'limits.dailyMinutes': 180,
    'limits.continuousMinutes': 30,
    'limits.restMinutes': 10,
    'limits.extendMinutes': 20,
    'limits.dailyExtendLimit': 0,
    'alerts.repeatIntervalMs': 1000,
    'alerts.awayIdleSeconds': 30,
    'usage.autoPauseSeconds': 60,
    'assistant.enabled': true,
  }
  for (const [key, value] of Object.entries(expected)) {
    if (getPath(defaults, key) !== value) fail(`DEFAULT_SETTINGS.${key} is ${getPath(defaults, key)}, expected ${value}`)
  }
  const serialized = JSON.stringify(defaults).toLowerCase()
  if (serialized.includes('password') || serialized.includes('security')) fail('DEFAULT_SETTINGS must not contain password/security fields')
  for (const route of ['state', 'apps', 'settings', 'assistant', 'pause', 'resume', 'restStart', 'restFinish', 'extend']) {
    if (typeof contract.ROUTES?.[route] !== 'string') fail(`contract.js ROUTES.${route} is missing`)
  }
  for (const event of ['taskCompleted', 'paused', 'resumed', 'restStarted', 'restFinished', 'dailyLocked', 'extended', 'assistantOff', 'assistantOn']) {
    if (typeof contract.EVENT?.[event] !== 'string') fail(`contract.js EVENT.${event} is missing`)
  }
  if ('PHASE' in contract) fail('contract.js still exports the removed pomodoro PHASE enum')
  return `v${defaults.version}: ${Object.keys(contract.ROUTES).length} routes`
})

check('v0.4 ships no tool blocking', () => {
  if (existsSync(abs('src/host/lock.js'))) fail('src/host/lock.js exists; the tool guard must stay deleted')
  for (const file of walkFiles(abs('src')).filter((entry) => entry.endsWith('.js'))) {
    const relative = file.slice(ROOT.length + 1).split('\\').join('/')
    const code = stripComments(readFileSync(file, 'utf8'))
    if (/\btools\s*\.\s*guard\s*\(/.test(code) || /\bregisterToolGuard\b|\bdecideToolDenial\b|\bdenialReason\b/.test(code)) {
      fail(`${relative}: reintroduced tool-denial logic`)
    }
  }
  const index = stripComments(readText('src/index.js'))
  const inject = index.match(/export\s+const\s+inject\s*=\s*\[([\s\S]*?)\]/)
  if (inject !== null && /['"]tools['"]/.test(inject[1])) fail("src/index.js still injects 'tools'")
  return 'no tool guard, no tools injection'
})

check('v0.4 has no password support', () => {
  for (const file of walkFiles(abs('src')).filter((entry) => entry.endsWith('.js'))) {
    const relative = file.slice(ROOT.length + 1).split('\\').join('/')
    const code = stripComments(readFileSync(file, 'utf8'))
    if (/\bscrypt\b|\bpasswordHash\b|\bpasswordSalt\b|\bverifyPassword\b|\bsetPassword\b|\bclearPassword\b/.test(code)) {
      fail(`${relative}: password code is present`)
    }
  }
  return 'no password code'
})

check('no pomodoro machinery', () => {
  if (existsSync(abs('src/host/focus.js'))) fail('src/host/focus.js exists; the pomodoro state machine was removed')
  const banned = [/pomodoro/i, /番茄/, /\bworkMinutes\b|\bbreakMinutes\b|\blongBreak/, /pomodorosToday/, /\bPHASE\b/, /\/focus\/(?:start|pause|resume|stop|complete)/]
  for (const file of walkFiles(abs('src')).filter((entry) => entry.endsWith('.js') || entry.endsWith('.ps1'))) {
    const relative = file.slice(ROOT.length + 1).split('\\').join('/')
    const code = file.endsWith('.js') ? stripComments(readFileSync(file, 'utf8')) : readFileSync(file, 'utf8')
    for (const pattern of banned) {
      if (pattern.test(code)) fail(`${relative}: still contains a removed pomodoro concept (${pattern})`)
    }
  }
  return 'no pomodoro code or strings'
})

// --- release docs ------------------------------------------------------------

check('internal planning files were removed', () => {
  for (const name of DELETED_FILES) {
    if (existsSync(abs(name))) fail(`${name} still exists; personal planning/agent files must not ship`)
  }
  const texts = [readText('README.md'), readText('README.zh.md'), readText('docs/design.md'), readText('docs/publishing.md')]
  for (const name of DELETED_FILES) {
    for (const text of texts) {
      if (text.includes(name)) fail(`release docs still reference removed file ${name}`)
    }
  }
  return 'PLAN.md, PLAN-v0.3.md and Agents.md are gone'
})

check('repository URLs are real', () => {
  const combined = ['README.md', 'README.zh.md', 'docs/publishing.md'].map((file) => readText(file)).join('\n')
  if (/<\/?OWNER>|\bOWNER\b/.test(combined)) fail('release docs still contain OWNER placeholder links')
  if (!combined.includes('https://github.com/1033095780/dsh-deep-focus')) {
    fail('release docs must link to https://github.com/1033095780/dsh-deep-focus')
  }
  if (!combined.includes('https://github.com/1033095780/dsh-deep-focus/releases')) {
    fail('release docs must link to the GitHub releases page')
  }
  return 'https://github.com/1033095780/dsh-deep-focus'
})

check('README settings tables match contract.js', async () => {
  const module = await import(pathToFileURL(abs('scripts/config-table.mjs')).href).catch((error) => {
    fail(`scripts/config-table.mjs cannot be imported: ${error.message}`)
  })
  return module.checkConfigTables()
})

check('READMEs describe the current product', () => {
  const en = readText('README.md')
  const zh = readText('README.zh.md')
  const required = [
    [/focus assistant/i, 'the Focus assistant panel'],
    [/(?:3 hours|180 minutes)/i, 'the 3-hour daily cap'],
    [/30 (?:continuous )?minutes/i, 'the 30-minute continuous cap'],
    [/10-minute (?:forced )?rest/i, 'the 10-minute forced rest'],
    [/(?:value inside|values? inside each ring|number in the middle)/i, 'the in-ring values'],
    [/(?:once per second|every second)/i, 'the smooth continuous clock'],
    [/click(?:ing)? the (?:rings|widget|card)/i, 'click-to-pause on the rings'],
    [/(?:continue|继续计时)/i, 'the explicit Continue action'],
    [/Enter\/Space\/Escape|Enter, Space|Enter \/ Space \/ Escape/i, 'the keyboard resume shortcuts'],
    [/(?:blocking (?:lock|card)|content is not interactive|not clickable|no hover)/i, 'the blocking pause lock'],
    [/automatic idle pause|idle auto-pause|auto-?pause/i, 'the automatic idle pause'],
    [/(?:immediately|at once)[^.]{0,60}(?:pause card|paused card|shown)|click[^.]{0,60}(?:immediately|at once)/i, 'the immediate manual pause card'],
    [/0\.6 s[^.]{0,50}(?:automatic|only)/i, 'the 0.6 s guard only for the automatic pause'],
    [/(?:inside DSH|in DSH)[^.]{0,100}(?:posts?|resumes?)|posts? `?\/resume`?/i, 'the instant in-DSH resume'],
    [/(?:other application|another app|outside DSH)[^.]{0,100}(?:5 s|five seconds)/i, 'external activity resumes within ~5 s'],
    [/any pause[^.]{0,80}resumes?|(?:manual|automatic)[^.]{0,80}resume[^.]{0,80}activity|activity[^.]{0,60}resume/i, 'pause resumes on keyboard/mouse activity'],
    [/system-wide|another application|other application/i, 'system-wide activity resumption'],
    [/two equal columns|equal columns|equal-width columns/i, 'the equal-column ring layout'],
    [/centered|center(?:ed)? captions/i, 'the centered ring captions'],
    [/sustained idle|two consecutive/i, 'the sustained-idle auto-pause rule'],
    [/held ~1\.5 s|~1\.5 s/i, 'the sidebar gray hysteresis'],
    [/auto(?:matic)?[- ]?(?:rest|pause)|pauses? only after sustained/i, 'the automatic idle rest'],
    [/usage\.autoPauseSeconds/i, 'the autoPauseSeconds setting'],
    [/jump(?:s)? back|auto-jump/i, 'the auto-jump behaviour'],
    [/(?:single primary|one primary|primary conversation)/i, 'the single-primary pinning'],
    [/most recent(?:ly)?|newest/i, 'the newest-turn primary rule'],
    [/including other running|other running conversations/i, 'graying other running conversations'],
    [/(?:today[- ]usage|shared .{0,20}card|same .{0,20}card)/i, 'the shared today-usage card'],
    [/gray(?:s|ed)? out|dim(?:s|med)?/i, 'the grayed sidebar rows'],
    [/not clickable|non-clickable|cannot be clicked/i, 'the non-clickable sidebar rows'],
    [/0\s*=\s*unlimited/i, 'unlimited daily extensions (0 = unlimited)'],
    [/eight (?:common )?(?:settings|controls)/i, 'the eight exposed settings'],
    [/assistant\.soloSession|one conversation at a time/i, 'the solo-mode setting switch'],
    [/(?:all .{0,30}running|running .{0,20}set)/i, 'the all-done chime rule'],
    [/subagent|teammate/i, 'the subagent/teammate silence rule'],
    [/(?:only some|partial)/i, 'the partial-completion silence rule'],
    [/(?:2 minutes|~2 min)/i, 'the chime hard cap'],
    [/auto-?pause|automatic pause/i, 'the unified auto-pause screen'],
    [/same .{0,40}card|unified .{0,20}card/i, 'the unified pause/rest/daily card'],
    [/window\.focus\(\)/i, 'the background bring-back attempt'],
    [/system notification|Notification API|notification/i, 'the system notification'],
    [/cannot force the OS|cannot force .{0,40}foreground/i, 'the pure-plugin foreground limitation'],
    [/never blocks?/i, 'the no-tool-blocking guarantee'],
    [/cannot bring DSH to the front/i, 'the capability boundary'],
    [/cannot block other applications/i, 'the capability boundary'],
    [/DSH is closed/i, 'the capability boundary'],
    [/e2e\.mjs/, 'the e2e smoke script'],
    [/not published to npm/i, 'the GitHub-only distribution note'],
    [/dsh plugin[^\n]*add/i, 'source install instructions'],
    [/node --test/i, 'the test command'],
    [/scripts\/verify\.mjs/, 'the verify command'],
  ]
  for (const [pattern, label] of required) {
    if (!pattern.test(en)) fail(`README.md no longer documents ${label}`)
  }
  const requiredZh = [
    [/专注助手/, 'the Focus assistant panel'],
    [/(?:3 小时|180 分钟)/, 'the 3-hour daily cap'],
    [/30 分钟/, 'the 30-minute continuous cap'],
    [/10 分钟/, 'the 10-minute forced rest'],
    [/(?:中间显示数值|数值)/, 'the in-ring values'],
    [/(?:每秒平滑走动|每秒走)/, 'the smooth continuous clock'],
    [/点击(?:卡片|双环|小组件)/, 'click-to-pause on the rings'],
    [/继续计时/, 'the explicit Continue action'],
    [/Enter\/Space\/Escape|Enter、Space、Escape/, 'the keyboard resume shortcuts'],
    [/不可交互|阻断/, 'the blocking pause lock'],
    [/自动(?:空闲)?暂停/, 'the automatic idle pause'],
    [/立即(?:显示|出现)|点击[^。]{0,30}立即/, 'the immediate manual pause card'],
    [/0\.6 秒[^。]{0,40}(?:自动|仅)/, 'the 0.6 s guard only for the automatic pause'],
    [/(?:DSH 内)[^。]{0,80}\/resume|第一次输入/, 'the instant in-DSH resume'],
    [/其它软件|其他软件|DSH 外/, 'external activity detection'],
    [/(?:约|最长约) ?5 秒/, 'external activity resumes within ~5 s'],
    [/任何暂停|(?:手动|自动)[^。]{0,40}暂停[^。]{0,60}恢复/, 'pause resumes on keyboard/mouse activity'],
    [/整机|其它软件|其他软件/, 'system-wide activity resumption'],
    [/两等宽列|等宽.*列/, 'the equal-column ring layout'],
    [/居中/, 'the centered ring captions'],
    [/持续空闲|连续两个新鲜采样/, 'the sustained-idle auto-pause rule'],
    [/(?:约 )?1\.5 秒/, 'the sidebar gray hysteresis'],
    [/自动休息|自动暂停/, 'the automatic idle rest'],
    [/usage\.autoPauseSeconds/, 'the autoPauseSeconds setting'],
    [/自动跳回|跳回/, 'the auto-jump behaviour'],
    [/(?:唯一.*主会话|主会话（primary）|primary)/, 'the single-primary pinning'],
    [/最近开始运行|最近.*开始/, 'the newest-turn primary rule'],
    [/包括正在运行的其它会话|其它正在运行的/, 'graying other running conversations'],
    [/(?:今日用量|共用|同一张)/, 'the shared today-usage card'],
    [/置灰|变灰/, 'the grayed sidebar rows'],
    [/不可点|无法点击|不可点击/, 'the non-clickable sidebar rows'],
    [/0\s*=\s*不限/, 'unlimited daily extensions (0 = unlimited)'],
    [/(?:8|八) ?(?:个|项)/, 'the eight exposed settings'],
    [/assistant\.soloSession|专注时只允许一个对话/, 'the solo-mode setting switch'],
    [/所有正在运行的会话|运行集合/, 'the all-done chime rule'],
    [/子代理|队友/, 'the subagent/teammate silence rule'],
    [/只完成了一部分|部分完成/, 'the partial-completion silence rule'],
    [/(?:约 )?2 分钟/, 'the chime hard cap'],
    [/自动暂停/, 'the unified auto-pause screen'],
    [/同一张(?:今日用量)?卡片/, 'the unified pause/rest/daily card'],
    [/window\.focus\(\)/, 'the background bring-back attempt'],
    [/系统通知/, 'the system notification'],
    [/无法强制操作系统/, 'the pure-plugin foreground limitation'],
    [/绝不(?:拦截|拒绝)/, 'the no-tool-blocking guarantee'],
    [/不能把 DSH|不能把DSH/, 'the capability boundary'],
    [/不能阻止其它应用/, 'the capability boundary'],
    [/DSH 关闭时|DSH关闭时/, 'the capability boundary'],
    [/e2e\.mjs/, 'the e2e smoke script'],
    [/不发布到 npm/, 'the GitHub-only distribution note'],
    [/dsh plugin[^\n]*add/, 'source install instructions'],
  ]
  for (const [pattern, label] of requiredZh) {
    if (!pattern.test(zh)) fail(`README.zh.md no longer documents ${label}`)
  }
  const forbidden = [
    /25\s*[\/:]\s*5/,
    /pomodoro timer/i,
    /display[- ]only/i,
    /仅显示/,
    /your own \(root\) conversation's turn/i,
    /你的（root）会话整轮完成|your own \(root\) conversation's turn/i,
    /manual pause[^.]{0,40}(?:needs|must)[^.]{0,30}(?:continue|resume)/i,
    /手动[^。]{0,30}(?:必须|才能)[^。]{0,20}继续/i,
    /countdown chip/i,
    /seven (?:common )?(?:settings|controls)/i,
    /7 个设置/,
    /sidebar hiding|hide other conversations/i,
    /enter (?:your |the )?password/i,
    /tool calls are refused/i,
  ]
  for (const pattern of forbidden) {
    if (pattern.test(en) || pattern.test(zh)) fail(`README still advertises a removed concept: ${pattern}`)
  }
  return 'pitch, rules, boundary, settings, commands'
})

check('release docs stay concise', () => {
  for (const [file, [min, max]] of Object.entries(DOC_SIZE_BUDGET)) {
    const size = readText(file).length
    if (size < min) fail(`${file} looks truncated (${size} bytes < ${min})`)
    if (size > max) fail(`${file} is too large (${size} bytes > ${max}); keep the release docs tight`)
  }
  return 'READMEs and docs within the size budget'
})

check('LICENSE and CHANGELOG', () => {
  const license = readText('LICENSE')
  if (!license.startsWith('MIT License')) fail('LICENSE does not start with "MIT License"')
  if (!license.includes('Copyright (c) 2026 dsh-deep-focus contributors')) fail('LICENSE has an unexpected copyright line')
  const changelog = readText('CHANGELOG.md')
  if (!changelog.includes('## [Unreleased]')) fail('CHANGELOG.md has no [Unreleased] section')
  const entry = new RegExp(`^## \\[${pkg.version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm')
  if (!entry.test(changelog)) fail(`CHANGELOG.md needs a dated "[${pkg.version}] - YYYY-MM-DD" entry`)
  if (pkg.version === '0.4.21' && !changelog.includes('## [0.4.21] - 2026-11-06')) {
    fail('CHANGELOG.md must date the 0.4.21 entry 2026-11-06')
  }
  for (const heading of ['### Added', '### Changed', '### Fixed']) {
    if (!changelog.includes(heading)) fail(`CHANGELOG.md entry is missing "${heading}"`)
  }
  if (!/0\.1\.0[^\n]*0\.4\.[0-9][^\n]*never published/i.test(changelog)) {
    fail('CHANGELOG.md must note that 0.1.0–0.4.x were never published')
  }
  return `MIT, dated ${pkg.version} entry`
})

check('required files exist', () => {
  const missing = REQUIRED_FILES.filter((file) => !existsSync(abs(file)))
  if (missing.length) fail(`missing release files: ${missing.join(', ')}`)
  return `${REQUIRED_FILES.length} files`
})

check('source imports are resolvable', () => {
  const sourceFiles = walkFiles(abs('src')).filter((file) => file.endsWith('.js'))
  if (sourceFiles.length === 0) fail('no JavaScript source files found under src/')
  const relativeSpecifier = (specifier) => specifier.startsWith('./') || specifier.startsWith('../')
  for (const file of sourceFiles) {
    const relative = file.slice(ROOT.length + 1).split('\\').join('/')
    const code = stripComments(readFileSync(file, 'utf8'))
    const specifiers = new Set()
    for (const pattern of [
      /\bimport\s*\(\s*['"]([^'"]+)['"]/g,
      /\bimport\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
      /\bexport\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
    ]) {
      for (const match of code.matchAll(pattern)) specifiers.add(match[1])
    }
    for (const specifier of specifiers) {
      if (specifier.startsWith('node:')) continue
      if (relativeSpecifier(specifier)) {
        if (!existsSync(resolve(dirname(file), specifier))) fail(`${relative}: relative import "${specifier}" does not exist`)
        continue
      }
      if (ALLOWED_BARE_IMPORTS.has(specifier)) continue
      fail(`${relative}: imports "${specifier}", which is not a DSH-resolvable dependency`)
    }
  }
  return `${sourceFiles.length} files`
})

check('source entry exports', () => {
  const index = readText('src/index.js')
  if (!/\bexport\s+(?:async\s+)?function\s+apply\b|\bexport\s+(?:const|let)\s+apply\b/.test(index)) {
    fail('src/index.js must export apply(ctx)')
  }
  if (!/\binject\b/.test(index)) fail('src/index.js must declare injected services')
  const client = readText('src/client.js')
  if (!client.includes('__ModuleLoader__')) fail('src/client.js must be a DSH browser module')
  if (!/\bapply\s*\(/.test(client.match(/__ModuleLoader__[\s\S]*/)?.[0] ?? '')) {
    fail('src/client.js does not expose apply(ctx)')
  }
  return 'apply + inject + client registration'
})

check('client bundle has no escaped-newline corruption', () => {
  // A literal "\n" inside a // comment swallows the following line, which once
  // removed a declaration and crashed the widget at runtime.
  const client = readText('src/client.js')
  const lines = client.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (/\/\/[^\n]*\\n/.test(lines[index])) {
      fail(`src/client.js:${index + 1} has a literal \\n inside a line comment (code after it is swallowed)`)
      break
    }
  }
  return 'line comments are clean'
})

check('tests and e2e exist', () => {
  const testFiles = walkFiles(abs('test')).filter((file) => file.endsWith('.test.mjs') || file.endsWith('.test.js'))
  if (testFiles.length === 0) fail('test/ contains no test files')
  if (!existsSync(abs('scripts/e2e.mjs'))) fail('scripts/e2e.mjs is missing')
  return `${testFiles.length} test files + e2e script`
})

check('markdown links and screenshot placeholder', () => {
  const markdown = ['README.md', 'README.zh.md', ...walkFiles(abs('docs')).map((file) => file.slice(ROOT.length + 1).split('\\').join('/')).filter((file) => file.endsWith('.md'))]
  for (const file of markdown) assertLocalLinks(file)
  for (const file of ['README.md', 'README.zh.md']) {
    const text = readText(file)
    if (text.includes('<!-- screenshots:pending -->')) continue
    const images = [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((match) => match[1]).filter((target) => !/^https?:/i.test(target))
    if (images.length === 0) fail(`${file}: keep the screenshots placeholder until real images exist`)
  }
  return `${markdown.length} markdown files`
})

check('GitHub-only release workflows', () => {
  const workflowDirectory = abs('.github/workflows')
  const workflowFiles = readdirSync(workflowDirectory).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  if (existsSync(abs('.github/workflows/publish.yml'))) {
    fail('.github/workflows/publish.yml must not exist (npm publishing was removed)')
  }
  for (const file of workflowFiles) {
    if (/\bnpm\s+publish\b/i.test(readText(`.github/workflows/${file}`))) {
      fail(`.github/workflows/${file} still runs npm publish`)
    }
  }
  const ci = readText('.github/workflows/ci.yml')
  if (!/node-version:\s*\[\s*20\s*,\s*22\s*\]/.test(ci)) fail('ci.yml must run on Node 20 and 22')
  for (const step of ['node scripts/verify.mjs', 'npm test', '--check']) {
    if (!ci.includes(step)) fail(`ci.yml does not run "${step}"`)
  }
  const publishing = readText('docs/publishing.md')
  for (const forbidden of [/npm\s+publish/i, /trusted publishing/i, /\bprovenance\b/i, /\bOIDC\b/i]) {
    if (forbidden.test(publishing)) fail(`docs/publishing.md still describes a removed npm publishing flow (${forbidden})`)
  }
  if (!/not published to npm|不发布到 npm/i.test(publishing)) fail('docs/publishing.md must state the project is not published to npm')
  if (!/dsh plugin[^\n]*add/i.test(publishing)) fail('docs/publishing.md must document installing with dsh plugin add <repo or path>')
  return `CI on Node 20/22, no npm publishing (${workflowFiles.length} workflow file)`
})

check('privacy docs match the data collection', () => {
  const combined = readText('README.md') + readText('README.zh.md') + readText('docs/privacy.md')
  if (!combined.includes('$DSH_HOME/plugin-data/dsh-deep-focus')) fail('must document the plugin data directory')
  if (!/no network|不联网|never makes a network/i.test(combined)) fail('must state the plugin never uses the network')
  if (!/foreground|前台/.test(combined)) fail('must describe foreground-application sampling')
  if (!/window title|窗口标题/.test(combined)) fail('must state window titles are not recorded')
  if (!/app name|应用名/.test(combined)) fail('must state only app names and durations are stored')
  if (!/limits\.json/.test(combined)) fail('must document limits.json')
  if (!/rest[^.]{0,60}(?:excluded|not (?:counted|added))/i.test(combined)) fail('must state rest time is excluded')
  if (!/pause|暂停/i.test(combined)) fail('must mention the automatic rest/pause')
  if (!/no new data|nothing new is recorded|不新增/i.test(combined)) fail('must state the auto-rest/away logic records no new data')
  return 'local-only, foreground names, rest excluded'
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
