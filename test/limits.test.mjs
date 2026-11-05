import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventRing } from '../src/host/events.js'
import { createLimits, LIMITS_FILE } from '../src/host/limits.js'
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
    setSettings(patch) { settingsValue = normalizeSettings(patch) },
    events: () => ring.list().map((event) => event.kind),
  }
}

test('defaults: assistant on, 3h daily, 30min continuous, 10min rest, 2 extends', () => {
  const env = makeLimits()
  const view = env.limits.evaluate(BASE)
  assert.deepEqual(Object.keys(view).sort(), [
    'assistantEnabled', 'continuousLimitMs', 'continuousUsedMs', 'dailyLimitMs', 'dailyLocked', 'dailyUsedMs',
    'extendCountToday', 'extendLimit', 'extendedUntil', 'restDue', 'restRemainingMs', 'restUntil', 'resting',
  ])
  assert.equal(view.assistantEnabled, true)
  assert.equal(view.dailyLimitMs, 180 * 60_000)
  assert.equal(view.continuousLimitMs, 30 * 60_000)
  assert.equal(view.extendLimit, 2)
  assert.equal(view.dailyLocked, false)
  assert.equal(view.resting, false)
  assert.equal(view.restUntil, null)
  assert.equal(view.restRemainingMs, 0)
  assert.equal(view.restDue, false)
})

test('80% continuous usage emits rest-due once and flags the warning', () => {
  const env = makeLimits()
  env.usage.continuousMs = 25 * 60_000
  const view = env.limits.evaluate(BASE)
  assert.equal(view.restDue, true)
  assert.equal(env.events().filter((kind) => kind === EVENT.restDue).length, 1)
  env.limits.evaluate(BASE + 1000)
  assert.equal(env.events().filter((kind) => kind === EVENT.restDue).length, 1)
})

test('the continuous cap starts a forced rest immediately', () => {
  const env = makeLimits()
  env.usage.continuousMs = 30 * 60_000
  const view = env.limits.evaluate(BASE)
  assert.equal(view.resting, true)
  assert.equal(view.restUntil, BASE + 10 * 60_000)
  assert.equal(view.restRemainingMs, 10 * 60_000)
  assert.equal(view.continuousUsedMs, 0)
  assert.equal(env.tracker.resets, 1)
  const started = env.ring.list().filter((event) => event.kind === EVENT.restStarted).at(-1)
  assert.deepEqual(started.meta, { minutes: 10, reason: 'continuous' })
  // No duplicate rest while one is running.
  env.limits.evaluate(BASE + 1000)
  assert.equal(env.events().filter((kind) => kind === EVENT.restStarted).length, 1)
})

test('the rest finishes automatically and emits rest-finished', () => {
  const env = makeLimits()
  env.usage.continuousMs = 30 * 60_000
  env.limits.evaluate(BASE)
  const view = env.limits.evaluate(BASE + 10 * 60_000)
  assert.equal(view.resting, false)
  assert.equal(view.restUntil, null)
  assert.equal(view.restRemainingMs, 0)
  const finished = env.ring.list().filter((event) => event.kind === EVENT.restFinished).at(-1)
  assert.deepEqual(finished.meta, { early: false, reason: 'elapsed' })
})

test('a manual rest can be started and finished early', () => {
  const env = makeLimits()
  const started = env.limits.startRest(BASE)
  assert.equal(started.ok, true)
  assert.equal(started.view.resting, true)
  assert.equal(started.view.restRemainingMs, 10 * 60_000)
  assert.deepEqual(env.ring.list().at(-1).meta, { minutes: 10, reason: 'manual' })
  assert.deepEqual(env.limits.startRest(BASE + 1000), { ok: false, code: 'already-resting' })

  const finished = env.limits.finishRest(BASE + 1000)
  assert.equal(finished.ok, true)
  assert.equal(finished.view.resting, false)
  assert.deepEqual(env.ring.list().at(-1).meta, { early: true, reason: 'manual' })
  assert.deepEqual(env.limits.finishRest(BASE + 2000), { ok: false, code: 'not-resting' })
})

test('manual rest is refused while the assistant is off', () => {
  const env = makeLimits({ settings: { assistant: { enabled: false } } })
  assert.deepEqual(env.limits.startRest(BASE), { ok: false, code: 'assistant-off' })
})

test('the daily cap locks once and extend grants another window', () => {
  const env = makeLimits()
  env.usage.activeTodayMs = 180 * 60_000
  let view = env.limits.evaluate(BASE)
  assert.equal(view.dailyLocked, true)
  assert.equal(view.dailyUsedMs, 180 * 60_000)
  assert.equal(env.events().filter((kind) => kind === EVENT.dailyLocked).length, 1)
  env.limits.evaluate(BASE + 1000)
  assert.equal(env.events().filter((kind) => kind === EVENT.dailyLocked).length, 1)

  const extended = env.limits.extend(BASE + 1000)
  assert.equal(extended.ok, true)
  view = env.limits.getView(BASE + 1000)
  assert.equal(view.dailyLocked, false)
  assert.equal(view.extendCountToday, 1)
  assert.equal(view.extendedUntil, BASE + 1000 + 20 * 60_000)
  assert.deepEqual(env.ring.list().at(-1).meta, { minutes: 20, extendCountToday: 1, extendLimit: 2 })

  // Inside the extend window the app stays usable.
  assert.equal(env.limits.evaluate(BASE + 20 * 60_000).dailyLocked, false)
  // Then it locks again and the second extend is granted.
  view = env.limits.evaluate(BASE + 21 * 60_000)
  assert.equal(view.dailyLocked, true)
  assert.equal(env.events().filter((kind) => kind === EVENT.dailyLocked).length, 2)
  assert.equal(env.limits.extend(BASE + 21 * 60_000).ok, true)
  assert.equal(env.limits.getView(BASE + 21 * 60_000).extendCountToday, 2)

  env.limits.evaluate(BASE + 42 * 60_000)
  assert.deepEqual(env.limits.extend(BASE + 42 * 60_000), { ok: false, code: 'extend-limit-reached' })
})

test('extend is refused when not locked and when the limit is zero', () => {
  const env = makeLimits()
  assert.deepEqual(env.limits.extend(BASE), { ok: false, code: 'not-locked' })

  const noExtend = makeLimits({ settings: { limits: { dailyExtendLimit: 0 } } })
  noExtend.usage.activeTodayMs = 180 * 60_000
  noExtend.limits.evaluate(BASE)
  assert.deepEqual(noExtend.limits.extend(BASE), { ok: false, code: 'extend-limit-reached' })
})

test('the assistant switch only tracks when off and re-enables immediately', () => {
  const env = makeLimits()
  env.usage.activeTodayMs = 180 * 60_000
  env.limits.evaluate(BASE)
  assert.equal(env.limits.getView(BASE).dailyLocked, true)

  env.setSettings({ assistant: { enabled: false } })
  const off = env.limits.setAssistantEnabled(false, BASE + 1000)
  assert.equal(off.assistantEnabled, false)
  assert.equal(off.dailyLocked, false)
  assert.equal(env.events().includes(EVENT.assistantOff), true)
  // Usage keeps counting but nothing is enforced.
  assert.equal(env.limits.evaluate(BASE + 60_000).dailyLocked, false)
  assert.equal(env.limits.evaluate(BASE + 61_000).resting, false)

  env.setSettings({ assistant: { enabled: true } })
  const on = env.limits.setAssistantEnabled(true, BASE + 62_000)
  assert.equal(env.events().includes(EVENT.assistantOn), true)
  assert.equal(on.dailyLocked, true)
})

test('turning the assistant off ends a running rest', () => {
  const env = makeLimits()
  env.usage.continuousMs = 30 * 60_000
  env.limits.evaluate(BASE)
  assert.equal(env.limits.getView(BASE).resting, true)
  env.setSettings({ assistant: { enabled: false } })
  const view = env.limits.setAssistantEnabled(false, BASE + 1000)
  assert.equal(view.resting, false)
  const finished = env.ring.list().filter((event) => event.kind === EVENT.restFinished).at(-1)
  assert.deepEqual(finished.meta, { early: true, reason: 'assistant-off' })
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

test('load restores a running rest and resets stale daily counters', async () => {
  const future = BASE + 5 * 60_000
  const storage = {
    readJson: async (path) => {
      assert.equal(path, LIMITS_FILE)
      return {
        dayKey: '2026-11-05',
        resting: true,
        restUntil: future,
        restStartedAt: BASE,
        dailyLocked: true,
        lockedSince: BASE,
        extendedUntil: BASE + 60_000,
        extendCountToday: 2,
      }
    },
    writeJson: async () => {},
  }
  const env = makeLimits({ storage })
  await env.limits.load()
  assert.equal(env.limits.getView(BASE).resting, true)
  assert.equal(env.limits.getView(BASE).restUntil, future)

  const stale = makeLimits({
    storage: {
      readJson: async () => ({ dayKey: '2026-11-04', resting: false, restUntil: BASE - 1000, extendCountToday: 2 }),
      writeJson: async () => {},
    },
  })
  await stale.limits.load()
  const view = stale.limits.getView(BASE)
  assert.equal(view.resting, false)
  assert.equal(view.extendCountToday, 0)
})

test('usage.continuousMs and limit.continuousUsedMs stay aligned', () => {
  const env = makeLimits()
  env.usage.continuousMs = 12 * 60_000
  const view = env.limits.evaluate(BASE)
  assert.equal(view.continuousUsedMs, 12 * 60_000)
})

test('a daily lock does not stack a forced rest on top of it', () => {
  const env = makeLimits()
  env.usage.activeTodayMs = 180 * 60_000
  env.usage.continuousMs = 30 * 60_000
  const view = env.limits.evaluate(BASE)
  assert.equal(view.dailyLocked, true)
  assert.equal(view.resting, false)
  assert.equal(env.events().filter((kind) => kind === EVENT.restStarted).length, 0)
})
