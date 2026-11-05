/** Whole-machine activity tracking: idle samples become active time, per-day buckets and a continuous-work counter. */
import { localDayKey } from './storage.js'

const FLUSH_INTERVAL_MS = 10_000

/** Fresh counter state for one calendar day. */
export function emptyTrackerState(dayKey) {
  return { dayKey, activeMs: 0, continuousMs: 0, lastTickAt: null }
}

/**
 * Fold one idle sample into the counters.
 * Elapsed time only counts while the previous sample said "active", so a sleep
 * or sampler gap never inflates usage; a gap also ends the continuous-work run.
 */
export function applySample(state, sample, config) {
  const dayKeyOf = config.dayKeyOf ?? localDayKey
  const next = { ...state }
  let deltaMs = 0
  let resetContinuous = false
  const dayKey = dayKeyOf(sample.now)
  if (next.dayKey !== dayKey) {
    next.dayKey = dayKey
    next.activeMs = 0
    next.continuousMs = 0
    next.lastTickAt = null
  }
  const gap = next.lastTickAt === null ? 0 : sample.now - next.lastTickAt
  const gapValid = Number.isFinite(gap) && gap >= 0 && gap <= config.maxGapMs
  const idleValid = Number.isFinite(sample.idleMs) && sample.idleMs >= 0
  const active = idleValid && (config.idleThresholdMs <= 0 || sample.idleMs < config.idleThresholdMs)
  if (!gapValid) {
    resetContinuous = next.continuousMs > 0
    next.continuousMs = 0
  } else if (active) {
    deltaMs = gap
    next.activeMs += gap
    next.continuousMs += gap
  } else if (next.continuousMs > 0) {
    resetContinuous = true
    next.continuousMs = 0
  }
  next.lastTickAt = sample.now
  return { state: next, deltaMs, active, resetContinuous }
}

/**
 * Tracker facade: keeps the counters hot and flushes usage deltas to
 * `usage/YYYY-MM-DD.jsonl` in batches so a 5s sampler never writes per sample.
 */
export function createTracker({ storage = null, settings = null, now = Date.now } = {}) {
  let state = emptyTrackerState(localDayKey(now()))
  let pendingMs = 0
  let pendingSince = null
  let lastActive = false
  let flushChain = Promise.resolve()

  function config() {
    const usage = settings?.get?.().usage ?? {}
    const sampleSeconds = Number.isFinite(usage.sampleSeconds) ? usage.sampleSeconds : 5
    const idleThresholdSeconds = Number.isFinite(usage.idleThresholdSeconds) ? usage.idleThresholdSeconds : 60
    return {
      idleThresholdMs: idleThresholdSeconds * 1000,
      maxGapMs: Math.max(10_000, sampleSeconds * 4000),
    }
  }

  function rollDay(at) {
    const dayKey = localDayKey(at)
    if (state.dayKey === dayKey) return false
    const previousDay = state.dayKey
    const carried = pendingMs
    pendingMs = 0
    pendingSince = null
    if (carried > 0 && storage !== null) {
      flushChain = flushChain
        .then(() => storage.appendJsonl(`usage/${previousDay}.jsonl`, { t: at, day: previousDay, ms: carried }))
        .catch(() => {})
    }
    state = { ...state, dayKey, activeMs: 0, continuousMs: 0, lastTickAt: null }
    return true
  }

  function flush() {
    rollDay(now())
    if (pendingMs <= 0 || storage === null) {
      pendingMs = 0
      pendingSince = null
      return flushChain
    }
    const record = { t: now(), day: state.dayKey, ms: pendingMs }
    pendingMs = 0
    pendingSince = null
    flushChain = flushChain
      .then(() => storage.appendJsonl(`usage/${state.dayKey}.jsonl`, record))
      .catch(() => {})
    return flushChain
  }

  return {
    /** Load today's accumulated active time; call once before sampling starts. */
    async load() {
      rollDay(now())
      if (storage === null) return state
      const activeMs = await storage.readUsageMs(state.dayKey)
      state = { ...state, activeMs, continuousMs: 0, lastTickAt: null }
      return state
    },

    /** Consume one idle sample; returns what the other host modules need this tick. */
    sample(idleMs, at = now()) {
      rollDay(at)
      const result = applySample(state, { now: at, idleMs }, config())
      state = result.state
      lastActive = result.active
      if (result.deltaMs > 0) {
        pendingMs += result.deltaMs
        if (pendingSince === null) pendingSince = at
        if (at - pendingSince >= FLUSH_INTERVAL_MS) void flush()
      }
      return {
        active: result.active,
        deltaMs: result.deltaMs,
        resetContinuous: result.resetContinuous,
        idleMs: Number.isFinite(idleMs) ? idleMs : null,
      }
    },

    /** A completed break ends the continuous-work run. */
    resetContinuous() {
      state = { ...state, continuousMs: 0 }
    },

    snapshot(at = now()) {
      rollDay(at)
      return { dayKey: state.dayKey, activeTodayMs: state.activeMs, continuousMs: state.continuousMs, lastActive }
    },

    flush,
  }
}
