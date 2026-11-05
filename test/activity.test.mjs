import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventRing } from '../src/host/events.js'
import { createLimits } from '../src/host/limits.js'
import { createSettingsStore } from '../src/host/settings.js'
import { createTracker } from '../src/host/tracker.js'
import { EVENT } from '../src/shared/contract.js'

const BASE = new Date(2026, 10, 5, 10, 0, 0).getTime()
const STEP_MS = 5000

/**
 * Mirrors the exact `onSample` order used by src/index.js: resolve pause/rest,
 * then count only when neither is active.
 */
function makeActivity({ settingsPatch = null } = {}) {
  let clock = BASE
  const settings = createSettingsStore()
  let ready = null
  ready = settings.load().then(() => (settingsPatch === null ? undefined : settings.update(settingsPatch)))
  const tracker = createTracker({ storage: null, settings, now: () => clock })
  const ring = createEventRing({ now: () => clock })
  const limits = createLimits({ settings, tracker, ring, now: () => clock })

  function step(idleMs, at = clock) {
    clock = at
    limits.evaluate(at)
    limits.applySample({ idleMs }, at)
    const counted = !limits.isResting() && !limits.isPaused()
    tracker.sample({ idleMs, app: 'chrome' }, at, { counted })
    limits.evaluate(at)
    return tracker.snapshot(at)
  }

  return {
    ready,
    settings,
    tracker,
    limits,
    ring,
    get clock() { return clock },
    setClock(value) { clock = value },
    step,
    kinds: () => ring.list().map((event) => event.kind),
  }
}

test('pausing stops counting until POST /resume', async () => {
  const env = makeActivity()
  await env.ready
  let usage = env.step(100, BASE)
  usage = env.step(100, BASE + STEP_MS)
  assert.equal(usage.activeTodayMs, STEP_MS)

  env.limits.pause(BASE + STEP_MS + 1000)
  assert.equal(env.limits.getView(env.clock).paused, true)

  // Activity inside or after the old grace window does not resume a manual pause.
  usage = env.step(100, BASE + STEP_MS + 2000)
  assert.equal(env.limits.getView(env.clock).paused, true)
  assert.equal(usage.activeTodayMs, STEP_MS)
  usage = env.step(100, BASE + STEP_MS + 5000)
  assert.equal(env.limits.getView(env.clock).paused, true)
  assert.equal(usage.activeTodayMs, STEP_MS)

  // Only an explicit resume restarts the clock; the next active sample counts again.
  const resumed = env.limits.resume(env.clock)
  assert.equal(resumed.ok, true)
  assert.equal(env.limits.getView(env.clock).paused, false)
  usage = env.step(100, env.clock + STEP_MS)
  assert.equal(usage.activeTodayMs, STEP_MS * 2)
})
test('an idle machine keeps the pause and never resumes by timer', async () => {
  const env = makeActivity()
  await env.ready
  env.step(100, BASE)
  env.limits.pause(BASE + STEP_MS)
  const usage = env.step(10 * 60_000, BASE + 60_000)
  assert.equal(env.limits.getView(env.clock).paused, true)
  assert.equal(usage.activeTodayMs, 0)
})

test('a forced rest excludes all counting until activity ends it', async () => {
  const env = makeActivity()
  await env.ready
  // Fill the continuous quota: 30 minutes of active samples.
  for (let index = 0; index <= 360; index += 1) {
    env.step(100, BASE + index * STEP_MS)
  }
  const restingView = env.limits.getView(env.clock)
  assert.equal(restingView.resting, true)
  const usedBefore = env.tracker.snapshot(env.clock).activeTodayMs
  assert.ok(usedBefore >= 30 * 60_000)

  // The whole rest window is skipped by the sampler.
  for (let index = 1; index <= 6; index += 1) {
    env.step(100, env.clock + STEP_MS)
  }
  assert.equal(env.tracker.snapshot(env.clock).activeTodayMs, usedBefore)
  assert.equal(env.limits.getView(env.clock).resting, true)

  // Time is up but the user is away: the rest keeps waiting.
  const restUntil = restingView.restUntil
  env.setClock(restUntil + 1000)
  env.limits.evaluate(restUntil + 1000)
  assert.equal(env.limits.getView(restUntil + 1000).resting, true)
  assert.equal(env.limits.getView(restUntil + 1000).restNeedsActivity, true)
  assert.equal(env.tracker.snapshot(restUntil + 1000).activeTodayMs, usedBefore)

  // Coming back finishes the rest, and the next active sample counts again.
  env.step(100, restUntil + 2000)
  assert.equal(env.limits.getView(env.clock).resting, false)
  assert.ok(env.kinds().includes(EVENT.restFinished))
  env.step(100, env.clock + STEP_MS)
  assert.ok(env.tracker.snapshot(env.clock).activeTodayMs > usedBefore)
})

test('the 30-minute wait cap releases a rest with no user return', async () => {
  const env = makeActivity()
  await env.ready
  for (let index = 0; index <= 360; index += 1) {
    env.step(100, BASE + index * STEP_MS)
  }
  const restUntil = env.limits.getView(env.clock).restUntil
  env.setClock(restUntil + 30 * 60_000 + 1000)
  env.limits.evaluate(env.clock)
  assert.equal(env.limits.getView(env.clock).resting, false)
  const finished = env.ring.list().filter((event) => event.kind === EVENT.restFinished).at(-1)
  assert.equal(finished.meta.capped, true)
})

test('a skipped rest ends immediately and counting resumes', async () => {
  const env = makeActivity()
  await env.ready
  env.step(100, BASE)
  assert.equal(env.limits.startRest(BASE + STEP_MS).ok, true)
  const skipped = env.limits.finishRest(BASE + STEP_MS + 1000)
  assert.equal(skipped.ok, true)
  assert.equal(skipped.view.resting, false)
  const finished = env.ring.list().filter((event) => event.kind === EVENT.restFinished).at(-1)
  assert.deepEqual(finished.meta, { early: true, reason: 'skipped' })
  const usage = env.step(100, BASE + STEP_MS + 2000)
  assert.ok(usage.activeTodayMs > 0)
})

test('idle beyond autoPauseSeconds auto-pauses through the sampler path', async () => {
  const env = makeActivity()
  await env.ready
  env.step(100, BASE)
  env.step(100, BASE + STEP_MS)
  const before = env.tracker.snapshot(env.clock).activeTodayMs

  // One idle sample is not sustained idleness: no pause yet.
  env.step(60_000, BASE + STEP_MS + 1000)
  assert.equal(env.limits.getView(env.clock).paused, false)
  // The second consecutive high-idle sample pauses and counting stops.
  env.step(60_000, env.clock + 1000)
  assert.equal(env.limits.getView(env.clock).paused, true)
  assert.equal(env.limits.getView(env.clock).pausedReason, 'idle')
  env.step(60_000, env.clock + 10_000)
  assert.equal(env.tracker.snapshot(env.clock).activeTodayMs, before)
  assert.equal(env.kinds().filter((kind) => kind === EVENT.paused).length, 1)

  // Activity does NOT resume an auto-pause; only an explicit resume does.
  env.step(100, env.clock + 2000)
  assert.equal(env.limits.getView(env.clock).paused, true)
  assert.equal(env.limits.getView(env.clock).pausedReason, 'idle')
  const resumed = env.limits.resume(env.clock)
  assert.equal(resumed.ok, true)
  assert.equal(env.limits.getView(env.clock).paused, false)
  assert.ok(env.kinds().includes(EVENT.resumed))
  // The idle value that caused the pause is older than the resume: ticking with it
  // must not flap straight back into the paused state.
  const staleIdleAt = env.clock - 20_000
  for (const offset of [1000, 2000, 3000]) {
    env.limits.evaluate(env.clock + offset, { idleMs: 186_484, sampleAt: staleIdleAt })
    assert.equal(env.limits.getView(env.clock + offset).paused, false, `tick +${offset}`)
  }
  // Two genuinely fresh high-idle samples after the grace pause again; the first
  // one alone only starts a strike.
  env.limits.evaluate(env.clock + 20_000, { idleMs: 186_484, sampleAt: env.clock + 20_000 })
  assert.equal(env.limits.getView(env.clock + 20_000).paused, false)
  env.limits.evaluate(env.clock + 21_000, { idleMs: 186_484, sampleAt: env.clock + 21_000 })
  assert.equal(env.limits.getView(env.clock + 21_000).paused, true)
})
test('activity does not clear a manual pause', async () => {
  const env = makeActivity()
  await env.ready
  env.step(100, BASE)
  env.limits.pause(BASE + STEP_MS)
  env.step(100, BASE + STEP_MS + 1000)
  env.step(100, BASE + STEP_MS + 2000)
  assert.equal(env.limits.getView(env.clock).paused, true)
  assert.equal(env.limits.getView(env.clock).pausedReason, 'manual')
  env.limits.resume(env.clock)
  assert.equal(env.limits.getView(env.clock).paused, false)
})