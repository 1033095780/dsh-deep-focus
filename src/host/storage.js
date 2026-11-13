/**
 * Local persistence for the lock plugin: plugin data directory, atomic JSON
 * files and a one-shot cleanup of the removed timing product's data files.
 */
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Resolve the Harness home: explicit DSH_HOME wins, otherwise `<home>/.dsh`. */
export function resolveDshHome(env = process.env, home = homedir()) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return resolve(configured.length > 0 ? configured : join(home, '.dsh'))
}

/** Plugin data directory: `$DSH_HOME/plugin-data/dsh-deep-focus`. */
export function pluginDataDir(options = {}) {
  return join(resolveDshHome(options.env, options.home), 'plugin-data', 'dsh-deep-focus')
}

const LEGACY_DAY_FILE = /^20\d{2}-\d{2}-\d{2}\.jsonl$/
const LEGACY_NAMES = new Set(['limits.json'])

/**
 * Create the storage facade. Writes to one file are chained so concurrent
 * read-modify-write cycles never interleave; JSON files are written to a
 * temporary sibling and renamed into place.
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

  /** Directory entries as `{name, isDirectory}`; a missing directory is empty. */
  async function listDir(relativePath = '') {
    try {
      const entries = await fs.readdir(absolute(relativePath), { withFileTypes: true })
      return entries.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
    } catch {
      return []
    }
  }

  async function removeFile(relativePath) {
    await fs.rm(absolute(relativePath), { force: true })
    return true
  }

  return {
    dir,
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

    remove(relativePath) {
      return enqueue(`remove:${relativePath}`, () => removeFile(relativePath))
    },

    listDir,

    /** Wait for every queued write to settle (best effort at unload). */
    async flush() {
      await Promise.all([...tails.values()].map((tail) => tail.catch(() => {})))
    },

    /**
     * Delete data files from the removed timing/focus product once at load:
     * `20*.jsonl` day files (root and `usage/`) and `limits.json`. Missing files
     * are fine; nothing here may throw.
     */
    async cleanupLegacyData() {
      const removed = []
      try {
        for (const entry of await listDir()) {
          if (entry.isDirectory) {
            if (entry.name !== 'usage') continue
            for (const inner of await listDir('usage')) {
              if (inner.isDirectory || !LEGACY_DAY_FILE.test(inner.name)) continue
              await removeFile(`usage/${inner.name}`).catch(() => {})
              removed.push(`usage/${inner.name}`)
            }
            // The empty legacy directory can go once its files are gone.
            await fs.rmdir(absolute('usage')).catch(() => {})
            continue
          }
          if (!LEGACY_DAY_FILE.test(entry.name) && !LEGACY_NAMES.has(entry.name)) continue
          await removeFile(entry.name).catch(() => {})
          removed.push(entry.name)
        }
      } catch {
        // Cleanup is best effort: a permission error must not block activation.
      }
      return removed
    },
  }
}
