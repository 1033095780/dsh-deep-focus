/** Runtime settings: deep merge + clamping against the shared contract, and scrypt password storage. */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { DEFAULT_SETTINGS, isPlainObject, mergeSettings } from '../shared/contract.js'

export const SETTINGS_FILE = 'settings.json'
export const MIN_PASSWORD_LENGTH = 6
export const MAX_PASSWORD_LENGTH = 256

const SCRYPT_KEYLEN = 64
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1 }

/** Inclusive integer ranges; anything outside is clamped, non-numbers fall back to the default. */
const NUMBER_RULES = {
  'focus.workMinutes': [1, 180],
  'focus.breakMinutes': [1, 60],
  'focus.longBreakMinutes': [1, 60],
  'focus.longBreakEvery': [0, 12],
  'focus.idlePauseSeconds': [0, 3_600],
  'limits.dailyActiveMinutes': [0, 1_440],
  'limits.continuousWorkMinutes': [0, 1_440],
  'limits.sessionMinutes': [0, 1_440],
  'limits.unlockMinutes': [1, 120],
  'limits.dailyUnlockLimit': [0, 10],
  'usage.sampleSeconds': [3, 30],
  'usage.idleThresholdSeconds': [0, 3_600],
  'usage.retentionDays': [1, 365],
}

const BOOLEAN_FIELDS = [
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

function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function clampFloat(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/** `HH:MM` in 24h form, or null for "no quiet hours". */
function quietHourOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return null
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
  return match === null ? null : `${match[1]}:${match[2]}`
}

/** Base64 strings only; anything else means "no password stored". */
function base64OrNull(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null
}

function resolvePath(object, path) {
  let cursor = object
  for (const part of path.split('.')) {
    if (!isPlainObject(cursor)) return undefined
    cursor = cursor[part]
  }
  return cursor
}

function assignPath(object, path, value) {
  const parts = path.split('.')
  let cursor = object
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) cursor[part] = {}
    cursor = cursor[part]
  }
  cursor[parts[parts.length - 1]] = value
}

/**
 * Coerce a stored or partially supplied settings object into the trusted shape:
 * unknown keys are dropped and every number/boolean is clamped or defaulted.
 */
export function normalizeSettings(raw) {
  const merged = mergeSettings(DEFAULT_SETTINGS, isPlainObject(raw) ? raw : {})
  const out = {}
  for (const [section, sectionDefault] of Object.entries(DEFAULT_SETTINGS)) {
    out[section] = isPlainObject(sectionDefault) ? { ...sectionDefault } : sectionDefault
  }
  for (const [path, [min, max]] of Object.entries(NUMBER_RULES)) {
    const fallback = resolvePath(DEFAULT_SETTINGS, path)
    assignPath(out, path, clampInt(resolvePath(merged, path), min, max, fallback))
  }
  for (const path of BOOLEAN_FIELDS) {
    assignPath(out, path, boolOr(resolvePath(merged, path), resolvePath(DEFAULT_SETTINGS, path)))
  }
  out.alerts.volume = clampFloat(resolvePath(merged, 'alerts.volume'), 0, 1, DEFAULT_SETTINGS.alerts.volume)
  out.alerts.quietHoursStart = quietHourOrNull(resolvePath(merged, 'alerts.quietHoursStart'))
  out.alerts.quietHoursEnd = quietHourOrNull(resolvePath(merged, 'alerts.quietHoursEnd'))
  const hash = base64OrNull(resolvePath(merged, 'security.passwordHash'))
  const salt = base64OrNull(resolvePath(merged, 'security.passwordSalt'))
  out.security = hash !== null && salt !== null
    ? { passwordHash: hash, passwordSalt: salt }
    : { passwordHash: null, passwordSalt: null }
  return out
}

/** Settings safe to expose over the wire: the password hash/salt never leave the Host. */
export function publicSettings(settings) {
  const out = {}
  for (const [section, value] of Object.entries(settings)) {
    if (section === 'security') continue
    out[section] = isPlainObject(value) ? { ...value } : value
  }
  return out
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length === 0) return 'password-missing'
  if (password.length < MIN_PASSWORD_LENGTH) return 'password-too-short'
  if (password.length > MAX_PASSWORD_LENGTH) return 'password-too-long'
  return null
}

/** scrypt salt + hash, both base64; the plaintext is never persisted. */
export function hashPassword(password) {
  return new Promise((resolvePromise, rejectPromise) => {
    const salt = randomBytes(16)
    scryptCallback(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (error, key) => {
      if (error) rejectPromise(error)
      else resolvePromise({ salt: salt.toString('base64'), hash: key.toString('base64') })
    })
  })
}

export function verifyPasswordHash(password, saltBase64, hashBase64) {
  return new Promise((resolvePromise) => {
    let expected
    let salt
    try {
      expected = Buffer.from(hashBase64, 'base64')
      salt = Buffer.from(saltBase64, 'base64')
    } catch {
      resolvePromise(false)
      return
    }
    if (expected.length === 0 || salt.length === 0) {
      resolvePromise(false)
      return
    }
    scryptCallback(password, salt, expected.length, SCRYPT_OPTIONS, (error, key) => {
      if (error) {
        resolvePromise(false)
        return
      }
      resolvePromise(key.length === expected.length && timingSafeEqual(key, expected))
    })
  })
}

/**
 * Settings store: the in-memory merged settings plus serialized persistence.
 * `get()` includes the password hash (Host use only); `getPublic()` never does.
 */
export function createSettingsStore({ storage = null } = {}) {
  let current = normalizeSettings(undefined)
  let loaded = false

  async function persist() {
    if (storage !== null) await storage.writeJson(SETTINGS_FILE, current, { mode: 0o600 })
  }

  return {
    get: () => current,
    getPublic: () => publicSettings(current),
    hasPassword: () => current.security.passwordHash !== null && current.security.passwordSalt !== null,
    isLoaded: () => loaded,
    async load() {
      const raw = await storage?.readJson(SETTINGS_FILE, null)
      if (raw !== null && raw !== undefined) current = normalizeSettings(raw)
      loaded = true
      return current
    },
    /** Replace settings with a merged + clamped version of `partial`; security only changes via setPassword. */
    async update(partial) {
      const patch = isPlainObject(partial) ? { ...partial } : {}
      delete patch.security
      current = normalizeSettings(mergeSettings(current, patch))
      await persist()
      return current
    },
    async setPassword(password) {
      const { salt, hash } = await hashPassword(password)
      current = normalizeSettings({ ...current, security: { passwordHash: hash, passwordSalt: salt } })
      await persist()
      return true
    },
    async clearPassword() {
      current = normalizeSettings({ ...current, security: { passwordHash: null, passwordSalt: null } })
      await persist()
      return true
    },
    async verifyPassword(password) {
      if (!this.hasPassword()) return false
      return verifyPasswordHash(password, current.security.passwordSalt, current.security.passwordHash)
    },
  }
}
