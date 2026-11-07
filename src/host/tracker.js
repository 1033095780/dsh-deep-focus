/**
 * Activity tracking: idle samples become active time plus per-application usage.
 * Aggregates are flushed once a minute as `{t, activeMs, apps}` lines so a day
 * stays around 288 records instead of one per sample.
 */
import { addAppMs, appsToRecord } from './apps.js'
import { localDayKey } from './storage.js'

export const FLUSH_INTERVAL_MS = 60_000

/** Fresh counter state for one calendar day. */
export function emptyTrackerState(dayKey) {
  return { dayKey, activeMs: 0, continuousMs: 0, lastTickAt: null }
}

/**
 * Fold one idle sample into the counters.
 * Elapsed time only counts while the previous sample said "active", so a sleep
 * or sampler gap never inflates usage; a gap also ends the continuous-work run.
 * A non-counting sample (pause / rest / idle) does not wipe the continuous run:
 * it DECAYS by `gap * continuousDecayRate` so a quick pause only removes a
 * proportional slice (clearing the cap takes roughly `limits.restMinutes`).
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
  const counted = sample.counted !== false
  const active = counted && idleValid && (config.idleThresholdMs <= 0 || sample.idleMs < config.idleThresholdMs)
  if (!gapValid) {
    // Sleep / restart / clock jump: never trust the gap, reset the run safely.
    resetContinuous = next.continuousMs > 0
    next.continuousMs = 0
  } else if (active) {
    deltaMs = gap
    next.activeMs += gap
    next.continuousMs += gap
  } else {
    const decayRate = Number.isFinite(config.continuousDecayRate) && config.continuousDecayRate > 0
      ? config.continuousDecayRate
      : 0
    if (decayRate > 0) {
      const before = next.continuousMs
      next.continuousMs = Math.max(0, before - gap * decayRate)
      resetContinuous = before > 0 && next.continuousMs === 0
    } else if (next.continuousMs > 0) {
      // No usable rate: keep the old instant-reset behaviour as a safety fallback.
      resetContinuous = true
      next.continuousMs = 0
    }
  }
  next.lastTickAt = sample.now
  return { state: next, deltaMs, active, resetContinuous }
}

/**
 * Tracker facade: keeps today's counters and app totals hot for `/state`, and
 * appends one aggregate line per minute (or on unload / day rollover).
 */
export function createTracker({ storage = null, settings = null, now = Date.now } = {}) {
  let state = emptyTrackerState(localDayKey(now()))
  let baseApps = new Map()
  let pendingMs = 0
  let pendingApps = new Map()
  let lastFlushAt = now()
  let flushChain = Promise.resolve()

  function config() {
    const all = settings?.get?.() ?? {}
    const usage = all.usage ?? {}
    const limits = all.limits ?? {}
    const sampleSeconds = Number.isFinite(usage.sampleSeconds) ? usage.sampleSeconds : 5
    const idleThresholdSeconds = Number.isFinite(usage.idleThresholdSeconds) ? usage.idleThresholdSeconds : 60
    const continuousMinutes = Number.isFinite(limits.continuousMinutes) ? limits.continuousMinutes : 30
    const restMinutes = Number.isFinite(limits.restMinutes) ? limits.restMinutes : 10
    // Clearing the whole continuous cap takes `restMinutes` of pause/rest:
    // usage-ms removed per pause-ms = continuousMinutes / restMinutes (e.g. 20/10 = 2).
    const continuousDecayRate = restMinutes >= 1 && continuousMinutes > 0
      ? continuousMinutes / restMinutes
      : 0
    return {
      idleThresholdMs: idleThresholdSeconds * 1000,
      maxGapMs: Math.max(10_000, sampleSeconds * 4000),
      trackApps: usage.trackApps !== false,
      continuousDecayRate,
    }
  }

  function writePending(dayKey, at) {
    if (pendingMs <= 0 && pendingApps.size === 0) return flushChain
    for (const [id, ms] of pendingApps.entries()) baseApps.set(id, (baseApps.get(id) ?? 0) + ms)
    const record = { t: at, activeMs: Math.round(pendingMs), apps: appsToRecord(pendingApps) }
    pendingMs = 0
    pendingApps = new Map()
    if (storage !== null) {
      flushChain = flushChain
        .then(() => storage.appendJsonl(`usage/${dayKey}.jsonl`, record))
        .catch(() => {})
    }
    return flushChain
  }

  function rollDay(at) {
    const dayKey = localDayKey(at)
    if (state.dayKey === dayKey) return false
    writePending(state.dayKey, at)
    baseApps = new Map()
    pendingMs = 0
    pendingApps = new Map()
    state = { ...state, dayKey, activeMs: 0, continuousMs: 0, lastTickAt: null }
    lastFlushAt = at
    return true
  }

  function flush(at = now()) {
    rollDay(at)
    writePending(state.dayKey, at)
    lastFlushAt = at
    return flushChain
  }

  return {
    /** Load today's accumulated total and per-app usage; call once before sampling starts. */
    async load() {
      rollDay(now())
      if (storage === null) {
        lastFlushAt = now()
        return state
      }
      const usage = await storage.readUsageDay(state.dayKey)
      state = { ...state, activeMs: usage.activeMs, continuousMs: 0, lastTickAt: null }
      baseApps = usage.apps
      lastFlushAt = now()
      return state
    },

    /**
     * Consume one `{idleMs, app}` sample; flushes automatically once a minute.
     * `options.counted=false` keeps the baseline (so the next gap is not
     * inflated) while adding no active/app time — used during a forced rest.
     */
    sample(sample, at = now(), options = {}) {
      rollDay(at)
      const cfg = config()
      const idleMs = sample?.idleMs
      const counted = options.counted !== false
      const result = applySample(state, { now: at, idleMs, counted }, cfg)
      state = result.state
      if (result.deltaMs > 0) {
        pendingMs += result.deltaMs
        if (cfg.trackApps && result.active && typeof sample?.app === 'string') {
          addAppMs(pendingApps, sample.app, result.deltaMs)
        }
      }
      if (at - lastFlushAt >= FLUSH_INTERVAL_MS) void flush(at)
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
      const apps = new Map(baseApps)
      for (const [id, ms] of pendingApps.entries()) apps.set(id, (apps.get(id) ?? 0) + ms)
      return {
        dayKey: state.dayKey,
        activeTodayMs: state.activeMs,
        continuousMs: state.continuousMs,
        apps,
      }
    },

    /** Write any pending aggregate now (also used by the periodic flush timer). */
    flush,
    flushIfDue(at = now()) {
      if (at - lastFlushAt >= FLUSH_INTERVAL_MS) return flush(at)
      return flushChain
    },
  }
}
