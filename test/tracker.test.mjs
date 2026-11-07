import assert from 'node:assert/strict'
import test from 'node:test'
import { applySample, createTracker, emptyTrackerState, FLUSH_INTERVAL_MS } from '../src/host/tracker.js'

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
  state = applySample(state, { now: 0, idleMs: 100 }, CONFIG).state
  state = applySample(state, { now: 5000, idleMs: 200 }, CONFIG).state
  const result = applySample(state, { now: 10_000, idleMs: 300 }, CONFIG)
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

function makeTracker({ usageLast = null, trackApps = true, limits = null } = {}) {
  let clock = 0
  const appended = []
  const settingsValue = {
    usage: { sampleSeconds: 5, idleThresholdSeconds: 60, trackApps },
    ...(limits === null ? {} : { limits }),
  }
  const settings = { get: () => settingsValue }
  const storage = {
    readUsageDay: async () => usageLast ?? { activeMs: 0, apps: new Map() },
    appendJsonl: async (path, record) => { appended.push({ path, record }) },
  }
  const tracker = createTracker({ storage, settings, now: () => clock })
  return {
    tracker,
    appended,
    get clock() { return clock },
    setClock(value) { clock = value },
    advance(ms) { clock += ms },
    settingsValue,
  }
}

test('tracker loads accumulated totals and per-app usage', async () => {
  const { tracker } = makeTracker({ usageLast: { activeMs: 42_000, apps: new Map([['chrome', 42_000]]) } })
  await tracker.load()
  const snapshot = tracker.snapshot(0)
  assert.equal(snapshot.activeTodayMs, 42_000)
  assert.equal(snapshot.apps.get('chrome'), 42_000)
})

test('samples accumulate per-app usage for active time only', () => {
  const { tracker } = makeTracker()
  tracker.sample({ idleMs: 100, app: 'chrome' }, 0)
  tracker.sample({ idleMs: 200, app: 'chrome' }, 5000)
  tracker.sample({ idleMs: 200, app: 'code' }, 10_000)
  // Idle sample: no active time and no app credit.
  tracker.sample({ idleMs: 120_000, app: 'vlc' }, 15_000)
  const snapshot = tracker.snapshot(15_000)
  assert.equal(snapshot.activeTodayMs, 10_000)
  assert.equal(snapshot.continuousMs, 0)
  assert.equal(snapshot.apps.get('chrome'), 5000)
  assert.equal(snapshot.apps.get('code'), 5000)
  assert.equal(snapshot.apps.get('vlc'), undefined)
})

test('the app sampler is skipped when trackApps is off', () => {
  const { tracker } = makeTracker({ trackApps: false })
  tracker.sample({ idleMs: 100, app: 'chrome' }, 0)
  tracker.sample({ idleMs: 200, app: 'chrome' }, 5000)
  const snapshot = tracker.snapshot(5000)
  assert.equal(snapshot.activeTodayMs, 5000)
  assert.equal(snapshot.apps.size, 0)
})

test('flush writes one aggregate line and keeps the running totals', async () => {
  const { tracker, appended } = makeTracker()
  tracker.sample({ idleMs: 100, app: 'chrome' }, 0)
  tracker.sample({ idleMs: 200, app: 'chrome' }, 5000)
  tracker.sample({ idleMs: 200, app: 'code' }, 10_000)
  await tracker.flush()
  assert.equal(appended.length, 1)
  assert.equal(appended[0].record.activeMs, 10_000)
  assert.deepEqual(appended[0].record.apps, { chrome: 5000, code: 5000 })
  assert.ok(appended[0].path.endsWith('.jsonl'))
  // A second flush only writes what is pending (nothing).
  await tracker.flush()
  assert.equal(appended.length, 1)
  assert.equal(tracker.snapshot(10_000).activeTodayMs, 10_000)
})

test('automatic flush happens once a minute', async () => {
  const { tracker, appended } = makeTracker()
  for (let index = 0; index <= 12; index += 1) {
    tracker.sample({ idleMs: 100, app: 'chrome' }, index * 5000)
  }
  assert.equal(FLUSH_INTERVAL_MS, 60_000)
  // The sample at 60s triggers the flush; settle the queued write.
  await tracker.flush()
  assert.ok(appended.length >= 1)
  const total = appended.reduce((sum, entry) => sum + entry.record.activeMs, 0)
  assert.equal(total, 60_000)
  assert.equal(appended[0].record.apps.chrome, 60_000)
})

test('a day rollover flushes pending usage to the previous day', async () => {
  const { tracker, appended, setClock } = makeTracker()
  tracker.sample({ idleMs: 100, app: 'chrome' }, Date.UTC(2026, 10, 5, 10, 0, 0))
  tracker.sample({ idleMs: 100, app: 'chrome' }, Date.UTC(2026, 10, 5, 10, 0, 5))
  setClock(Date.UTC(2026, 10, 6, 0, 0, 5))
  tracker.sample({ idleMs: 100, app: 'chrome' }, Date.UTC(2026, 10, 6, 0, 0, 5))
  await tracker.flush()
  assert.ok(appended.length >= 1)
  assert.equal(appended[0].record.activeMs, 5000)
  assert.ok(appended[0].path.includes('2026-11-05'))
  assert.equal(tracker.snapshot(Date.UTC(2026, 10, 6, 0, 0, 5)).activeTodayMs, 0)
})

test('suppressed samples keep the baseline but add no active or app time', () => {
  const { tracker } = makeTracker()
  tracker.sample({ idleMs: 100, app: 'chrome' }, 0)
  tracker.sample({ idleMs: 100, app: 'chrome' }, 5000)
  assert.equal(tracker.snapshot(5000).activeTodayMs, 5000)

  // A forced rest suppresses every sample: no active/app time, continuity reset.
  tracker.sample({ idleMs: 100, app: 'chrome' }, 10_000, { counted: false })
  tracker.sample({ idleMs: 100, app: 'chrome' }, 15_000, { counted: false })
  const duringRest = tracker.snapshot(15_000)
  assert.equal(duringRest.activeTodayMs, 5000)
  assert.equal(duringRest.continuousMs, 0)
  assert.equal(duringRest.apps.get('chrome'), 5000)

  // After the rest the next gap is measured from the suppressed baseline, so the
  // rest window itself is never billed.
  tracker.sample({ idleMs: 100, app: 'chrome' }, 20_000)
  const after = tracker.snapshot(20_000)
  assert.equal(after.activeTodayMs, 10_000)
  assert.equal(after.apps.get('chrome'), 10_000)
})

test('tracker resets the continuous counter for a break', async () => {
  const { tracker } = makeTracker()
  tracker.sample({ idleMs: 100 }, 0)
  tracker.sample({ idleMs: 100 }, 5000)
  assert.equal(tracker.snapshot(5000).continuousMs, 5000)
  tracker.resetContinuous()
  assert.equal(tracker.snapshot(5000).continuousMs, 0)
})


const DECAY_CONFIG = { idleThresholdMs: 60_000, maxGapMs: 20_000, dayKeyOf: () => '2026-11-05', continuousDecayRate: 2 }

test('a non-counting sample decays the continuous counter proportionally', () => {
  const state = { ...emptyTrackerState('2026-11-05'), continuousMs: 600_000, lastTickAt: 0 }
  const result = applySample(state, { now: 5000, idleMs: 120_000 }, DECAY_CONFIG)
  assert.equal(result.state.continuousMs, 590_000) // 600s - 5s * rate 2
  assert.equal(result.resetContinuous, false)
  assert.equal(result.deltaMs, 0)
})

test('decay clamps at zero and reports the reset', () => {
  const state = { ...emptyTrackerState('2026-11-05'), continuousMs: 5000, lastTickAt: 0 }
  const result = applySample(state, { now: 5000, idleMs: 120_000 }, DECAY_CONFIG)
  assert.equal(result.state.continuousMs, 0)
  assert.equal(result.resetContinuous, true)
})

test('a missing decay rate keeps the old instant-reset fallback', () => {
  const state = { ...emptyTrackerState('2026-11-05'), continuousMs: 600_000, lastTickAt: 0 }
  const config = { idleThresholdMs: 60_000, maxGapMs: 20_000, dayKeyOf: () => '2026-11-05' }
  const result = applySample(state, { now: 5000, idleMs: 120_000 }, config)
  assert.equal(result.state.continuousMs, 0)
  assert.equal(result.resetContinuous, true)
})

test('an invalid large gap still resets the continuous counter', () => {
  const state = { ...emptyTrackerState('2026-11-05'), continuousMs: 600_000, lastTickAt: 0 }
  const result = applySample(state, { now: 60_000, idleMs: 100 }, DECAY_CONFIG)
  assert.equal(result.state.continuousMs, 0)
  assert.equal(result.resetContinuous, true)
})

test('the tracker derives the decay rate from limits (20min cap / 10min rest = 2x)', async () => {
  const { tracker: t } = makeTracker({ limits: { continuousMinutes: 20, restMinutes: 10 } })
  t.sample({ idleMs: 100 }, 0)
  t.sample({ idleMs: 100 }, 5000)
  assert.equal(t.snapshot(5000).continuousMs, 5000)
  // 10s of idle at 2x removes 20s of continuous usage, clamped at 0.
  const after = t.sample({ idleMs: 120_000 }, 15_000)
  assert.equal(after.resetContinuous, true)
  assert.equal(t.snapshot(15_000).continuousMs, 0)
})
