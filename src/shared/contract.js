/**
 * Shared wire contract (v3) between the Host half and the browser half.
 *
 * v3 product shape (agreed with the user):
 * - default "one conversation at a time": while a root conversation's agent is
 *   running, the UI hides the other workspaces/sessions until it finishes
 * - no pomodoro timer anymore
 * - daily whole-machine usage cap (default 3h) and continuous-use cap
 *   (default 30min) that forces a rest (default 10min)
 * - overtime: DSH-only gray overlay with today's per-app breakdown and a small
 *   "use 20 more minutes" action
 * - a "Focus assistant" hub panel: usage stats + settings + on/off
 * - pure plugin: it never blocks tools and only enforces inside DSH
 *
 * The browser half is one self-contained bundle (no build step), so it keeps a
 * small copy of the route/event constants — keep them in sync.
 */

export const API_BASE = '/plugins/dsh-deep-focus/api'

export const ROUTES = {
  state: `${API_BASE}/state`,
  apps: `${API_BASE}/apps`,
  settings: `${API_BASE}/settings`,
  assistant: `${API_BASE}/assistant`,
  restStart: `${API_BASE}/rest/start`,
  restFinish: `${API_BASE}/rest/finish`,
  extend: `${API_BASE}/extend`,
}

/** Toast / state-change events the Host pushes through the state ring buffer. */
export const EVENT = {
  taskCompleted: 'task-completed',
  restDue: 'rest-due',
  restStarted: 'rest-started',
  restFinished: 'rest-finished',
  dailyLocked: 'daily-locked',
  extended: 'extended',
  assistantOff: 'assistant-off',
  assistantOn: 'assistant-on',
}

/**
 * Settings shape (also the deep-merge target). Every limit has a working,
 * non-zero default: the user asked for 3h/day, 30min continuous, 10min rest.
 * Times are minutes unless the field name says otherwise.
 */
export const DEFAULT_SETTINGS = {
  version: 3,
  limits: {
    dailyMinutes: 180,
    continuousMinutes: 30,
    restMinutes: 10,
    extendMinutes: 20,
    dailyExtendLimit: 2,
  },
  assistant: {
    enabled: true,
    soloSession: true,
    hideOtherSessions: true,
    showCountdown: true,
  },
  alerts: {
    sound: true,
    volume: 0.6,
    quietHoursStart: null,
    quietHoursEnd: null,
    taskDone: true,
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

/** Whether a plain object; used by both halves' settings merge. */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-merge a stored/partial settings object over `DEFAULT_SETTINGS`.
 * Unknown keys are dropped; a stale v1/v2 file can never leak extra fields.
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
