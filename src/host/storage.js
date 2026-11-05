/** Local persistence: plugin data directory, atomic JSON files, append-only JSONL and per-file write serialization. */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { mergeAppMs } from './apps.js'

/** Resolve the Harness home: explicit DSH_HOME wins, otherwise `<home>/.dsh`. */
export function resolveDshHome(env = process.env, home = homedir()) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return resolve(configured.length > 0 ? configured : join(home, '.dsh'))
}

/** Plugin data directory: `$DSH_HOME/plugin-data/dsh-deep-focus`. */
export function pluginDataDir(options = {}) {
  return join(resolveDshHome(options.env, options.home), 'plugin-data', 'dsh-deep-focus')
}

/** `YYYY-MM-DD` for an instant in a fixed timezone offset (`Date#getTimezoneOffset` minutes). */
export function dayKeyAt(ms, offsetMinutes = 0) {
  if (!Number.isFinite(ms)) return ''
  const date = new Date(ms - offsetMinutes * 60_000)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Local calendar day key for an instant; used for every per-day bucket. */
export function localDayKey(ms) {
  return dayKeyAt(ms, new Date(ms).getTimezoneOffset())
}

/** Shift a `YYYY-MM-DD` key by whole days (calendar-safe, no DST math). */
export function shiftDayKey(dayKey, deltaDays) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey)
  if (match === null) return dayKey
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return dayKeyAt(base + deltaDays * 86_400_000, 0)
}

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/

/**
 * Create the storage facade.
 * Writes to one file are chained so a read-modify-write is never interleaved;
 * JSON files are written to a temporary sibling and renamed into place.
 */
export function createStorage({ dir = pluginDataDir() } = {}) {
  const tails = new Map()
  let dirReady = null
  let tmpCounter = 0

  const absolute = (relativePath) => join(dir, ...relativePath.split('/'))

  function ensureDir(path) {
    return fs.mkdir(path, { recursive: true })
  }

  function ensureRoot() {
    if (dirReady === null) dirReady = ensureDir(dir).catch((error) => { dirReady = null; throw error })
    return dirReady
  }

  function enqueue(key, task) {
    const previous = tails.get(key) ?? Promise.resolve()
    const next = previous.then(task, task)
    const tail = next.catch(() => {})
    tails.set(key, tail)
    tail.then(() => { if (tails.get(key) === tail) tails.delete(key) })
    return next
  }

  async function atomicWriteJson(absolutePath, value) {
    await ensureDir(dirname(absolutePath))
    const tmp = `${absolutePath}.${process.pid}.${tmpCounter++}.tmp`
    try {
      await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      await fs.rename(tmp, absolutePath)
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => {})
      throw error
    }
  }

  return {
    dir,

    /** @param {string} relativePath forward-slash path under the data directory */
    pathOf(relativePath) {
      return absolute(relativePath)
    },

    ensureRoot,

    async readJson(relativePath, fallback = null) {
      try {
        const text = await fs.readFile(absolute(relativePath), 'utf8')
        return JSON.parse(text)
      } catch {
        return fallback
      }
    },

    writeJson(relativePath, value) {
      const key = `json:${relativePath}`
      return enqueue(key, async () => {
        await ensureRoot()
        await atomicWriteJson(absolute(relativePath), value)
      })
    },

    appendJsonl(relativePath, record) {
      const key = `jsonl:${relativePath}`
      return enqueue(key, async () => {
        await ensureRoot()
        await ensureDir(dirname(absolute(relativePath)))
        await fs.appendFile(absolute(relativePath), `${JSON.stringify(record)}\n`, 'utf8')
      })
    },

    /** Read a JSONL file; invalid lines are skipped, `limit` keeps the newest records. */
    async readJsonl(relativePath, { limit = 0 } = {}) {
      let text
      try {
        text = await fs.readFile(absolute(relativePath), 'utf8')
      } catch {
        return []
      }
      const records = []
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        try {
          records.push(JSON.parse(trimmed))
        } catch {
          // A truncated tail after a power loss only loses that line.
        }
      }
      return limit > 0 && records.length > limit ? records.slice(-limit) : records
    },

    /**
     * Sum one usage day: `{ activeMs, apps: Map<id, ms> }`.
     * v2 lines are `{t, activeMs, apps}`; v1 lines (`{t, ms}`) are still counted
     * so an upgraded install keeps its history.
     */
    async readUsageDay(dayKey) {
      const records = await this.readJsonl(`usage/${dayKey}.jsonl`)
      let activeMs = 0
      const apps = new Map()
      for (const record of records) {
        if (record === null || typeof record !== 'object') continue
        if (Number.isFinite(record.activeMs) && record.activeMs > 0) activeMs += record.activeMs
        else if (Number.isFinite(record.ms) && record.ms > 0) activeMs += record.ms
        mergeAppMs(apps, record.apps)
      }
      return { activeMs, apps }
    },

    /** Day keys that have a JSONL file in `subdir` (`usage` or `stats`). */
    async listDayKeys(subdir) {
      let names
      try {
        names = await fs.readdir(absolute(subdir))
      } catch {
        return []
      }
      return names
        .map((name) => DAY_FILE.exec(name)?.[1])
        .filter((key) => key !== undefined)
        .sort()
    },

    /** Delete per-day files older than the retention window (today included). */
    async prune({ retentionDays = 30, dayKey }) {
      const days = Math.max(1, Math.round(retentionDays))
      const cutoff = shiftDayKey(dayKey, -(days - 1))
      let removed = 0
      for (const subdir of ['usage', 'stats']) {
        for (const key of await this.listDayKeys(subdir)) {
          if (key >= cutoff) continue
          await fs.rm(absolute(`${subdir}/${key}.jsonl`), { force: true }).catch(() => {})
          removed += 1
        }
      }
      return removed
    },

    /** Wait for every queued write to settle. */
    async flush() {
      while (tails.size > 0) {
        await Promise.all([...tails.values()])
      }
    },
  }
}
