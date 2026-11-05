/**
 * Shared wire contract (v2) between the Host half and the browser half.
 *
 * v2 changed the product shape after user feedback:
 * - no tool blocking anywhere (nothing may interrupt other conversations' work)
 * - focus mode only grays the sidebar and shows a gentle toast on click
 * - usage is tracked per foreground application (dsh / browsers / QQ / ...)
 * - overtime unlock is a single click for another 20 minutes (no password)
 *
 * The browser half is one self-contained bundle (no build step), so it keeps a
 * small copy of the route/event constants — keep them in sync when changing.
 */

/** Prefix every browser -> host call uses; registered by src/host/api.js. */
export const API_BASE = '/plugins/dsh-deep-focus/api'

export const ROUTES = {
  state: `${API_BASE}/state`,
  stats: `${API_BASE}/stats`,
  apps: `${API_BASE}/apps`,
  settings: `${API_BASE}/settings`,
  focusStart: `${API_BASE}/focus/start`,
  focusPause: `${API_BASE}/focus/pause`,
  focusResume: `${API_BASE}/focus/resume`,
  focusStop: `${API_BASE}/focus/stop`,
  focusComplete: `${API_BASE}/focus/complete`,
  unlock: `${API_BASE}/unlock`,
}

/** Focus phases. `idle` means no focus block is running. */
export const PHASE = {
  idle: 'idle',
  work: 'work',
  break: 'break',
}

/** Toast / sound triggers the Host pushes through the state ring buffer. */
export const EVENT = {
  focusStarted: 'focus-started',
  focusCompleted: 'focus-completed',
  breakCompleted: 'break-completed',
  taskCompleted: 'task-completed',
  focusStopped: 'focus-stopped',
  locked: 'locked',
  unlocked: 'unlocked',
  limitWarning: 'limit-warning',
}

/** Why the app shows the overtime overlay. */
export const LOCK_REASON = {
  daily: 'daily',
  continuous: 'continuous',
  session: 'session',
  manual: 'manual',
}

/**
 * Settings shape, also the deep-merge target. All limits default to `0` (off):
 * the plugin must never lock the user out of the box.
 *
 * Times are minutes unless the field name says otherwise.
 */
export const DEFAULT_SETTINGS = {
  version: 2,
  focus: {
    workMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    longBreakEvery: 4,
    autoStartBreak: true,
    autoStartNext: false,
    idlePauseSeconds: 120,
    autoResumeOnReturn: true,
    grayOutOtherSessions: true,
  },
  limits: {
    dailyActiveMinutes: 0,
    continuousWorkMinutes: 0,
    sessionMinutes: 0,
    unlockMinutes: 20,
  },
  alerts: {
    taskDone: true,
    turnDone: false,
    sound: true,
    volume: 0.6,
    quietHoursStart: null,
    quietHoursEnd: null,
  },
  usage: {
    sampleSeconds: 5,
    idleThresholdSeconds: 60,
    retentionDays: 30,
    trackApps: true,
  },
}

/** Clamp a number into [min, max], falling back to `fallback` for non-numbers. */
export function clampNumber(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** Copy only plain objects one level deep; used by both halves' settings merge. */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-merge a stored/partial settings object over `DEFAULT_SETTINGS`.
 * Unknown keys are dropped, so a stale or hand-edited file can never leak
 * extra fields into the running plugin.
 */
export function mergeSettings(base, patch) {
  const out = {}
  for (const [section, sectionDefault] of Object.entries(base)) {
    const incoming = isPlainObject(patch) ? patch[section] : undefined
    if (isPlainObject(sectionDefault)) {
      out[section] = { ...sectionDefault }
      if (isPlainObject(incoming)) {
        for (const key of Object.keys(sectionDefault)) {
          if (key in incoming) out[section][key] = incoming[key]
        }
      }
    } else {
      out[section] = incoming === undefined ? sectionDefault : incoming
    }
  }
  return out
}
