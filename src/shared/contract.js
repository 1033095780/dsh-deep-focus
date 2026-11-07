/**
 * Shared wire contract (v4) between the Host half and the browser half.
 *
 * v4 is a UX pass over v3:
 * - the floating top-right widget shows two rings (today total, continuous) and
 *   clicking it enters a paused "rest" mode (no counting, window grays) that
 *   resumes only on real keyboard/mouse activity
 * - a forced rest finishes only after its time elapsed AND the user is back
 *   (activity detected), never while away
 * - the completion chime repeats every second while the window is unfocused or
 *   the user is away, until input returns
 * - the solo (one conversation at a time) mode also hides workspace/folder rows
 *   and animates; the old banner is gone
 *
 * Times are minutes unless the field name says otherwise.
 */

export const API_BASE = '/plugins/dsh-deep-focus/api'

export const ROUTES = {
  state: `${API_BASE}/state`,
  apps: `${API_BASE}/apps`,
  settings: `${API_BASE}/settings`,
  assistant: `${API_BASE}/assistant`,
  pause: `${API_BASE}/pause`,
  resume: `${API_BASE}/resume`,
  restStart: `${API_BASE}/rest/start`,
  restFinish: `${API_BASE}/rest/finish`,
  extend: `${API_BASE}/extend`,
}

/** Toast / state-change events the Host pushes through the state ring buffer. */
export const EVENT = {
  taskCompleted: 'task-completed',
  paused: 'paused',
  resumed: 'resumed',
  restDue: 'rest-due',
  restStarted: 'rest-started',
  restFinished: 'rest-finished',
  dailyLocked: 'daily-locked',
  extended: 'extended',
  assistantOff: 'assistant-off',
  assistantOn: 'assistant-on',
}

export const DEFAULT_SETTINGS = {
  version: 4,  limits: {
    dailyMinutes: 180,
    continuousMinutes: 30,
    restMinutes: 10,
    extendMinutes: 20,
    /** 0 = unlimited daily extensions; > 0 = maximum extensions per day. */
    dailyExtendLimit: 0,
  },
  assistant: {
    enabled: true,
    soloSession: true,
    hideOtherSessions: true,
    showRings: true,
    /** Record/display usage only: no limits, pause, rest, prompts or restrictions. */
    trackingOnly: false,
  },
  alerts: {
    sound: true,
    volume: 0.6,
    quietHoursStart: null,
    quietHoursEnd: null,
    /** Repeat the completion chime while the user is away (until input). */
    repeatUntilActive: true,
    repeatIntervalMs: 1000,
    /** Consider the user away when the machine has been idle this long. */
    awayIdleSeconds: 30,
  },
  usage: {
    sampleSeconds: 5,
    idleThresholdSeconds: 60,
    retentionDays: 30,
    trackApps: true,
    /** Auto-enter the paused/rest state after this many idle seconds (0 = off). */
    autoPauseSeconds: 60,
  },
}

/** Clamp a number into [min, max], falling back to `fallback` for non-numbers. */
export function clampNumber(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
