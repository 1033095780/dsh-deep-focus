import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventRing } from '../src/host/events.js'
import { createLimits, LIMITS_FILE, REST_ACTIVITY_WAIT_CAP_MS } from '../src/host/limits.js'
import { normalizeSettings } from '../src/host/settings.js'
import { EVENT } from '../src/shared/contract.js'

const BASE = new Date(2026, 10, 5, 10, 0, 0).getTime()

function makeLimits({ settings = {}, usage = null, nowValue = BASE, storage = null } = {}) {
  let clock = nowValue
  let settingsValue = normalizeSettings(settings)
  const settingsStore = { get: () => settingsValue }
  const usageState = usage ?? { activeTodayMs: 0, continuousMs: 0, dayKey: '2026-11-05' }
  const tracker = {
    usage: usageState,
    resets: 0,
    snapshot: () => usageState,
    resetContinuous() {
      usageState.continuousMs = 0
      tracker.resets += 1
    },
  }
  const ring = createEventRing({ now: () => clock })
  const limits = createLimits({ settings: settingsStore, tracker, ring, storage, now: () => clock })
  return {
    limits,
    tracker,
    ring,
    usage: usageState,
    setClock(value) { clock = value },
    get clock() { return clock },
    advance(ms) { clock += ms },
    setSettings(patch) { settingsValue = normalizeSettings(patch) },
    events: () => ring.list(),
    kinds: () => ring.list().map((event) => event.kind),
  }
}

function viewKeys() {
  return [
    'assistantEnabled', 'continuousLimitMs', 'continuousUsedMs', 'dailyLimitMs', 'dailyLocked', 'dailyUsedMs',
    'extendCountToday', 'extendLimit', 'extendedUntil', 'paused', 'pausedAt', 'pausedNeedsActivity',
    'pausedReason', 'restDue',
    'restNeedsActivity', 'restRemainingMs', 'restUntil', 'resting',
  ].sort()
}

test('defaults: assistant on, 3h daily, 30min continuous, 10min rest, not paused', () => {
  const env = makeLimits()
  const view = env.limits.evaluate(BASE)
  assert.deepEqual(Object.keys(view).sort(), viewKeys())
  assert.equal(view.assistantEnabled, true)
  assert.equal(view.dailyLimitMs, 180 * 60_000)
  assert.equal(view.continuousLimitMs, 30 * 60_000)
  assert.equal(view.resting, false)
  assert.equal(view.restNeedsActivity, false)
  assert.equal(view.paused, false)
  assert.equal(view.pausedAt, null)
  assert.equal(view.pausedNeedsActivity, false)
})

test('manual pause stops the clock and emits paused', () => {
  const env = makeLimits()
  const result = env.limits.pause(BASE)
  assert.equal(result.ok, true)
  const view = env.limits.getView(BASE)
  assert.equal(view.paused, true)
  assert.equal(view.pausedAt, BASE)
  assert.equal(view.pausedReason, 'manual')
  assert.equal(view.pausedNeedsActivity, true)
  const event = env.ring.list().at(-1)
  assert.equal(event.kind, EVENT.paused)
  assert.deepEqual(event.meta, { at: BASE, reason: 'manual' })
  assert.equal(env.limits.isPaused(), true)
  assert.deepEqual(env.limits.pause(BASE + 1000), { ok: false, code: 'already-paused' })
})

test('idle longer than usage.autoPauseSeconds pauses automatically, exactly once', () => {
  const env = makeLimits()
  // The 1s enforcement tick carries the latest sampler idle value and its sample time.
  let view = env.limits.evaluate(BASE, { idleMs: 59_000, sampleAt: BASE })
  assert.equal(view.paused, false)
  // A single high-idle sample is not sustained idleness: no pause yet.
  view = env.limits.evaluate(BASE + 1000, { idleMs: 60_000, sampleAt: BASE + 1000 })
  assert.equal(view.paused, false)
  // Two consecutive fresh high-idle samples do pause.
  view = env.limits.evaluate(BASE + 2000, { idleMs: 61_000, sampleAt: BASE + 2000 })
  assert.equal(view.paused, true)
  assert.equal(view.pausedReason, 'idle')
  assert.equal(view.pausedAt, BASE + 2000)
  const pausedEvents = env.ring.list().filter((event) => event.kind === EVENT.paused)
  assert.equal(pausedEvents.length, 1)
  assert.deepEqual(pausedEvents[0].meta, { at: BASE + 2000, reason: 'idle' })
  // Continuing idle samples do not emit a second pause.
  env.limits.evaluate(BASE + 5000, { idleMs: 90_000, sampleAt: BASE + 5000 })
  assert.equal(env.ring.list().filter((event) => event.kind === EVENT.paused).length, 1)
})

test('an active sample resets a pending idle strike', () => {
  const env = makeLimits()
  env.limits.evaluate(BASE, { idleMs: 65_000, sampleAt: BASE })
  env.limits.evaluate(BASE + 1000, { idleMs: 100, sampleAt: BASE + 1000 })
  env.limits.evaluate(BASE + 2000, { idleMs: 65_000, sampleAt: BASE + 2000 })
  assert.equal(env.limits.getView(BASE + 2000).paused, false)
  env.limits.evaluate(BASE + 3000, { idleMs: 65_000, sampleAt: BASE + 3000 })
  assert.equal(env.limits.getView(BASE + 3000).paused, true)
})

test('a stale high-idle sample never pauses', () => {
  const env = makeLimits()
  env.limits.evaluate(BASE, { idleMs: 200_000, sampleAt: BASE - 60_000 })
  env.limits.evaluate(BASE + 1000, { idleMs: 200_000, sampleAt: BASE - 59_000 })
  assert.equal(env.limits.getView(BASE + 1000).paused, false)
})

test('re-reading the same sampler sample does not build a strike', () => {
  const env = makeLimits()
  for (const offset of [0, 1000, 2000]) env.limits.evaluate(BASE + offset, { idleMs: 70_000, sampleAt: BASE })
  assert.equal(env.limits.getView(BASE + 2000).paused, false)
  env.limits.evaluate(BASE + 3000, { idleMs: 70_000, sampleAt: BASE + 3000 })
  assert.equal(env.limits.getView(BASE + 3000).paused, true)
})
test('a stale idle sample can never re-pause right after a resume', () => {
  const env = makeLimits()
  // Auto-pause needs two consecutive fresh idle samples.
  env.limits.evaluate(BASE, { idleMs: 186_484, sampleAt: BASE })
  assert.equal(env.limits.getView(BASE).paused, false)
  env.limits.evaluate(BASE + 1000, { idleMs: 186_484, sampleAt: BASE + 1000 })
  assert.equal(env.limits.getView(BASE + 1000).paused, true)

  const resumedAt = BASE + 2000
  env.setClock(resumedAt)
  const resumed = env.limits.resume(resumedAt)
  assert.equal(resumed.ok, true)
  assert.equal(resumed.view.paused, false)

  // The 1s ticks keep reading the pre-resume sample: stay unpaused.
  for (const offset of [1000, 2000, 3000]) {
    env.limits.evaluate(resumedAt + offset, { idleMs: 186_484, sampleAt: BASE + 1000 })
    assert.equal(env.limits.getView(resumedAt + offset).paused, false, `tick +${offset}`)
  }
  // Even after the resume grace window, the pre-resume sample is not proof of idleness.
  env.limits.evaluate(resumedAt + 20_000, { idleMs: 186_484, sampleAt: BASE + 1000 })
  assert.equal(env.limits.getView(resumedAt + 20_000).paused, false)
  // A sample taken exactly at the resume is not newer than it either.
  env.limits.evaluate(resumedAt + 21_000, { idleMs: 186_484, sampleAt: resumedAt })
  assert.equal(env.limits.getView(resumedAt + 21_000).paused, false)

  // Fresh samples after the grace: the first starts a strike, the second pauses.
  env.limits.evaluate(resumedAt + 30_000, { idleMs: 186_484, sampleAt: resumedAt + 30_000 })
  assert.equal(env.limits.getView(resumedAt + 30_000).paused, false)
  env.limits.evaluate(resumedAt + 31_000, { idleMs: 186_484, sampleAt: resumedAt + 31_000 })
  const paused = env.limits.getView(resumedAt + 31_000)
  assert.equal(paused.paused, true)
  assert.equal(paused.pausedReason, 'idle')
})
test('a resume grace window cannot block a manual pause', () => {
  const env = makeLimits()
  env.limits.evaluate(BASE, { idleMs: 186_484, sampleAt: BASE })
  env.limits.evaluate(BASE + 1000, { idleMs: 186_484, sampleAt: BASE + 1000 })
  env.setClock(BASE + 2000)
  env.limits.resume(BASE + 2000)
  // Manual pauses are immediate and ignore the grace.
  const manual = env.limits.pause(BASE + 2100)
  assert.equal(manual.ok, true)
  assert.equal(manual.view.paused, true)
  assert.equal(manual.view.pausedReason, 'manual')
})
test('activity auto-resumes an idle auto-pause', () => {
  const env = makeLimits()
  env.limits.applySample({ idleMs: 60_000 }, BASE)
  assert.equal(env.limits.getView(BASE).paused, false)
  env.limits.applySample({ idleMs: 60_000 }, BASE + 1000)
  assert.equal(env.limits.getView(BASE + 1000).paused, true)
  assert.equal(env.limits.getView(BASE + 1000).pausedReason, 'idle')

  // The 1s window right after the triggering sample does not resume.
  env.limits.applySample({ idleMs: 100 }, BASE + 1500)
  assert.equal(env.limits.getView(BASE + 1500).paused, true)

  // A later fresh active sample (system-wide activity) resumes it.
  env.limits.applySample({ idleMs: 100 }, BASE + 3000)
  const view = env.limits.getView(BASE + 3000)
  assert.equal(view.paused, false)
  assert.equal(view.pausedReason, null)
  const resumed = env.ring.list().filter((event) => event.kind === EVENT.resumed).at(-1)
  assert.equal(resumed.meta.reason, 'activity')
})

test('the sample that triggered an idle pause never resumes it', () => {
  const env = makeLimits()
  env.limits.applySample({ idleMs: 60_000 }, BASE)
  env.limits.applySample({ idleMs: 60_000 }, BASE + 1000)
  assert.equal(env.limits.getView(BASE + 1000).paused, true)
  // Exactly at pausedAt + 1s is still the triggering window (strictly later is required).
  env.limits.applySample({ idleMs: 100 }, BASE + 2000)
  assert.equal(env.limits.getView(BASE + 2000).paused, true)
  assert.equal(env.kinds().includes(EVENT.resumed), false)
})

test('the resume grace still prevents an instant re-pause after an idle auto-resume', () => {
  const env = makeLimits()
  env.limits.applySample({ idleMs: 60_000 }, BASE)
  env.limits.applySample({ idleMs: 60_000 }, BASE + 1000)
  env.limits.applySample({ idleMs: 100 }, BASE + 3000)
  assert.equal(env.limits.getView(BASE + 3000).paused, false)
  // A high idle reading right after the resume is grace-filtered.
  env.limits.applySample({ idleMs: 90_000 }, BASE + 4000)
  assert.equal(env.limits.getView(BASE + 4000).paused, false)
  // After the grace, two fresh high samples are required again.
  env.limits.applySample({ idleMs: 90_000 }, BASE + 14_000)
  assert.equal(env.limits.getView(BASE + 14_000).paused, false)
  env.limits.applySample({ idleMs: 90_000 }, BASE + 15_000)
  assert.equal(env.limits.getView(BASE + 15_000).paused, true)
})
test('a falling idleMs resumes either kind of pause', () => {
  const auto = makeLimits()
  auto.limits.applySample({ idleMs: 120_000 }, BASE)
  auto.limits.applySample({ idleMs: 120_000 }, BASE + 1000)
  assert.equal(auto.limits.getView(BASE + 1000).paused, true)
  auto.limits.applySample({ idleMs: 4000 }, BASE + 6000)
  assert.equal(auto.limits.getView(BASE + 6000).paused, false)
  assert.equal(auto.limits.getView(BASE + 6000).pausedReason, null)

  const manual = makeLimits()
  manual.limits.pause(BASE)
  manual.limits.applySample({ idleMs: 4000 }, BASE + 6000)
  manual.limits.applySample({ idleMs: 100 }, BASE + 11_000)
  const view = manual.limits.getView(BASE + 11_000)
  assert.equal(view.paused, false)
  assert.equal(view.pausedReason, null)
  assert.equal(manual.ring.list().filter((event) => event.kind === EVENT.resumed).at(-1).meta.reason, 'activity')
})

test('auto-resume requires input that arrived after the pause', () => {
  const env = makeLimits()
  env.limits.pause(BASE)
  // idle ≈ sincePause: the last input is the pause click itself.
  env.limits.applySample({ idleMs: 1500 }, BASE + 1500)
  assert.equal(env.limits.getView(BASE + 1500).paused, true)
  env.limits.applySample({ idleMs: 2000 }, BASE + 2000)
  assert.equal(env.limits.getView(BASE + 2000).paused, true)
  // Real input 2s after the pause (sample at +3s): resumes.
  env.limits.applySample({ idleMs: 1000 }, BASE + 3000)
  assert.equal(env.limits.getView(BASE + 3000).paused, false)
  assert.equal(env.limits.getView(BASE + 3000).pausedReason, null)
  assert.equal(env.ring.list().filter((event) => event.kind === EVENT.resumed).at(-1).meta.reason, 'activity')
})

test('a missing idleMs never auto-resumes a pause', () => {
  const env = makeLimits()
  env.limits.pause(BASE)
  env.limits.applySample({}, BASE + 5000)
  env.limits.applySample({ idleMs: null }, BASE + 6000)
  assert.equal(env.limits.getView(BASE + 6000).paused, true)
})

test('an idle auto-pause follows the same input-after-pause rule', () => {
  const env = makeLimits()
  env.limits.applySample({ idleMs: 60_000 }, BASE)
  env.limits.applySample({ idleMs: 60_000 }, BASE + 1000)
  assert.equal(env.limits.getView(BASE + 1000).paused, true)
  // 1.4s after the pause with idle 1.4s: still the pre-pause click trail.
  env.limits.applySample({ idleMs: 1400 }, BASE + 2400)
  assert.equal(env.limits.getView(BASE + 2400).paused, true)
  // Genuinely new input after the pause resumes it.
  env.limits.applySample({ idleMs: 300 }, BASE + 3400)
  assert.equal(env.limits.getView(BASE + 3400).paused, false)
})

test('usage.autoPauseSeconds 0 disables the automatic pause', () => {
  const env = makeLimits({ settings: { usage: { autoPauseSeconds: 0 } } })
  env.limits.evaluate(BASE, { idleMs: 10 * 60_000, sampleAt: BASE })
  env.limits.evaluate(BASE + 1000, { idleMs: 10 * 60_000, sampleAt: BASE + 1000 })
  assert.equal(env.limits.getView(BASE + 1000).paused, false)
  env.limits.applySample({ idleMs: 10 * 60_000 }, BASE + 2000)
  env.limits.applySample({ idleMs: 10 * 60_000 }, BASE + 3000)
  assert.equal(env.limits.getView(BASE + 3000).paused, false)
})
test('auto-pause never fires during a rest or while the assistant is off', () => {
  const resting = makeLimits()
  resting.limits.startRest(BASE)
  resting.limits.evaluate(BASE + 1000, { idleMs: 10 * 60_000, sampleAt: BASE + 1000 })
  resting.limits.evaluate(BASE + 2000, { idleMs: 10 * 60_000, sampleAt: BASE + 2000 })
  assert.equal(resting.limits.getView(BASE + 2000).paused, false)

  const off = makeLimits({ settings: { assistant: { enabled: false } } })
  off.limits.evaluate(BASE, { idleMs: 10 * 60_000, sampleAt: BASE })
  off.limits.evaluate(BASE + 1000, { idleMs: 10 * 60_000, sampleAt: BASE + 1000 })
  assert.equal(off.limits.getView(BASE + 1000).paused, false)
})
test('a manual pause also auto-resumes on system activity', () => {
  const env = makeLimits()
  env.limits.pause(BASE)
  assert.equal(env.limits.getView(BASE).paused, true)
  assert.equal(env.limits.getView(BASE).pausedReason, 'manual')
  // The 1s window right after the click does not resume.
  env.limits.applySample({ idleMs: 100 }, BASE + 500)
  assert.equal(env.limits.getView(BASE + 500).paused, true)
  // A later fresh active sample resumes it.
  env.limits.applySample({ idleMs: 100 }, BASE + 2000)
  const view = env.limits.getView(BASE + 2000)
  assert.equal(view.paused, false)
  assert.equal(view.pausedReason, null)
  const resumed = env.ring.list().filter((event) => event.kind === EVENT.resumed)
  assert.equal(resumed.length, 1)
  assert.equal(resumed[0].meta.reason, 'activity')
  // Further activity does not emit duplicate resumes.
  env.limits.applySample({ idleMs: 100 }, BASE + 3000)
  assert.equal(env.ring.list().filter((event) => event.kind === EVENT.resumed).length, 1)
  // POST /resume still works for a new pause.
  env.limits.pause(BASE + 4000)
  assert.equal(env.limits.resume(BASE + 5000).ok, true)
})
test('an idle sample never resumes a pause', () => {
  const env = makeLimits()
  env.limits.pause(BASE)
  env.limits.applySample({ idleMs: 10 * 60_000 }, BASE + 60_000)
  assert.equal(env.limits.getView(BASE).paused, true)
})

test('POST /resume force-resumes and conflicts when not paused', () => {
  const env = makeLimits()
  env.limits.pause(BASE)
  const resumed = env.limits.resume(BASE + 1000)
  assert.equal(resumed.ok, true)
  assert.equal(resumed.view.paused, false)
  assert.equal(resumed.view.pausedReason, null)
  assert.equal(env.ring.list().at(-1).meta.reason, 'manual')
  assert.deepEqual(env.limits.resume(BASE + 2000), { ok: false, code: 'not-paused' })
})

test('the continuous cap starts a forced rest that still needs activity to end', () => {
  const env = makeLimits()
  env.usage.continuousMs = 30 * 60_000
  const started = env.limits.evaluate(BASE)
  assert.equal(started.resting, true)
  assert.equal(started.restRemainingMs, 10 * 60_000)
  assert.equal(started.restNeedsActivity, false)
  assert.equal(env.tracker.resets, 1)
  assert.equal(env.ring.list().at(-1).kind, EVENT.restStarted)

  // Time elapses, but the user is away: the rest keeps waiting, no counting.
  const waiting = env.limits.evaluate(BASE + 10 * 60_000)
  assert.equal(waiting.resting, true)
  assert.equal(waiting.restRemainingMs, 0)
  assert.equal(waiting.restNeedsActivity, true)
  assert.equal(env.kinds().filter((kind) => kind === EVENT.restFinished).length, 0)

  // Coming back (activity) finishes it, exactly once.
  env.limits.applySample({ idleMs: 100 }, BASE + 10 * 60_000 + 5000)
  const finished = env.limits.getView(BASE + 10 * 60_000 + 5000)
  assert.equal(finished.resting, false)
  const event = env.ring.list().at(-1)
  assert.equal(event.kind, EVENT.restFinished)
  assert.deepEqual(event.meta, { early: false, reason: 'elapsed-and-active' })
  env.limits.applySample({ idleMs: 100 }, BASE + 10 * 60_000 + 6000)
  assert.equal(env.kinds().filter((kind) => kind === EVENT.restFinished).length, 1)
})

test('a rest finishes without activity after the 30-minute wait cap', () => {
  const env = makeLimits()
  env.usage.continuousMs = 30 * 60_000
  env.limits.evaluate(BASE)
  const restUntil = env.limits.getView(BASE).restUntil
  env.setClock(restUntil + REST_ACTIVITY_WAIT_CAP_MS + 1000)
  const view = env.limits.evaluate(restUntil + REST_ACTIVITY_WAIT_CAP_MS + 1000)
  assert.equal(view.resting, false)
  const event = env.ring.list().at(-1)
  assert.equal(event.kind, EVENT.restFinished)
  assert.equal(event.meta.early, false)
  assert.equal(event.meta.capped, true)
})

test('skipping a rest ends it immediately with reason skipped', () => {
  const env = makeLimits()
  const started = env.limits.startRest(BASE)
  assert.equal(started.ok, true)
  assert.equal(started.view.resting, true)
  assert.deepEqual(env.limits.startRest(BASE + 1000), { ok: false, code: 'already-resting' })
  const skipped = env.limits.finishRest(BASE + 1000)
  assert.equal(skipped.ok, true)
  assert.equal(skipped.view.resting, false)
  const event = env.ring.list().at(-1)
  assert.equal(event.kind, EVENT.restFinished)
  assert.deepEqual(event.meta, { early: true, reason: 'skipped' })
  assert.deepEqual(env.limits.finishRest(BASE + 2000), { ok: false, code: 'not-resting' })
})

test('pause and forced rest do not stack', () => {
  const env = makeLimits()
  env.limits.pause(BASE)
  // A manual rest supersedes the pause: the rest screen is the stronger mode.
  const rest = env.limits.startRest(BASE)
  assert.equal(rest.ok, true)
  assert.equal(rest.view.paused, false)
  const resting = makeLimits()
  resting.usage.continuousMs = 30 * 60_000
  resting.limits.evaluate(BASE)
  assert.deepEqual(resting.limits.pause(BASE + 1000), { ok: false, code: 'already-resting' })
})

test('the assistant switch clears pause and enforcement', () => {
  const env = makeLimits()
  env.usage.activeTodayMs = 180 * 60_000
  env.limits.pause(BASE)
  env.usage.continuousMs = 30 * 60_000
  env.setSettings({ assistant: { enabled: false } })
  const off = env.limits.setAssistantEnabled(false, BASE + 1000)
  assert.equal(off.paused, false)
  assert.equal(off.resting, false)
  assert.equal(off.dailyLocked, false)
  assert.equal(env.kinds().includes(EVENT.assistantOff), true)
})

test('the daily cap locks and extend grants another window', () => {
  const env = makeLimits()
  env.usage.activeTodayMs = 180 * 60_000
  let view = env.limits.evaluate(BASE)
  assert.equal(view.dailyLocked, true)
  assert.equal(view.extendLimit, 0)
  const extended = env.limits.extend(BASE + 1000)
  assert.equal(extended.ok, true)
  view = env.limits.getView(BASE + 1000)
  assert.equal(view.dailyLocked, false)
  assert.equal(view.extendCountToday, 1)
  assert.equal(view.extendedUntil, BASE + 1000 + 20 * 60_000)
  assert.equal(env.ring.list().at(-1).kind, EVENT.extended)
})

test('dailyExtendLimit 0 means unlimited extensions', () => {
  const env = makeLimits()
  env.usage.activeTodayMs = 180 * 60_000
  env.limits.evaluate(BASE)
  let clock = BASE
  for (let round = 1; round <= 3; round += 1) {
    clock += 1000
    const extended = env.limits.extend(clock)
    assert.equal(extended.ok, true, `round ${round}`)
    assert.equal(env.limits.getView(clock).extendCountToday, round)
    // Wait out the granted window so the next round starts from a fresh lock.
    clock = env.limits.getView(clock).extendedUntil + 1000
    env.limits.evaluate(clock)
    assert.equal(env.limits.getView(clock).dailyLocked, true)
  }
  assert.equal(env.limits.getView(clock).extendLimit, 0)
})

test('a positive dailyExtendLimit blocks at the limit', () => {
  const env = makeLimits({ settings: { limits: { dailyExtendLimit: 2 } } })
  env.usage.activeTodayMs = 180 * 60_000
  env.limits.evaluate(BASE)
  assert.equal(env.limits.getView(BASE).extendLimit, 2)
  let clock = BASE
  for (let round = 1; round <= 2; round += 1) {
    clock += 1000
    assert.equal(env.limits.extend(clock).ok, true, `round ${round}`)
    clock = env.limits.getView(clock).extendedUntil + 1000
    env.limits.evaluate(clock)
    assert.equal(env.limits.getView(clock).dailyLocked, true)
  }
  assert.deepEqual(env.limits.extend(clock + 1000), { ok: false, code: 'extend-limit-reached' })
})

test('daily counters reset at the next local day', () => {
  const env = makeLimits()
  env.usage.activeTodayMs = 180 * 60_000
  env.limits.evaluate(BASE)
  env.limits.extend(BASE + 1000)
  const nextDay = new Date(2026, 10, 6, 10, 0, 0).getTime()
  env.setClock(nextDay)
  env.usage.activeTodayMs = 0
  const view = env.limits.evaluate(nextDay)
  assert.equal(view.dailyLocked, false)
  assert.equal(view.extendCountToday, 0)
  assert.equal(view.extendedUntil, null)
})

test('load restores a waiting rest and a pause', async () => {
  const future = BASE + 5 * 60_000
  const storage = {
    readJson: async (path) => {
      assert.equal(path, LIMITS_FILE)
      return {
        dayKey: '2026-11-05',
        resting: false,
        restUntil: null,
        paused: true,
        pausedAt: BASE - 1000,
        pausedReason: 'idle',
        dailyLocked: false,
        lockedSince: null,
        extendedUntil: null,
        extendCountToday: 0,
      }
    },
    writeJson: async () => {},
  }
  const env = makeLimits({ storage })
  await env.limits.load()
  const view = env.limits.getView(BASE)
  assert.equal(view.paused, true)
  assert.equal(view.pausedAt, BASE - 1000)
  assert.equal(view.pausedReason, 'idle')

  const restStorage = {
    readJson: async () => ({
      dayKey: '2026-11-05',
      resting: true,
      restUntil: future,
      restStartedAt: BASE,
      paused: false,
      pausedAt: null,
    }),
    writeJson: async () => {},
  }
  const restEnv = makeLimits({ storage: restStorage })
  await restEnv.limits.load()
  assert.equal(restEnv.limits.getView(BASE).resting, true)
  assert.equal(restEnv.limits.getView(BASE).restNeedsActivity, false)
})
