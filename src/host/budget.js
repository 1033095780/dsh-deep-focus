/**
 * Budget evaluation v2: daily active / continuous work / single-focus caps.
 * Limits default to 0 (off); an unlock is one click for `limits.unlockMinutes`
 * (or `{mode:'rest'}`, which additionally ends the continuous-work run).
 */
import { EVENT, LOCK_REASON } from '../shared/contract.js'
import { localDayKey } from './storage.js'

export const BUDGET_FILE = 'budget.json'
const WARN_RATIO = 0.8

export function emptyBudgetState(dayKey) {
  return {
    dayKey,
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
  // Whether the previous evaluation observed an active grace window; the expiry
  // transition (and its single "locked" event) must survive a sparse evaluation
  // cadence, so it cannot be derived from the current clock alone.
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

  function getView(at = now()) {
    const grace = inGrace(at)
    const locked = state.reason !== null && !grace
    return {
      locked,
      reason: state.reason,
      since: state.since,
      unlockUntil: state.unlockUntil,
      unlockMinutes: Math.max(1, Math.round(settings.get().limits.unlockMinutes)),
      canUnlock: locked,
      strict: false,
    }
  }

  function grant(at, mode) {
    const s = settings.get()
    const minutes = Math.max(1, Math.round(s.limits.unlockMinutes))
    state = { ...state, unlockUntil: at + minutes * 60_000 }
    graceObserved = true
    onStat({ kind: 'unlock', mode })
    ring.emit(EVENT.unlocked, { mode, minutes })
    persist()
  }

  function warnThreshold(counterMs, limitMinutes, warnedFlag, kind) {
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
        graceObserved = false
        return state
      }
      const restored = {
        dayKey,
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
      if (warnThreshold(usage.activeTodayMs, s.limits.dailyActiveMinutes, 'warnedDaily', LOCK_REASON.daily)) changed = true
      if (warnThreshold(usage.continuousMs, s.limits.continuousWorkMinutes, 'warnedContinuous', LOCK_REASON.continuous)) changed = true
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

    /** One click for another `unlockMinutes`; `mode:'rest'` also ends the continuous run. */
    unlock({ mode = 'click' } = {}) {
      const at = now()
      if (!getView(at).locked) return { ok: false, code: 'not-locked' }
      const rest = mode === 'rest'
      if (rest) tracker.resetContinuous()
      grant(at, rest ? 'rest' : 'click')
      return { ok: true, view: getView(at) }
    },

    flush() {
      return writeChain
    },
  }
}
