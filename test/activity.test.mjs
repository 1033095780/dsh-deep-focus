import assert from 'node:assert/strict'
import test from 'node:test'
import { isDshForegroundName } from '../src/host/apps.js'
import { createEventRing } from '../src/host/events.js'
import { createLimits } from '../src/host/limits.js'
import { createSettingsStore } from '../src/host/settings.js'
import { createTracker } from '../src/host/tracker.js'
import { EVENT } from '../src/shared/contract.js'

const BASE = new Date(2026, 10, 5, 10, 0, 0).getTime()
const STEP_MS = 5000

/**
 * Mirrors the exact `onSample` order used by src/index.js: resolve the foreground
 * app, then count only when the pause/rest page is actually effective in front.
 */
function makeActivity({ settingsPatch = null } = {}) {
  let clock = BASE
  const settings = createSettingsStore()
  let ready = null
  ready = settings.load().then(() => (settingsPatch === null ? undefined : settings.update(settingsPatch)))
  const tracker = createTracker({ storage: null, settings, now: () => clock })
  const ring = createEventRing({ now: () => clock })
  const limits = createLimits({ settings, tracker, ring, now: () => clock })

  function step(idleMs, at = clock, app = 'DeepSeek Harness') {
    clock = at
    limits.setForegroundDsh(isDshForegroundName(app))
    limits.evaluate(at)
    limits.applySample({ idleMs }, at)
    const counted = !limits.isPauseEffective() && !limits.isRestEffective()
    tracker.sample({ idleMs, app }, at, { counted, recovering: limits.isRecoveryEffective() })
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

test('pausing stops counting and resumes on system activity', async () => {
  const env = makeActivity()
  await env.ready
  let usage = env.step(100, BASE)
  usage = env.step(100, BASE + STEP_MS)
  assert.equal(usage.activeTodayMs, STEP_MS)

  env.limits.pause(BASE + STEP_MS + 1000)
  assert.equal(env.limits.getView(env.clock).paused, true)
  assert.equal(env.limits.getView(env.clock).pausedReason, 'manual')

  // Activity inside the 1s trigger window does not resume and nothing counts.
  usage = env.step(100, BASE + STEP_MS + 1500)
  assert.equal(env.limits.getView(env.clock).paused, true)
  assert.equal(usage.activeTodayMs, STEP_MS)

  // Later system activity auto-resumes the manual pause and counting continues.
  usage = env.step(100, BASE + STEP_MS + 5000)
  assert.equal(env.limits.getView(env.clock).paused, false)
  assert.equal(env.limits.getView(env.clock).pausedReason, null)
  assert.ok(env.kinds().includes(EVENT.resumed))
  assert.equal(usage.activeTodayMs, STEP_MS + 3500)
  usage = env.step(100, env.clock + STEP_MS)
  assert.equal(usage.activeTodayMs, STEP_MS + 8500)
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

test('idle beyond autoPauseSeconds auto-pauses; system activity resumes it', async () => {
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

  // Activity inside the 1s trigger window does not resume.
  env.step(100, env.clock + 500)
  assert.equal(env.limits.getView(env.clock).paused, true)
  // While paused, counting stays frozen.
  env.step(60_000, env.clock + 10_000)
  assert.equal(env.tracker.snapshot(env.clock).activeTodayMs, before)
  assert.equal(env.kinds().filter((kind) => kind === EVENT.paused).length, 1)

  // Later system-wide activity auto-resumes the idle pause and counting continues.
  env.step(100, env.clock + 3000)
  assert.equal(env.limits.getView(env.clock).paused, false)
  assert.equal(env.limits.getView(env.clock).pausedReason, null)
  assert.ok(env.kinds().includes(EVENT.resumed))
  env.step(100, env.clock + STEP_MS)
  assert.ok(env.tracker.snapshot(env.clock).activeTodayMs > before)

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
test('activity auto-resumes a manual pause', async () => {
  const env = makeActivity()
  await env.ready
  env.step(100, BASE)
  env.limits.pause(BASE + STEP_MS)
  env.step(100, BASE + STEP_MS + 500)
  assert.equal(env.limits.getView(env.clock).paused, true)
  assert.equal(env.limits.getView(env.clock).pausedReason, 'manual')
  env.step(100, BASE + STEP_MS + 2000)
  assert.equal(env.limits.getView(env.clock).paused, false)
  assert.equal(env.limits.getView(env.clock).pausedReason, null)
  const resumed = env.ring.list().filter((event) => event.kind === EVENT.resumed).at(-1)
  assert.equal(resumed.meta.reason, 'activity')
})

function buildContinuous(env, minutes) {
  const samples = (minutes * 60_000) / STEP_MS
  for (let index = 0; index <= samples; index += 1) {
    env.step(100, BASE + index * STEP_MS)
  }
}

test('pausing decays continuous usage instead of resetting it', async () => {
  const env = makeActivity({ settingsPatch: { limits: { continuousMinutes: 20, restMinutes: 10 } } })
  await env.ready
  buildContinuous(env, 10)
  const start = env.tracker.snapshot(env.clock).continuousMs
  assert.equal(start, 600_000)

  const pauseAt = env.clock + 1000
  env.limits.pause(pauseAt)
  // One paused sample is never an instant reset.
  env.step(60_000, pauseAt + STEP_MS)
  assert.ok(env.tracker.snapshot(env.clock).continuousMs > 500_000)

  // One minute paused removes 2 minutes of continuous usage (rate 2).
  for (let index = 2; index <= 12; index += 1) {
    env.step(60_000, pauseAt + index * STEP_MS)
  }
  assert.equal(env.limits.getView(env.clock).paused, true)
  const decayed = env.tracker.snapshot(env.clock).continuousMs
  assert.ok(Math.abs(decayed - 478_000) <= 5000, 'expected ~8min, got ' + decayed)

  // Resuming continues from the decayed value instead of restarting.
  env.limits.resume(env.clock)
  env.step(100, env.clock + STEP_MS)
  assert.equal(env.tracker.snapshot(env.clock).continuousMs, decayed + STEP_MS)
})

test('a ten-minute rest clears a full 20-minute continuous run', async () => {
  const env = makeActivity({ settingsPatch: { limits: { continuousMinutes: 20, restMinutes: 10 } } })
  await env.ready
  buildContinuous(env, 20)
  assert.equal(env.limits.getView(env.clock).resting, true)
  const restStart = env.clock
  for (let index = 1; index <= 120; index += 1) {
    env.step(60_000, restStart + index * STEP_MS)
  }
  assert.equal(env.limits.getView(env.clock).resting, true)
  assert.equal(env.tracker.snapshot(env.clock).continuousMs, 0)
})

test('a five-minute rest leaves about half of a 20-minute continuous run', async () => {
  const env = makeActivity({ settingsPatch: { limits: { continuousMinutes: 20, restMinutes: 10 } } })
  await env.ready
  buildContinuous(env, 20)
  const restStart = env.clock
  for (let index = 1; index <= 60; index += 1) {
    env.step(60_000, restStart + index * STEP_MS)
  }
  const remaining = env.tracker.snapshot(env.clock).continuousMs
  assert.ok(Math.abs(remaining - 600_000) <= 10_000, 'expected ~10min, got ' + remaining)
})

test('skipping a rest keeps the decayed remainder', async () => {
  const env = makeActivity({ settingsPatch: { limits: { continuousMinutes: 20, restMinutes: 10 } } })
  await env.ready
  buildContinuous(env, 20)
  const restStart = env.clock
  for (let index = 1; index <= 24; index += 1) {
    env.step(60_000, restStart + index * STEP_MS)
  }
  const beforeSkip = env.tracker.snapshot(env.clock).continuousMs
  const skipped = env.limits.finishRest(env.clock)
  assert.equal(skipped.ok, true)
  assert.equal(env.tracker.snapshot(env.clock).continuousMs, beforeSkip)
  assert.ok(beforeSkip > 0)
})

test('assistant-off still zeroes continuous usage', async () => {
  const env = makeActivity()
  await env.ready
  buildContinuous(env, 5)
  assert.ok(env.tracker.snapshot(env.clock).continuousMs > 0)
  env.limits.setAssistantEnabled(false)
  assert.equal(env.tracker.snapshot(env.clock).continuousMs, 0)
})


test('a pause keeps counting while another app is foreground, then decays back in DSH', async () => {
  const env = makeActivity({ settingsPatch: { limits: { continuousMinutes: 20, restMinutes: 10 } } })
  await env.ready
  buildContinuous(env, 5)
  const pauseAt = env.clock + 1000
  env.limits.pause(pauseAt)
  assert.equal(env.limits.getView(env.clock).paused, true)

  // Using another application: pause is not effective, so usage keeps counting and
  // the continuous run does not decay.
  const beforeActive = env.tracker.snapshot(env.clock).activeTodayMs
  const beforeContinuous = env.tracker.snapshot(env.clock).continuousMs
  env.step(100, pauseAt + STEP_MS, 'msedge')
  env.step(100, pauseAt + 2 * STEP_MS, 'msedge')
  const outside = env.tracker.snapshot(env.clock)
  assert.equal(env.limits.getView(env.clock).paused, true)
  assert.ok(outside.activeTodayMs > beforeActive)
  assert.ok(outside.continuousMs >= beforeContinuous)

  // Back on the DSH pause page with no new input: counting stops and decay begins.
  const beforeBack = env.tracker.snapshot(env.clock).activeTodayMs
  const continuousBack = env.tracker.snapshot(env.clock).continuousMs
  env.step(60_000, env.clock + STEP_MS, 'DeepSeek Harness')
  const inside = env.tracker.snapshot(env.clock)
  assert.equal(env.limits.getView(env.clock).paused, true)
  assert.equal(inside.activeTodayMs, beforeBack)
  assert.ok(inside.continuousMs < continuousBack)
})

test('a rest stays ineffective while another app is foreground', async () => {
  const env = makeActivity({ settingsPatch: { limits: { continuousMinutes: 20, restMinutes: 10 } } })
  await env.ready
  buildContinuous(env, 20)
  assert.equal(env.limits.getView(env.clock).resting, true)
  const restStart = env.clock

  const beforeActive = env.tracker.snapshot(env.clock).activeTodayMs
  env.step(100, restStart + STEP_MS, 'msedge')
  env.step(100, restStart + 2 * STEP_MS, 'msedge')
  const outside = env.tracker.snapshot(env.clock)
  assert.equal(env.limits.getView(env.clock).resting, true)
  assert.ok(outside.activeTodayMs > beforeActive)

  // Back in DSH, the rest page becomes effective: counting stops, decay starts.
  const beforeBack = env.tracker.snapshot(env.clock).activeTodayMs
  const continuousBack = env.tracker.snapshot(env.clock).continuousMs
  env.step(60_000, env.clock + STEP_MS, 'DeepSeek Harness')
  const inside = env.tracker.snapshot(env.clock)
  assert.equal(inside.activeTodayMs, beforeBack)
  assert.ok(inside.continuousMs < continuousBack)
})
