/**
 * v4 limits state machine: daily cap, continuous-use forced rest, and a manual
 * pause mode. Both pause and forced rest stop all counting; they end on real
 * activity (idle below the usage threshold), not on a button or a timer alone.
 */
import { EVENT } from '../shared/contract.js'
import { localDayKey } from './storage.js'

export const LIMITS_FILE = 'limits.json'
/** `rest-due` fires when continuous usage reaches this share of the limit. */
export const REST_DUE_RATIO = 0.8
/** Activity before this grace window belongs to the click that started a pause. */
export const PAUSE_ACTIVITY_GRACE_MS = 1500
/** A rest whose time elapsed still finishes eventually if the user never returns. */
export const REST_ACTIVITY_WAIT_CAP_MS = 30 * 60_000

export function emptyLimitsState(dayKey) {
  return {
    dayKey,
    resting: false,
    restUntil: null,
    restStartedAt: null,
    paused: false,
    pausedAt: null,
    dailyLocked: false,
    lockedSince: null,
    extendedUntil: null,
    extendCountToday: 0,
  }
}

export function createLimits({ settings, tracker, ring, storage = null, now = Date.now } = {}) {
  let state = emptyLimitsState(localDayKey(now()))
  let writeChain = Promise.resolve()
  let restDueEmitted = false
  let lastActivityAt = null
  let lastAssistantEnabled = settings.get().assistant.enabled === true

  function persist() {
    if (storage === null) return
    writeChain = writeChain.then(() => storage.writeJson(LIMITS_FILE, state)).catch(() => {})
  }

  function minutes(value, fallback) {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback
  }

  /** Is this sample "the user is here"? Mirrors the tracker's idle threshold. */
  function sampleIsActive(sample) {
    const usage = settings.get().usage
    const thresholdSeconds = Number.isFinite(usage.idleThresholdSeconds) ? usage.idleThresholdSeconds : 60
    const idleMs = sample?.idleMs
    if (!Number.isFinite(idleMs) || idleMs < 0) return false
    return thresholdSeconds <= 0 || idleMs < thresholdSeconds * 1000
  }

  function rollDay(at) {
    const dayKey = localDayKey(at)
    if (state.dayKey === dayKey) return false
    state = {
      ...state,
      dayKey,
      dailyLocked: false,
      lockedSince: null,
      extendedUntil: null,
      extendCountToday: 0,
    }
    restDueEmitted = false
    persist()
    return true
  }

  function endRest(early, reason, extra = {}) {
    state = { ...state, resting: false, restUntil: null, restStartedAt: null }
    tracker.resetContinuous()
    ring.emit(EVENT.restFinished, { early: early === true, reason, ...extra })
    persist()
  }

  function startRest(at, reason) {
    const restMinutes = Math.max(1, minutes(settings.get().limits.restMinutes, 10))
    // A forced rest supersedes a manual pause: the rest screen is the stronger mode.
    state = {
      ...state,
      resting: true,
      restStartedAt: at,
      restUntil: at + restMinutes * 60_000,
      paused: false,
      pausedAt: null,
    }
    restDueEmitted = false
    tracker.resetContinuous()
    ring.emit(EVENT.restStarted, { minutes: restMinutes, reason })
    persist()
  }

  function resumeInternal(at, reason) {
    state = { ...state, paused: false, pausedAt: null }
    ring.emit(EVENT.resumed, { reason })
    persist()
    return getView(at)
  }

  function getView(at = now()) {
    const s = settings.get()
    const usage = tracker.snapshot(at)
    const enabled = s.assistant.enabled === true
    const dailyLimitMs = minutes(s.limits.dailyMinutes, 180) * 60_000
    const continuousLimitMs = minutes(s.limits.continuousMinutes, 30) * 60_000
    const resting = state.resting === true && state.restUntil !== null
    const restNeedsActivity = resting && at >= state.restUntil
    return {
      assistantEnabled: enabled,
      dailyLimitMs,
      dailyUsedMs: Math.round(usage.activeTodayMs),
      dailyLocked: enabled === true && state.dailyLocked === true,
      extendedUntil: state.extendedUntil,
      extendCountToday: state.extendCountToday,
      extendLimit: minutes(s.limits.dailyExtendLimit, 2),
      continuousLimitMs,
      continuousUsedMs: Math.round(usage.continuousMs),
      restDue: enabled === true && !resting && !state.paused && continuousLimitMs > 0
        && usage.continuousMs >= continuousLimitMs * REST_DUE_RATIO,
      resting,
      restUntil: resting ? state.restUntil : null,
      restRemainingMs: resting ? Math.max(0, Math.round(state.restUntil - at)) : 0,
      restNeedsActivity,
      paused: state.paused === true,
      pausedAt: state.paused === true ? state.pausedAt : null,
      pausedNeedsActivity: state.paused === true,
    }
  }

  /** Consume one sampler sample: real activity ends a pause or an elapsed rest. */
  function applySample(sample, at = now()) {
    const active = sampleIsActive(sample)
    if (active) lastActivityAt = at
    if (state.paused && state.pausedAt !== null && at >= state.pausedAt + PAUSE_ACTIVITY_GRACE_MS && active) {
      resumeInternal(at, 'activity')
    }
    if (state.resting && state.restUntil !== null && at >= state.restUntil && active) {
      endRest(false, 'elapsed-and-active')
    }
    return getView(at)
  }

  /** One evaluation tick: finish an elapsed rest (or the activity wait cap), then enforce. */
  function evaluate(at = now()) {
    rollDay(at)
    const s = settings.get()
    const enabled = s.assistant.enabled === true
    const usage = tracker.snapshot(at)
    let changed = false

    if (state.resting) {
      if (state.restUntil === null) {
        endRest(false, 'elapsed-and-active')
      } else if (at >= state.restUntil) {
        const capped = at > state.restUntil + REST_ACTIVITY_WAIT_CAP_MS
        const cameBack = lastActivityAt !== null && lastActivityAt >= state.restUntil
        if (capped) endRest(false, 'elapsed-and-active', { capped: true })
        else if (cameBack) endRest(false, 'elapsed-and-active')
      }
    }

    if (!enabled) {
      if (state.resting) endRest(true, 'assistant-off')
      if (state.paused) state = { ...state, paused: false, pausedAt: null }
      if (state.dailyLocked || state.lockedSince !== null) {
        state = { ...state, dailyLocked: false, lockedSince: null }
        changed = true
      }
      restDueEmitted = false
      if (changed) persist()
      return getView(at)
    }

    // The daily cap is evaluated first so a lock never stacks a forced rest on top.
    if (!state.resting && !state.paused) {
      const dailyLimitMs = minutes(s.limits.dailyMinutes, 180) * 60_000
      const over = dailyLimitMs > 0 && usage.activeTodayMs >= dailyLimitMs
      const grace = state.extendedUntil !== null && at < state.extendedUntil
      if (over && !grace) {
        if (state.dailyLocked !== true) {
          state = { ...state, dailyLocked: true, lockedSince: state.lockedSince ?? at, extendedUntil: null }
          ring.emit(EVENT.dailyLocked, {
            dailyUsedMs: Math.round(usage.activeTodayMs),
            limitMs: dailyLimitMs,
          })
          changed = true
        }
      } else if (state.dailyLocked) {
        state = { ...state, dailyLocked: false, lockedSince: null }
        changed = true
      }
    }

    const continuousLimitMs = minutes(s.limits.continuousMinutes, 30) * 60_000
    if (!state.resting && !state.dailyLocked && !state.paused) {
      if (continuousLimitMs > 0 && usage.continuousMs >= continuousLimitMs) {
        startRest(at, 'continuous')
      } else if (continuousLimitMs > 0 && usage.continuousMs >= continuousLimitMs * REST_DUE_RATIO) {
        if (!restDueEmitted) {
          restDueEmitted = true
          ring.emit(EVENT.restDue, { remainingMs: Math.max(0, Math.round(continuousLimitMs - usage.continuousMs)) })
        }
      } else {
        restDueEmitted = false
      }
    }

    if (changed) persist()
    return getView(at)
  }

  return {
    get: () => state,
    getView,
    evaluate,
    applySample,
    /** True while a rest window (including the waiting-for-activity tail) is running. */
    isResting() {
      return state.resting === true
    },
    isPaused() {
      return state.paused === true
    },

    /** Manual pause: counting stops immediately and resumes only on real activity. */
    pause(at = now()) {
      if (settings.get().assistant.enabled !== true) return { ok: false, code: 'assistant-off' }
      if (state.resting) return { ok: false, code: 'already-resting' }
      if (state.paused) return { ok: false, code: 'already-paused' }
      state = { ...state, paused: true, pausedAt: at }
      lastActivityAt = null
      ring.emit(EVENT.paused, { at })
      persist()
      return { ok: true, view: getView(at) }
    },

    /** Force a resume (the UI's immediate exit from pause). */
    resume(at = now()) {
      if (!state.paused) return { ok: false, code: 'not-paused' }
      return { ok: true, view: resumeInternal(at, 'manual') }
    },

    async load() {
      const document = await storage?.readJson(LIMITS_FILE, null)
      const at = now()
      const dayKey = localDayKey(at)
      if (document === null || document === undefined || typeof document !== 'object') {
        state = emptyLimitsState(dayKey)
        lastAssistantEnabled = settings.get().assistant.enabled === true
        return state
      }
      const restUntil = Number.isFinite(document.restUntil) ? document.restUntil : null
      // A restored rest keeps waiting for activity up to the 30-minute cap.
      const resting = document.resting === true && restUntil !== null
        && at <= restUntil + REST_ACTIVITY_WAIT_CAP_MS
      const paused = document.paused === true && Number.isFinite(document.pausedAt)
      state = {
        dayKey,
        resting,
        restUntil: resting ? restUntil : null,
        restStartedAt: resting && Number.isFinite(document.restStartedAt) ? document.restStartedAt : null,
        paused,
        pausedAt: paused ? document.pausedAt : null,
        dailyLocked: document.dailyLocked === true,
        lockedSince: Number.isFinite(document.lockedSince) ? document.lockedSince : null,
        extendedUntil: Number.isFinite(document.extendedUntil) ? document.extendedUntil : null,
        extendCountToday: Number.isFinite(document.extendCountToday)
          ? Math.max(0, Math.round(document.extendCountToday))
          : 0,
      }
      if (document.dayKey !== dayKey) {
        state = { ...state, dailyLocked: false, lockedSince: null, extendedUntil: null, extendCountToday: 0 }
      }
      lastActivityAt = null
      lastAssistantEnabled = settings.get().assistant.enabled === true
      return state
    },

    /** Manual "start rest now": 409 already-resting / assistant-off. */
    startRest(at = now()) {
      const enabled = settings.get().assistant.enabled === true
      if (!enabled) return { ok: false, code: 'assistant-off' }
      if (state.resting) return { ok: false, code: 'already-resting' }
      startRest(at, 'manual')
      return { ok: true, view: getView(at) }
    },

    /** Skip the running rest (the UI's button); continuous quota is already reset. */
    finishRest(at = now()) {
      if (!state.resting) return { ok: false, code: 'not-resting' }
      endRest(true, 'skipped')
      return { ok: true, view: getView(at) }
    },

    /** Grant another `extendMinutes` of DSH time after the daily cap. */
    extend(at = now()) {
      const s = settings.get()
      if (s.assistant.enabled !== true) return { ok: false, code: 'not-locked' }
      if (state.dailyLocked !== true) {
        evaluate(at)
        if (state.dailyLocked !== true) return { ok: false, code: 'not-locked' }
      }
      const extendLimit = minutes(s.limits.dailyExtendLimit, 2)
      if (extendLimit <= 0 || state.extendCountToday >= extendLimit) {
        return { ok: false, code: 'extend-limit-reached' }
      }
      const extendMinutes = Math.max(1, minutes(s.limits.extendMinutes, 20))
      state = {
        ...state,
        extendedUntil: at + extendMinutes * 60_000,
        extendCountToday: state.extendCountToday + 1,
        dailyLocked: false,
        lockedSince: null,
      }
      ring.emit(EVENT.extended, {
        minutes: extendMinutes,
        extendCountToday: state.extendCountToday,
        extendLimit,
      })
      persist()
      return { ok: true, view: getView(at) }
    },

    /** React to the assistant switch (called after the settings store changed). */
    setAssistantEnabled(enabled, at = now()) {
      const next = enabled === true
      if (next === lastAssistantEnabled) return getView(at)
      lastAssistantEnabled = next
      if (!next) {
        if (state.resting) endRest(true, 'assistant-off')
        state = { ...state, dailyLocked: false, lockedSince: null, paused: false, pausedAt: null }
        restDueEmitted = false
        persist()
        ring.emit(EVENT.assistantOff, {})
      } else {
        ring.emit(EVENT.assistantOn, {})
        evaluate(at)
      }
      return getView(at)
    },

    flush() {
      return writeChain
    },
  }
}
