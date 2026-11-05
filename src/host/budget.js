/**
 * Budget evaluation and lock state: daily active, continuous work and single-focus caps.
 * An unlock (password or rest) grants a grace window instead of lowering the counters.
 */
import { EVENT, LOCK_REASON } from '../shared/contract.js'
import { localDayKey } from './storage.js'

export const BUDGET_FILE = 'budget.json'
const WARN_RATIO = 0.8

export function emptyBudgetState(dayKey) {
  return {
    dayKey,
    unlockCountToday: 0,
    reason: null,
    since: null,
    unlockUntil: null,
    warnedDaily: false,
    warnedContinuous: false,
  }
}

/** First limit that is over budget, or null. `0` disables a limit. */
export function limitReason({ limits, usage, focus }) {
  if (!limits) return null
  if (limits.dailyActiveMinutes > 0 && usage.activeTodayMs >= limits.dailyActiveMinutes * 60_000) return LOCK_REASON.daily
  if (limits.continuousWorkMinutes > 0 && usage.continuousMs >= limits.continuousWorkMinutes * 60_000) return LOCK_REASON.continuous
  if (limits.sessionMinutes > 0 && focus.phase === 'work' && focus.elapsedMs >= limits.sessionMinutes * 60_000) return LOCK_REASON.session
  return null
}

const noop = () => {}

export function createBudget({ settings, tracker, focus, ring, storage = null, now = Date.now, onStat = noop } = {}) {
  let state = emptyBudgetState(localDayKey(now()))
  let writeChain = Promise.resolve()
  // Whether the previous evaluation observed an active grace window; the
  // expiry transition (and its single "locked" event) must survive a sparse
  // evaluation cadence, so it cannot be derived from the current clock alone.
  let graceObserved = false

  function persist() {
    if (storage === null) return
    writeChain = writeChain.then(() => storage.writeJson(BUDGET_FILE, state)).catch(() => {})
  }

  function rollDay(at) {
    const dayKey = localDayKey(at)
    if (state.dayKey === dayKey) return
    state = emptyBudgetState(dayKey)
    persist()
  }

  function inGrace(at) {
    return state.unlockUntil !== null && at < state.unlockUntil
  }

  function canUnlock(at) {
    if (state.reason === null || inGrace(at)) return false
    const s = settings.get()
    if (s.limits.strictNoUnlock) return false
    if (!settings.hasPassword()) return false
    const limit = s.limits.dailyUnlockLimit
    return limit <= 0 || state.unlockCountToday < limit
  }

  function getView(at = now()) {
    const grace = inGrace(at)
    return {
      locked: state.reason !== null && !grace,
      reason: state.reason,
      since: state.since,
      unlockUntil: state.unlockUntil,
      unlockCountToday: state.unlockCountToday,
      canUnlock: canUnlock(at),
      strict: settings.get().limits.strictNoUnlock === true,
    }
  }

  function grant(at, mode) {
    const s = settings.get()
    const minutes = Math.max(1, Math.round(s.limits.unlockMinutes))
    state = { ...state, unlockUntil: at + minutes * 60_000 }
    graceObserved = true
    if (mode === 'password') state.unlockCountToday += 1
    onStat({ kind: 'unlock', mode })
    ring.emit(EVENT.unlocked, { mode, minutes })
    persist()
  }

  function warnThreshold(counterMs, limitMinutes, warnedFlag, kind, at) {
    if (state[warnedFlag] || limitMinutes <= 0) return false
    const limitMs = limitMinutes * 60_000
    if (counterMs < limitMs * WARN_RATIO) return false
    state = { ...state, [warnedFlag]: true }
    ring.emit(EVENT.limitWarning, { kind, remainingMs: Math.max(0, limitMs - counterMs) })
    return true
  }

  return {
    get: () => state,
    getView,

    async load() {
      const document = await storage?.readJson(BUDGET_FILE, null)
      const dayKey = localDayKey(now())
      if (document === null || document === undefined || typeof document !== 'object') {
        state = emptyBudgetState(dayKey)
        return state
      }
      const restored = {
        dayKey,
        unlockCountToday: Number.isFinite(document.unlockCountToday) ? Math.max(0, Math.round(document.unlockCountToday)) : 0,
        reason: Object.values(LOCK_REASON).includes(document.reason) ? document.reason : null,
        since: Number.isFinite(document.since) ? document.since : null,
        unlockUntil: Number.isFinite(document.unlockUntil) ? document.unlockUntil : null,
        warnedDaily: document.warnedDaily === true,
        warnedContinuous: document.warnedContinuous === true,
      }
      state = document.dayKey === dayKey ? restored : emptyBudgetState(dayKey)
      graceObserved = inGrace(now())
      return state
    },

    /** Recompute the lock; returns the current lock view. */
    evaluate(at = now()) {
      rollDay(at)
      const s = settings.get()
      const usage = tracker.snapshot(at)
      const focusView = focus.getView(at)
      const reason = limitReason({ limits: s.limits, usage, focus: focusView })
      const wasInGrace = graceObserved
      let changed = false
      if (warnThreshold(usage.activeTodayMs, s.limits.dailyActiveMinutes, 'warnedDaily', LOCK_REASON.daily, at)) changed = true
      if (warnThreshold(usage.continuousMs, s.limits.continuousWorkMinutes, 'warnedContinuous', LOCK_REASON.continuous, at)) changed = true
      if (reason !== null) {
        if (state.reason === null) {
          state = { ...state, reason, since: at, unlockUntil: null }
          ring.emit(EVENT.locked, { reason })
          changed = true
        } else if (state.reason !== reason) {
          state = { ...state, reason }
          changed = true
        }
      } else if (state.reason !== null) {
        state = { ...state, reason: null, since: null, unlockUntil: null }
        changed = true
      }
      if (state.warnedContinuous && usage.continuousMs < s.limits.continuousWorkMinutes * 60_000 * WARN_RATIO) {
        state = { ...state, warnedContinuous: false }
        changed = true
      }
      if (changed) persist()
      graceObserved = inGrace(at)
      // A grace window that just expired re-locks the app: announce it once.
      if (wasInGrace && !graceObserved && state.reason !== null) ring.emit(EVENT.locked, { reason: state.reason })
      return getView(at)
    },

    /** Password unlock: grants `unlockMinutes`, counted against the daily limit. */
    async unlock({ password } = {}) {
      const at = now()
      const view = getView(at)
      if (!view.locked) return { ok: false, code: 'not-locked' }
      const s = settings.get()
      if (s.limits.strictNoUnlock) return { ok: false, code: 'strict' }
      if (!settings.hasPassword()) return { ok: false, code: 'no-password' }
      if (typeof password !== 'string' || password.length === 0) return { ok: false, code: 'missing-password' }
      const limit = s.limits.dailyUnlockLimit
      if (limit > 0 && state.unlockCountToday >= limit) return { ok: false, code: 'limit-reached' }
      const valid = await settings.verifyPassword(password)
      if (!valid) return { ok: false, code: 'bad-password' }
      grant(at, 'password')
      return { ok: true, view: getView(at) }
    },

    /** "Rest" escape: clears the continuous-work run and grants the grace window in every mode. */
    restUnlock() {
      const at = now()
      if (!getView(at).locked) return { ok: false, code: 'not-locked' }
      tracker.resetContinuous()
      grant(at, 'rest')
      return { ok: true, view: getView(at) }
    },

    flush() {
      return writeChain
    },
  }
}
