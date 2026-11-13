/**
 * dsh-deep-focus — wire contract v5 (v1 product).
 *
 * The product is now a single feature: a conversation task lock plus an optional
 * DingTalk completion notification.
 *
 * - When the user sends a message in a conversation, the plugin locks the UI
 *   (full-screen overlay, other conversations unusable) for that conversation.
 * - The lock is released automatically once that conversation *and all of its
 *   subagent/child sessions* are completely finished. A `[+] ...` DingTalk text
 *   message is sent on release (when configured).
 * - The user may click "skip" on the lock overlay to release immediately.
 *
 * Everything from the old timing/focus product (usage sampling, daily and
 * continuous limits, rest, pause, tracking-only mode, rings, chime, solo graying,
 * dashboard statistics) is intentionally removed.
 */

export const CONTRACT_VERSION = 5
export const SETTINGS_VERSION = CONTRACT_VERSION

export const DINGTALK_PREFIX = '[+] '
export const DINGTALK_WEBHOOK = 'https://oapi.dingtalk.com/robot/send?access_token='
export const DINGTALK_TIMEOUT_MS = 3000
export const DINGTALK_RETRY = 2

/** Lock is released only after the root turn closed and children stayed idle this long. */
export const LOCK_SETTLE_MS = 1200
/** Safety reconcile cadence while a lock is active (host side, event-driven otherwise). */
export const LOCK_RECONCILE_MS = 1500

/** Prefix the Host registers; browser clients call `API_BASE + ROUTES.*`. */
export const API_BASE = '/plugins/dsh-deep-focus/api'

export const ROUTES = {
  state: '/state',
  settings: '/settings',
  skip: '/lock/skip',
  testNotify: '/notifications/test',
}

export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  notifications: {
    dingtalkEnabled: false,
    dingtalkToken: '',
  },
}

function clampString(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

/** Merge arbitrary persisted/user input into a valid settings object. */
export function mergeSettings(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const notifications = raw.notifications && typeof raw.notifications === 'object' ? raw.notifications : {}
  return {
    version: SETTINGS_VERSION,
    notifications: {
      dingtalkEnabled: notifications.dingtalkEnabled === true,
      dingtalkToken: clampString(notifications.dingtalkToken, 256).trim(),
    },
  }
}

/**
 * Settings safe to send to the browser: the token is never echoed, only a
 * "is it set" flag and a short hint are exposed.
 */
export function publicSettings(settings) {
  const normalized = mergeSettings(settings)
  const token = normalized.notifications.dingtalkToken
  return {
    version: normalized.version,
    notifications: {
      dingtalkEnabled: normalized.notifications.dingtalkEnabled,
      dingtalkTokenSet: token.length > 0,
      dingtalkTokenHint: token.length >= 4 ? token.slice(-4) : '',
    },
  }
}

/**
 * Apply a browser settings patch.
 * - `dingtalkToken` omitted or '' keeps the stored token;
 * - `dingtalkToken: null` clears it.
 */
export function applySettingsPatch(current, patch) {
  const base = mergeSettings(current)
  const raw = patch && typeof patch === 'object' ? patch : {}
  const notifications = raw.notifications && typeof raw.notifications === 'object' ? raw.notifications : {}
  const next = {
    version: SETTINGS_VERSION,
    notifications: {
      dingtalkEnabled:
        typeof notifications.dingtalkEnabled === 'boolean'
          ? notifications.dingtalkEnabled
          : base.notifications.dingtalkEnabled,
      dingtalkToken: base.notifications.dingtalkToken,
    },
  }
  if (Object.prototype.hasOwnProperty.call(notifications, 'dingtalkToken')) {
    if (notifications.dingtalkToken === null) {
      next.notifications.dingtalkToken = ''
    } else if (typeof notifications.dingtalkToken === 'string' && notifications.dingtalkToken.trim().length > 0) {
      next.notifications.dingtalkToken = notifications.dingtalkToken.trim().slice(0, 256)
    }
  }
  return next
}

/** DingTalk text message for a released lock. Only `[+]` messages are ever sent. */
export function buildCompletionMessage({ title, minutes, finishedAt }) {
  const safeTitle = typeof title === 'string' && title.trim().length > 0 ? title.trim().slice(0, 80) : '对话'
  const safeMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.max(1, Math.round(minutes)) : 0
  const time = finishedAt instanceof Date ? finishedAt : new Date()
  const hh = String(time.getHours()).padStart(2, '0')
  const mm = String(time.getMinutes()).padStart(2, '0')
  const used = safeMinutes > 0 ? `，用时 ${safeMinutes} 分钟` : ''
  return `${DINGTALK_PREFIX}会话已完成：${safeTitle}${used}，完成时间 ${hh}:${mm}`
}

export function buildTestMessage(finishedAt) {
  const time = finishedAt instanceof Date ? finishedAt : new Date()
  const hh = String(time.getHours()).padStart(2, '0')
  const mm = String(time.getMinutes()).padStart(2, '0')
  return `${DINGTALK_PREFIX}钉钉通知测试成功（${hh}:${mm}）`
}
