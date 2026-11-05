#!/usr/bin/env node
/**
 * Settings-table generator for README.md and README.zh.md.
 *
 * The table between the `<!-- config-table:start -->` / `<!-- config-table:end -->`
 * markers is generated from `DEFAULT_SETTINGS` in src/shared/contract.js, so the
 * documented defaults can never drift from the code.
 *
 *   node scripts/config-table.mjs                print the English table
 *   node scripts/config-table.mjs --lang zh      print the Chinese table
 *   node scripts/config-table.mjs --write        rewrite both README tables
 *   node scripts/config-table.mjs --check        exit 1 when a README is stale
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const START = '<!-- config-table:start -->'
const END = '<!-- config-table:end -->'
const README_FILES = { en: 'README.md', zh: 'README.zh.md' }

/**
 * Documented fields, in reading order. A key missing here fails the coverage
 * check, so a new setting must be described (with its unit) before it ships.
 * `security.*` and the internal `version` field are intentionally not user-facing.
 */
const FIELDS = [
  {
    key: 'focus.workMinutes',
    unit: 'min',
    note: { en: 'Length of one focus block.', zh: '单个专注时段的长度。' },
  },
  {
    key: 'focus.breakMinutes',
    unit: 'min',
    note: { en: 'Short break after each focus block.', zh: '每个专注时段后的短休息。' },
  },
  {
    key: 'focus.longBreakMinutes',
    unit: 'min',
    note: {
      en: 'Long break taken every `focus.longBreakEvery` focus blocks.',
      zh: '每 `focus.longBreakEvery` 轮专注后的长休息。',
    },
  },
  {
    key: 'focus.longBreakEvery',
    unit: 'blocks',
    note: { en: 'Focus blocks between long breaks; 0 disables long breaks.', zh: '长休息之间的专注轮数；0 = 关闭长休息。' },
  },
  {
    key: 'focus.autoStartBreak',
    unit: '',
    note: { en: 'Start the break automatically when a focus block completes.', zh: '专注时段结束后自动开始休息。' },
  },
  {
    key: 'focus.autoStartNext',
    unit: '',
    note: { en: 'Start the next focus block automatically when a break ends.', zh: '休息结束后自动开始下一轮专注。' },
  },
  {
    key: 'focus.idlePauseSeconds',
    unit: 's',
    note: {
      en: 'Pause the timer after this much inactivity; 0 disables auto-pause.',
      zh: '无操作达到此时长后暂停计时；0 = 关闭自动暂停。',
    },
  },
  {
    key: 'focus.autoResumeOnReturn',
    unit: '',
    note: { en: 'Resume a paused block when you are active again.', zh: '回到电脑后自动继续已暂停的时段。' },
  },
  {
    key: 'limits.dailyActiveMinutes',
    unit: 'min',
    note: { en: 'Daily active-time cap; 0 = unlimited.', zh: '每日活跃时长上限；0 = 不限。' },
  },
  {
    key: 'limits.continuousWorkMinutes',
    unit: 'min',
    note: { en: 'Cap on unbroken work before a break; 0 = unlimited.', zh: '连续工作时长上限；0 = 不限。' },
  },
  {
    key: 'limits.sessionMinutes',
    unit: 'min',
    note: { en: 'Cap on a single focus block; 0 = unlimited.', zh: '单次专注时长上限；0 = 不限。' },
  },
  {
    key: 'limits.unlockMinutes',
    unit: 'min',
    note: { en: 'Extra app time granted by one password unlock.', zh: '输入一次密码解锁后增加的可用时长。' },
  },
  {
    key: 'limits.dailyUnlockLimit',
    unit: 'count',
    note: { en: 'Password unlocks allowed per day; 0 = unlimited.', zh: '每日密码解锁次数；0 = 不限。' },
  },
  {
    key: 'limits.strictNoUnlock',
    unit: '',
    note: {
      en: 'Hide the password field: a lock can only be ended by a forced break.',
      zh: '隐藏密码输入框：锁定后只能通过强制休息解除。',
    },
  },
  {
    key: 'lock.singleConversation',
    unit: '',
    note: {
      en: 'Keep one conversation active while a focus block or agent turn is running.',
      zh: '专注时段或 agent 回合进行时，只保留一个会话。',
    },
  },
  {
    key: 'lock.blockToolsOutsideFocus',
    unit: '',
    note: { en: 'The Host refuses tool calls from other conversations.', zh: 'Host 拒绝其它会话的工具调用。' },
  },
  {
    key: 'lock.lockSidebarOutsideFocus',
    unit: '',
    note: {
      en: 'Best effort: dim and block the other conversations in the sidebar.',
      zh: '尽力而为：置灰并拦截侧栏中的其它会话。',
    },
  },
  {
    key: 'lock.exemptSubagents',
    unit: '',
    note: {
      en: 'Exempt Agent Teams members from the conversation lock (non-root subagents are always exempt).',
      zh: '对 Agent Teams 成员豁免会话锁（子代理等非根 agent 始终豁免）。',
    },
  },
  {
    key: 'alerts.taskDone',
    unit: '',
    note: { en: 'Toast and chime when a focus block completes.', zh: '专注时段完成时显示 toast 并播放提示音。' },
  },
  {
    key: 'alerts.turnDone',
    unit: '',
    note: { en: 'Extra toast at the end of every agent turn.', zh: '每个 agent 回合结束时额外提示一次。' },
  },
  {
    key: 'alerts.sound',
    unit: '',
    note: { en: 'Play the synthesized completion chime.', zh: '播放合成的完成提示音。' },
  },
  {
    key: 'alerts.volume',
    unit: 'ratio',
    note: { en: 'Chime volume.', zh: '提示音音量。' },
  },
  {
    key: 'alerts.quietHoursStart',
    unit: 'clock',
    note: {
      en: 'Start of quiet hours (sound suppressed); null = off.',
      zh: '静音时段的开始时间（该时段内不播放提示音）；null = 关闭。',
    },
  },
  {
    key: 'alerts.quietHoursEnd',
    unit: 'clock',
    note: { en: 'End of quiet hours; null = off.', zh: '静音时段的结束时间；null = 关闭。' },
  },
  {
    key: 'usage.sampleSeconds',
    unit: 's',
    note: { en: 'How often the idle sampler reads system activity.', zh: '空闲采样的读取间隔。' },
  },
  {
    key: 'usage.idleThresholdSeconds',
    unit: 's',
    note: { en: 'Idle time below this counts as active.', zh: '空闲时长低于此值算作活跃。' },
  },
  {
    key: 'usage.retentionDays',
    unit: 'days',
    note: { en: 'Days of local usage history kept.', zh: '本地使用记录保留天数。' },
  },
  {
    key: 'usage.detectMedia',
    unit: '',
    note: {
      en: 'Media-playback exemption, reserved for a later release; inert in 0.1.0.',
      zh: '媒体播放豁免，为后续版本预留；0.1.0 中不生效。',
    },
  },
]

const UNIT_LABELS = {
  min: { en: 'min', zh: '分钟' },
  blocks: { en: 'blocks', zh: '轮' },
  s: { en: 's', zh: '秒' },
  days: { en: 'days', zh: '天' },
  count: { en: 'count', zh: '次' },
  ratio: { en: '0–1', zh: '0–1' },
  clock: { en: 'HH:MM', zh: 'HH:MM' },
  '': { en: '—', zh: '—' },
}

const COLUMNS = {
  en: ['Setting', 'Default', 'Unit', 'Notes'],
  zh: ['配置项', '默认值', '单位', '说明'],
}

const FOOTER = {
  en: '> `security.*` keys are managed by the plugin (a salted scrypt hash of the unlock password) and are never returned by the settings API. Times are minutes unless the unit says otherwise; `0` disables a limit.',
  zh: '> `security.*` 由插件内部管理（解锁密码的加盐 scrypt 哈希），设置接口永远不会返回。未特别注明时时间单位为分钟；`0` 表示关闭该限制。',
}

function loadDefaults() {
  const modulePath = join(ROOT, 'src', 'shared', 'contract.js')
  if (!existsSync(modulePath)) {
    throw new Error('src/shared/contract.js is missing; cannot generate the settings table')
  }
  return import(pathToFileURL(modulePath).href).then((mod) => {
    if (!mod.DEFAULT_SETTINGS) throw new Error('src/shared/contract.js does not export DEFAULT_SETTINGS')
    return mod.DEFAULT_SETTINGS
  })
}

const DEFAULTS = await loadDefaults()

function getPath(object, dottedKey) {
  return dottedKey.split('.').reduce((value, part) => (value === undefined || value === null ? undefined : value[part]), object)
}

/** Every leaf key of an object, e.g. `focus.workMinutes`. */
function leafKeys(object, prefix = '') {
  const keys = []
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...leafKeys(value, path))
    } else {
      keys.push(path)
    }
  }
  return keys
}

/** Fails when contract.js gains/loses a setting that this table does not describe. */
function assertCoverage() {
  const documented = new Set(FIELDS.map((field) => field.key))
  const actual = new Set(
    leafKeys(DEFAULTS).filter((key) => key !== 'version' && !key.startsWith('security.')),
  )
  const undocumented = [...actual].filter((key) => !documented.has(key))
  const stale = [...documented].filter((key) => !actual.has(key))
  if (undocumented.length || stale.length) {
    const parts = []
    if (undocumented.length) parts.push(`undocumented: ${undocumented.join(', ')}`)
    if (stale.length) parts.push(`not in contract.js: ${stale.join(', ')}`)
    throw new Error(`settings table is out of sync with contract.js (${parts.join('; ')})`)
  }
}

function renderDefault(value, lang) {
  if (typeof value === 'boolean') return value ? (lang === 'zh' ? '开' : 'On') : (lang === 'zh' ? '关' : 'Off')
  if (value === null) return 'null'
  return String(value)
}

/** Markdown table plus the footnote, without the marker lines. */
export function renderTable(lang) {
  assertCoverage()
  const columns = COLUMNS[lang]
  const lines = [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map((_, index) => (index === 1 || index === 2 ? '---:' : '---')).join(' | ')} |`,
  ]
  for (const field of FIELDS) {
    const value = getPath(DEFAULTS, field.key)
    if (value === undefined) throw new Error(`contract.js has no value for ${field.key}`)
    const unit = UNIT_LABELS[field.unit][lang]
    lines.push(`| \`${field.key}\` | ${renderDefault(value, lang)} | ${unit} | ${field.note[lang]} |`)
  }
  lines.push('')
  lines.push(FOOTER[lang])
  return lines.join('\n')
}

export function renderBlock(lang) {
  return `${START}\n${renderTable(lang)}\n${END}`
}

function locateBlock(text, file) {
  const start = text.indexOf(START)
  const end = text.indexOf(END)
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${file}: missing "${START}" / "${END}" markers around the settings table`)
  }
  return { start, end: end + END.length }
}

function readReadme(lang) {
  const file = README_FILES[lang]
  const path = join(ROOT, file)
  if (!existsSync(path)) throw new Error(`${file} is missing`)
  return { file, path, text: readFileSync(path, 'utf8') }
}

/** Returns the generated block for each language after comparing it to both READMEs. */
export function checkConfigTables() {
  const problems = []
  for (const lang of Object.keys(README_FILES)) {
    const { file, text } = readReadme(lang)
    let current
    try {
      const { start, end } = locateBlock(text, file)
      current = text.slice(start, end)
    } catch (error) {
      problems.push(error.message)
      continue
    }
    const expected = renderBlock(lang)
    if (current.trimEnd() !== expected.trimEnd()) {
      const actualLines = current.split('\n')
      const expectedLines = expected.split('\n')
      let line = 0
      while (line < actualLines.length && line < expectedLines.length && actualLines[line] === expectedLines[line]) line += 1
      problems.push(
        `${file}: settings table differs from contract.js (line ${line + 1}: expected "${expectedLines[line] ?? ''}", found "${actualLines[line] ?? ''}"); run node scripts/config-table.mjs --write`,
      )
    }
  }
  if (problems.length) throw new Error(problems.join('\n'))
  return 'README.md and README.zh.md match contract.js'
}

export function writeConfigTables() {
  assertCoverage()
  for (const lang of Object.keys(README_FILES)) {
    const { file, path, text } = readReadme(lang)
    const { start, end } = locateBlock(text, file)
    const updated = text.slice(0, start) + renderBlock(lang) + text.slice(end)
    writeFileSync(path, updated)
  }
  return Object.values(README_FILES)
}

const isMain =
  typeof process.argv[1] === 'string' && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const args = process.argv.slice(2)
  const lang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : 'en'
  try {
    if (args.includes('--write')) {
      const files = writeConfigTables()
      console.log(`updated ${files.join(', ')} from src/shared/contract.js`)
    } else if (args.includes('--check')) {
      console.log(checkConfigTables())
    } else {
      if (!COLUMNS[lang]) throw new Error(`unknown --lang "${lang}" (expected en or zh)`)
      console.log(renderTable(lang))
    }
  } catch (error) {
    console.error(`config-table: ${error.message}`)
    process.exitCode = 1
  }
}
