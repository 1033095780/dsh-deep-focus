import assert from 'node:assert/strict'
import test from 'node:test'
import { applySample, createTracker, emptyTrackerState } from '../src/host/tracker.js'

const CONFIG = { idleThresholdMs: 60_000, maxGapMs: 20_000, dayKeyOf: () => '2026-11-05' }

test('the first sample only establishes the baseline', () => {
  const result = applySample(emptyTrackerState('2026-11-05'), { now: 1000, idleMs: 100 }, CONFIG)
  assert.equal(result.deltaMs, 0)
  assert.equal(result.active, true)
  assert.equal(result.state.activeMs, 0)
  assert.equal(result.state.lastTickAt, 1000)
})

test('active samples accumulate active and continuous time', () => {
  let state = emptyTrackerState('2026-11-05')
  let result = applySample(state, { now: 0, idleMs: 100 }, CONFIG)
  state = result.state
  result = applySample(state, { now: 5000, idleMs: 200 }, CONFIG)
  state = result.state
  result = applySample(state, { now: 10_000, idleMs: 300 }, CONFIG)
  assert.equal(result.deltaMs, 5000)
  assert.equal(result.state.activeMs, 10_000)
  assert.equal(result.state.continuousMs, 10_000)
})

test('idle samples stop accumulating and end the continuous run', () => {
  let state = emptyTrackerState('2026-11-05')
  state = applySample(state, { now: 0, idleMs: 100 }, CONFIG).state
  state = applySample(state, { now: 5000, idleMs: 100 }, CONFIG).state
  const result = applySample(state, { now: 10_000, idleMs: 61_000 }, CONFIG)
  assert.equal(result.deltaMs, 0)
  assert.equal(result.active, false)
  assert.equal(result.resetContinuous, true)
  assert.equal(result.state.continuousMs, 0)
  assert.equal(result.state.activeMs, 5000)
})

test('a sampler gap is not counted and resets continuity', () => {
  let state = emptyTrackerState('2026-11-05')
  state = applySample(state, { now: 0, idleMs: 100 }, CONFIG).state
  state = applySample(state, { now: 5000, idleMs: 100 }, CONFIG).state
  const result = applySample(state, { now: 60_000, idleMs: 100 }, CONFIG)
  assert.equal(result.deltaMs, 0)
  assert.equal(result.resetContinuous, true)
  assert.equal(result.state.activeMs, 5000)
  assert.equal(result.state.continuousMs, 0)
})

test('a day rollover resets today counters', () => {
  let state = emptyTrackerState('2026-11-05')
  state = applySample(state, { now: 0, idleMs: 100 }, CONFIG).state
  state = applySample(state, { now: 5000, idleMs: 100 }, CONFIG).state
  const nextDayConfig = { ...CONFIG, dayKeyOf: () => '2026-11-06' }
  const result = applySample(state, { now: 10_000, idleMs: 100 }, nextDayConfig)
  assert.equal(result.state.dayKey, '2026-11-06')
  // The gap straddling midnight is deliberately not attributed to either day:
  // under-counting is the safe direction for a usage cap.
  assert.equal(result.state.activeMs, 0)
  assert.equal(result.state.continuousMs, 0)
  assert.equal(result.state.lastTickAt, 10_000)
})

test('idle threshold 0 disables the idle check', () => {
  const config = { ...CONFIG, idleThresholdMs: 0 }
  const result = applySample({ ...emptyTrackerState('2026-11-05'), lastTickAt: 0 }, { now: 5000, idleMs: 999_999 }, config)
  assert.equal(result.active, true)
  assert.equal(result.deltaMs, 5000)
})

function makeTracker({ usageLast = 0 } = {}) {
  let clock = 0
  const appended = []
  const settingsValue = { usage: { sampleSeconds: 5, idleThresholdSeconds: 60 } }
  const settings = { get: () => settingsValue }
  const storage = {
    readUsageMs: async () => usageLast,
    appendJsonl: async (path, record) => { appended.push({ path, record }) },
  }
  const tracker = createTracker({ storage, settings, now: () => clock })
  return { tracker, appended, get clock() { return clock }, setClock: (value) => { clock = value } }
}

test('tracker loads the accumulated total and flushes deltas', async () => {
  const { tracker, appended } = makeTracker({ usageLast: 42_000 })
  await tracker.load()
  assert.equal(tracker.snapshot(0).activeTodayMs, 42_000)
  tracker.sample(100, 0)
  tracker.sample(200, 5000)
  tracker.sample(300, 10_000)
  await tracker.flush()
  assert.equal(appended.length, 1)
  assert.equal(appended[0].record.ms, 10_000)
  assert.equal(tracker.snapshot(10_000).activeTodayMs, 52_000)
})

test('tracker flush is a no-op without pending time', async () => {
  const { tracker, appended } = makeTracker()
  await tracker.load()
  await tracker.flush()
  assert.equal(appended.length, 0)
})

test('tracker resets the continuous counter for a break', async () => {
  const { tracker } = makeTracker()
  await tracker.load()
  tracker.sample(100, 0)
  tracker.sample(100, 5000)
  assert.equal(tracker.snapshot(5000).continuousMs, 5000)
  tracker.resetContinuous()
  assert.equal(tracker.snapshot(5000).continuousMs, 0)
})
