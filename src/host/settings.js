/** Runtime settings v4: deep merge + clamping against the shared contract; no secrets, no focus section. */
import { DEFAULT_SETTINGS, isPlainObject, mergeSettings } from '../shared/contract.js'

const SETTINGS_FILE = 'settings.json'

/** Inclusive integer ranges; anything outside is clamped, non-numbers fall back to the default. */
const NUMBER_RULES = {
  'limits.dailyMinutes': [0, 1_440],
  'limits.continuousMinutes': [0, 600],
  'limits.restMinutes': [1, 60],
  'limits.extendMinutes': [1, 120],
  // 0 = unlimited extensions per day.
  'limits.dailyExtendLimit': [0, 999],
  'alerts.repeatIntervalMs': [500, 10_000],
  'alerts.awayIdleSeconds': [10, 3_600],
  'usage.sampleSeconds': [3, 30],
  'usage.idleThresholdSeconds': [0, 3_600],
  // 0 = never auto-pause.
  'usage.autoPauseSeconds': [0, 3_600],
  'usage.retentionDays': [1, 365],
}

const BOOLEAN_FIELDS = [
  'assistant.enabled',
  'assistant.soloSession',
  'assistant.hideOtherSessions',
  'assistant.showRings',
  'assistant.trackingOnly',
  'alerts.sound',
  'alerts.repeatUntilActive',
  'usage.trackApps',
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
 * unknown sections/keys are dropped and every number/boolean is clamped or defaulted.
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
  return out
}

/** Settings as they travel over the wire (nothing to redact, so this is a copy). */
export function publicSettings(settings) {
  const out = {}
  for (const [section, value] of Object.entries(settings)) {
    out[section] = isPlainObject(value) ? { ...value } : value
  }
  return out
}

/** Settings store: the in-memory merged settings plus serialized persistence. */
export function createSettingsStore({ storage = null } = {}) {
  let current = normalizeSettings(undefined)

  async function persist() {
    if (storage !== null) await storage.writeJson(SETTINGS_FILE, current)
  }

  return {
    get: () => current,
    getPublic: () => publicSettings(current),
    async load() {
      const raw = await storage?.readJson(SETTINGS_FILE, null)
      // v4 is a breaking settings shape (renames and new alert fields): a file
      // written by any earlier version is discarded, never migrated, so a stale
      // value cannot silently re-enable a rule the user never chose.
      const isCurrent = raw !== null && raw !== undefined && raw.version === DEFAULT_SETTINGS.version
      current = normalizeSettings(isCurrent ? raw : undefined)
      return current
    },
    /** Replace settings with a merged + clamped version of `partial`; unknown keys vanish. */
    async update(partial) {
      current = normalizeSettings(mergeSettings(current, isPlainObject(partial) ? partial : {}))
      await persist()
      return current
    },
  }
}
