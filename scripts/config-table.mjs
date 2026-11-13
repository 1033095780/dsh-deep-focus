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
 * Documented settings, in reading order. Every leaf of `DEFAULT_SETTINGS.notifications`
 * must have an entry here and vice versa (checked by `--check`).
 */
const FIELDS = [
  {
    key: 'notifications.dingtalkEnabled',
    note: {
      en: 'Send a completion message to DingTalk when a locked conversation finishes. The lock itself works either way.',
      zh: '被锁定的会话完成时向钉钉发送完成消息；锁定功能不依赖它。',
    },
  },
  {
    key: 'notifications.dingtalkToken',
    note: {
      en: 'DingTalk group-robot access token. Stored only in the local plugin data directory; the browser only sees “set” and the last 4 characters.',
      zh: '钉钉群机器人 access_token。只保存在本机插件数据目录；浏览器只看到“已设置”与末 4 位。',
    },
  },
]

const COLUMNS = {
  en: ['Setting', 'Default', 'Unit', 'Notes'],
  zh: ['设置项', '默认值', '单位', '说明'],
}

function readText(relative) {
  return readFileSync(join(ROOT, relative), 'utf8')
}

async function loadContract() {
  return import(pathToFileURL(join(ROOT, 'src/shared/contract.js')).href)
}

function getPath(object, dottedKey) {
  return dottedKey
    .split('.')
    .reduce((value, part) => (value === undefined || value === null ? undefined : value[part]), object)
}

function formatDefault(value, lang) {
  if (value === true) return lang === 'zh' ? '开' : 'On'
  if (value === false) return lang === 'zh' ? '关' : 'Off'
  if (value === '' || value === null || value === undefined) return lang === 'zh' ? '（未设置）' : '(unset)'
  if (typeof value === 'number') return String(value)
  return String(value)
}

function renderTable(lang, contract) {
  const columns = COLUMNS[lang]
  const header = `| ${columns.join(' | ')} |`
  const divider = `| ${columns.map((_, index) => (index === 1 || index === 2 ? '---:' : '---')).join(' | ')} |`
  const rows = FIELDS.map((field) => {
    const value = getPath(contract.DEFAULT_SETTINGS, field.key)
    const unit = field.unit ? field.unit : '—'
    return `| \`${field.key}\` | ${formatDefault(value, lang)} | ${unit} | ${field.note[lang]} |`
  })
  return [header, divider, ...rows].join('\n')
}

function renderBlock(lang, contract) {
  return `${START}\n${renderTable(lang, contract)}\n${END}`
}

function locateBlock(text, file) {
  const start = text.indexOf(START)
  if (start < 0) throw new Error(`${file}: missing ${START}`)
  if (text.indexOf(START, start + START.length) >= 0) throw new Error(`${file}: duplicated ${START}`)
  const end = text.indexOf(END, start)
  if (end < 0) throw new Error(`${file}: missing ${END}`)
  return { start, end: end + END.length }
}

async function assertCoverage(contract) {
  const notifications = contract.DEFAULT_SETTINGS?.notifications
  if (!notifications || typeof notifications !== 'object') {
    throw new Error('contract DEFAULT_SETTINGS.notifications is missing')
  }
  const contractKeys = Object.keys(notifications)
  const fieldKeys = FIELDS.map((field) => field.key.split('.').slice(1).join('.'))
  const missing = contractKeys.filter((key) => !fieldKeys.includes(key))
  const extra = fieldKeys.filter((key) => !contractKeys.includes(key))
  if (missing.length || extra.length) {
    throw new Error(
      `config-table coverage differs from contract.js (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`,
    )
  }
  for (const field of FIELDS) {
    for (const lang of Object.keys(README_FILES)) {
      if (!field.note[lang] || typeof field.note[lang] !== 'string') {
        throw new Error(`${field.key}: missing ${lang} note`)
      }
    }
  }
}

function readReadme(lang) {
  const file = README_FILES[lang]
  if (!existsSync(join(ROOT, file))) throw new Error(`missing ${file}`)
  return { file, path: join(ROOT, file), text: readText(file) }
}

/** Returns the generated block for each language after comparing it to both READMEs. */
export async function checkConfigTables() {
  const contract = await loadContract()
  await assertCoverage(contract)
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
    const expected = renderBlock(lang, contract)
    if (current.trimEnd() !== expected.trimEnd()) {
      problems.push(
        `${file}: settings table differs from contract.js; run node scripts/config-table.mjs --write`,
      )
    }
  }
  if (problems.length) throw new Error(problems.join('\n'))
  return 'README.md and README.zh.md match contract.js'
}

export async function writeConfigTables() {
  const contract = await loadContract()
  await assertCoverage(contract)
  for (const lang of Object.keys(README_FILES)) {
    const { path, text } = readReadme(lang)
    const { start, end } = locateBlock(text, README_FILES[lang])
    const updated = text.slice(0, start) + renderBlock(lang, contract) + text.slice(end)
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
    const contract = await loadContract()
    if (args.includes('--write')) {
      const files = await writeConfigTables()
      console.log(`updated ${files.join(', ')} from src/shared/contract.js`)
    } else if (args.includes('--check')) {
      console.log(await checkConfigTables())
    } else {
      if (!COLUMNS[lang]) throw new Error(`unknown --lang "${lang}" (expected en or zh)`)
      await assertCoverage(contract)
      console.log(renderTable(lang, contract))
    }
  } catch (error) {
    console.error(`config-table: ${error.message}`)
    process.exitCode = 1
  }
}
