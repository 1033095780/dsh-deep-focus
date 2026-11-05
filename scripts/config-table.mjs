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
 * The internal `version` field is intentionally not user-facing.
 */
const FIELDS = [
  {
    key: 'limits.dailyMinutes',
    unit: 'min',
    note: {
      en: 'Daily whole-machine active-time cap while DSH runs; 0 = no daily cap.',
      zh: 'DSH 运行期间整机活跃时长的每日上限；0 = 不限制。',
    },
  },
  {
    key: 'limits.continuousMinutes',
    unit: 'min',
    note: {
      en: 'Continuous-use cap before the assistant forces a rest; 0 = no forced rest.',
      zh: '触发强制休息的连续使用时长的上限；0 = 不强制休息。',
    },
  },
  {
    key: 'limits.restMinutes',
    unit: 'min',
    note: {
      en: 'Length of a forced rest. Rest time is not counted toward the daily cap.',
      zh: '强制休息时长。休息时间不计入每日上限。',
    },
  },
  {
    key: 'limits.extendMinutes',
    unit: 'min',
    note: {
      en: 'Extra usage granted by one click on “Use 20 more minutes”.',
      zh: '点击一次「再使用 20 分钟」增加的时长。',
    },
  },
  {
    key: 'limits.dailyExtendLimit',
    unit: 'count',
    note: {
      en: 'Extensions per day; 0 = unlimited, a positive value is the daily maximum.',
      zh: '每日可续期次数；0 = 不限次数，正数才是每日上限。',
    },
  },
  {
    key: 'assistant.enabled',
    unit: '',
    note: {
      en: 'Track and enforce the rules; off = keep statistics only (nothing enforces).',
      zh: '统计并执行限制；关闭后只做统计，不做任何限制。',
    },
  },
  {
    key: 'assistant.soloSession',
    unit: '',
    note: {
      en: 'Pin the UI to one primary conversation while a root conversation is running.',
      zh: '有根会话在运行时把 UI 固定到唯一主会话。',
    },
  },
  {
    key: 'assistant.hideOtherSessions',
    unit: '',
    note: {
      en: 'Gray out the other conversation and workspace folder rows while a primary conversation runs (visible but not clickable).',
      zh: '有主会话在运行时把其它会话与工作区文件夹行置灰（可见但不可点击）。',
    },
  },
  {
    key: 'assistant.showRings',
    unit: '',
    note: {
      en: 'Show the floating top-right widget with the two usage rings.',
      zh: '在 DSH 右上角显示悬浮双环小组件。',
    },
  },
  {
    key: 'alerts.sound',
    unit: '',
    note: {
      en: 'Play the short chime for rest, pause and completion alerts.',
      zh: '休息、暂停与完成提醒时播放短提示音。',
    },
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
    key: 'alerts.awayIdleSeconds',
    unit: 's',
    note: {
      en: 'Consider you away (for the completion chime) after this much idle time.',
      zh: '空闲达到此时长即视为离开（决定完成提示音是否响起）。',
    },
  },
  {
    key: 'alerts.repeatUntilActive',
    unit: '',
    note: {
      en: 'Repeat the completion chime while you are away until input returns.',
      zh: '离开期间重复播放完成提示音，直到你回来操作。',
    },
  },
  {
    key: 'alerts.repeatIntervalMs',
    unit: 'ms',
    note: {
      en: 'Chime repeat interval while away (clamped to 500–10000 ms).',
      zh: '离开期间提示音的重复间隔（限制在 500–10000 毫秒）。',
    },
  },
  {
    key: 'usage.sampleSeconds',
    unit: 's',
    note: {
      en: 'How often the foreground app and idle time are sampled.',
      zh: '前台应用与空闲时长的采样间隔。',
    },
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
    key: 'usage.trackApps',
    unit: '',
    note: {
      en: 'Record which foreground application is active (app name + duration only; no window titles).',
      zh: '记录前台应用（只存应用名与时长，不记录窗口标题）。',
    },
  },
  {
    key: 'usage.autoPauseSeconds',
    unit: 's',
    note: {
      en: 'Pause counting automatically after this much keyboard/mouse idle; 0 = off.',
      zh: '键鼠空闲达到此时长后自动暂停计时；0 = 关闭。',
    },
  },
]

const UNIT_LABELS = {
  min: { en: 'min', zh: '分钟' },
  s: { en: 's', zh: '秒' },
  ms: { en: 'ms', zh: '毫秒' },
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
  en: '> Times are minutes unless the unit says otherwise. The defaults are the agreed product rules: a 3-hour daily cap, a forced 10-minute rest after 30 continuous minutes, unlimited 20-minute extensions by default (set a positive daily limit to cap them), and a completion chime that only repeats while you are away. The assistant never blocks tools and only enforces inside DSH (see the capability boundary below).',
  zh: '> 未特别注明时时间单位为分钟。默认值即已确认的产品规则：每日上限 3 小时、连续使用 30 分钟后强制休息 10 分钟、默认不限次数的 20 分钟续期（设置正数才会限制次数），完成提示音只在你离开时重复。助手绝不拦截工具，限制只在 DSH 内生效（见下方能力边界）。',
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

/** Every leaf key of an object, e.g. `limits.dailyMinutes`. */
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
  const actual = new Set(leafKeys(DEFAULTS).filter((key) => key !== 'version'))
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
