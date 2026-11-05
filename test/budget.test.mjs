import assert from 'node:assert/strict'
import test from 'node:test'
import { createBudget, limitReason } from '../src/host/budget.js'
import { createEventRing } from '../src/host/events.js'
import { normalizeSettings } from '../src/host/settings.js'
import { EVENT, LOCK_REASON } from '../src/shared/contract.js'

test('limitReason selects the first limit over budget and ignores disabled limits', () => {
  const limits = normalizeSettings({}).limits
  const usage = { activeTodayMs: 0, continuousMs: 0 }
  const focus = { phase: 'idle', elapsedMs: 0 }
  assert.equal(limitReason({ limits, usage, focus }), null)
  const enabled = { ...limits, dailyActiveMinutes: 10, continuousWorkMinutes: 20, sessionMinutes: 30 }
  assert.equal(limitReason({ limits: enabled, usage: { ...usage, activeTodayMs: 10 * 60_000 }, focus }), LOCK_REASON.daily)
  assert.equal(limitReason({ limits: enabled, usage: { ...usage, continuousMs: 20 * 60_000 }, focus }), LOCK_REASON.continuous)
  assert.equal(limitReason({ limits: enabled, usage, focus: { phase: 'work', elapsedMs: 30 * 60_000 } }), LOCK_REASON.session)
  assert.equal(limitReason({ limits: enabled, usage: { activeTodayMs: 10 ** 9, continuousMs: 10 ** 9 }, focus: { phase: 'work', elapsedMs: 10 ** 9 } }) !== null, true)
})

function makeBudget({ limits = {}, nowValue = 0 } = {}) {
  let clock = nowValue
  let settingsValue = normalizeSettings({ limits })
  const settings = { get: () => settingsValue }
  const usage = { activeTodayMs: 0, continuousMs: 0 }
  const resets = []
  const tracker = {
    snapshot: () => usage,
    resetContinuous: () => { usage.continuousMs = 0; resets.push(true) },
  }
  const focus = { view: { phase: 'idle', elapsedMs: 0 }, getView: () => focus.view }
  const ring = createEventRing({ now: () => clock })
  const stats = []
  const budget = createBudget({
    settings,
    tracker,
    focus,
    ring,
    storage: null,
    now: () => clock,
    onStat: (record) => stats.push(record),
  })
  return {
    budget,
    ring,
    stats,
    usage,
    focus,
    resets,
    setClock(value) { clock = value },
    get clock() { return clock },
    setSettings(patch) { settingsValue = normalizeSettings({ limits: { ...settingsValue.limits, ...patch } }) },
    events: () => ring.list().map((event) => event.kind),
  }
}

test('all limits default to off', () => {
  const env = makeBudget()
  env.usage.activeTodayMs = 10 ** 9
  env.usage.continuousMs = 10 ** 9
  const view = env.budget.evaluate(0)
  assert.equal(view.locked, false)
  assert.equal(view.strict, false)
  assert.equal(view.unlockMinutes, 20)
  assert.equal(view.canUnlock, false)
})

test('the daily cap locks once and exposes the v2 lock shape', () => {
  const env = makeBudget({ limits: { dailyActiveMinutes: 1 } })
  env.usage.activeTodayMs = 60_000
  const view = env.budget.evaluate(1000)
  assert.deepEqual(Object.keys(view).sort(), ['canUnlock', 'locked', 'reason', 'since', 'strict', 'unlockMinutes', 'unlockUntil'])
  assert.equal(view.locked, true)
  assert.equal(view.reason, LOCK_REASON.daily)
  assert.equal(view.since, 1000)
  assert.equal(view.unlockUntil, null)
  assert.equal(view.canUnlock, true)
  assert.equal(view.strict, false)
  assert.equal(view.unlockMinutes, 20)
  env.budget.evaluate(2000)
  assert.equal(env.events().filter((kind) => kind === EVENT.locked).length, 1)
})

test('an over-limit warning fires before the hard lock', () => {
  const env = makeBudget({ limits: { dailyActiveMinutes: 100 } })
  env.usage.activeTodayMs = 85 * 60_000
  const view = env.budget.evaluate(0)
  assert.equal(view.locked, false)
  assert.equal(env.events().filter((kind) => kind === EVENT.limitWarning).length, 1)
})

test('continuous and session limits lock independently', () => {
  const env = makeBudget({ limits: { continuousWorkMinutes: 90, sessionMinutes: 90 } })
  env.usage.continuousMs = 90 * 60_000
  assert.equal(env.budget.evaluate(0).reason, LOCK_REASON.continuous)
  env.usage.continuousMs = 0
  env.focus.view = { phase: 'work', elapsedMs: 90 * 60_000 }
  assert.equal(env.budget.evaluate(1000).reason, LOCK_REASON.session)
})

test('one click grants unlockMinutes and clears the lock', () => {
  const env = makeBudget({ limits: { dailyActiveMinutes: 1 } })
  env.usage.activeTodayMs = 60_000
  env.setClock(1000)
  env.budget.evaluate(1000)
  const result = env.budget.unlock({ mode: 'click' })
  assert.equal(result.ok, true)
  const view = env.budget.getView(1000)
  assert.equal(view.locked, false)
  assert.equal(view.reason, LOCK_REASON.daily)
  assert.equal(view.unlockUntil, 1000 + 20 * 60_000)
  const event = env.ring.list().at(-1)
  assert.equal(event.kind, EVENT.unlocked)
  assert.equal(event.meta.mode, 'click')
  assert.equal(event.meta.minutes, 20)
  assert.ok(env.stats.some((record) => record.kind === 'unlock' && record.mode === 'click'))
})

test('the grace window expires and the app re-locks with a new event', () => {
  const env = makeBudget({ limits: { dailyActiveMinutes: 1 } })
  env.usage.activeTodayMs = 60_000
  env.budget.evaluate(1000)
  env.budget.unlock({ mode: 'click' })
  const unlockUntil = env.budget.getView(1000).unlockUntil
  env.setClock(unlockUntil + 1000)
  const view = env.budget.evaluate(unlockUntil + 1000)
  assert.equal(view.locked, true)
  assert.equal(env.events().filter((kind) => kind === EVENT.locked).length, 2)
})

test('rest unlocks and also ends the continuous-work run', () => {
  const env = makeBudget({ limits: { continuousWorkMinutes: 90 } })
  env.usage.continuousMs = 90 * 60_000
  env.budget.evaluate(0)
  assert.equal(env.budget.getView(0).locked, true)
  const result = env.budget.unlock({ mode: 'rest' })
  assert.equal(result.ok, true)
  assert.equal(env.resets.length, 1)
  assert.equal(env.usage.continuousMs, 0)
  assert.equal(env.ring.list().at(-1).meta.mode, 'rest')
  // With the counter reset, the lock does not come back after the grace window.
  assert.equal(env.budget.evaluate(0).locked, false)
})

test('the unlock duration follows the settings', () => {
  const env = makeBudget({ limits: { dailyActiveMinutes: 1, unlockMinutes: 5 } })
  env.usage.activeTodayMs = 60_000
  env.setClock(1000)
  env.budget.evaluate(1000)
  assert.equal(env.budget.getView(1000).unlockMinutes, 5)
  env.budget.unlock({ mode: 'click' })
  assert.equal(env.budget.getView(1000).unlockUntil, 1000 + 5 * 60_000)
})

test('unlock is rejected when nothing is locked', () => {
  const env = makeBudget()
  assert.deepEqual(env.budget.unlock({ mode: 'click' }), { ok: false, code: 'not-locked' })
})

test('a day rollover clears the lock', () => {
  const start = new Date(2026, 10, 5, 23, 0, 0).getTime()
  const env = makeBudget({ limits: { dailyActiveMinutes: 1 }, nowValue: start })
  env.usage.activeTodayMs = 10 ** 9
  assert.equal(env.budget.evaluate(start).locked, true)
  env.setClock(start + 2 * 3_600_000)
  // A new day starts with today's counters at zero.
  env.usage.activeTodayMs = 0
  const view = env.budget.evaluate(start + 2 * 3_600_000)
  assert.equal(view.locked, false)
  assert.equal(view.reason, null)
  assert.equal(view.since, null)
})
