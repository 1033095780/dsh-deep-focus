import assert from 'node:assert/strict'
import test from 'node:test'
import { createBudget, limitReason } from '../src/host/budget.js'
import { createEventRing } from '../src/host/events.js'
import { normalizeSettings } from '../src/host/settings.js'
import { EVENT, LOCK_REASON } from '../src/shared/contract.js'

test('limitReason selects the first limit over budget', () => {
  const limits = normalizeSettings({}).limits
  const usage = { activeTodayMs: 0, continuousMs: 0 }
  const focus = { phase: 'idle', elapsedMs: 0 }
  assert.equal(limitReason({ limits, usage, focus }), null)
  assert.equal(limitReason({ limits, usage: { ...usage, activeTodayMs: limits.dailyActiveMinutes * 60_000 }, focus }), LOCK_REASON.daily)
  assert.equal(limitReason({ limits, usage: { ...usage, continuousMs: limits.continuousWorkMinutes * 60_000 }, focus }), LOCK_REASON.continuous)
  assert.equal(limitReason({ limits, usage, focus: { phase: 'work', elapsedMs: limits.sessionMinutes * 60_000 } }), LOCK_REASON.session)
  assert.equal(limitReason({ limits: { dailyActiveMinutes: 0, continuousWorkMinutes: 0, sessionMinutes: 0 }, usage: { activeTodayMs: 10 ** 9, continuousMs: 10 ** 9 }, focus: { phase: 'work', elapsedMs: 10 ** 9 } }), null)
})

function makeBudget({ limits = {}, nowValue = 0 } = {}) {
  let clock = nowValue
  let hasPassword = false
  let password = null
  let settingsValue = normalizeSettings({ limits })
  const settings = {
    get: () => settingsValue,
    hasPassword: () => hasPassword,
    verifyPassword: async (candidate) => candidate === password,
  }
  const usage = { activeTodayMs: 0, continuousMs: 0 }
  const tracker = {
    snapshot: () => usage,
    resetContinuous: () => { usage.continuousMs = 0 },
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
    setClock(value) { clock = value },
    get clock() { return clock },
    setSettings(patch) { settingsValue = normalizeSettings({ limits: { ...settingsValue.limits, ...patch } }) },
    setPassword(value) { password = value; hasPassword = value !== null },
    events: () => ring.list().map((event) => event.kind),
  }
}

test('nothing is locked below every limit', () => {
  const env = makeBudget()
  const view = env.budget.evaluate(0)
  assert.equal(view.locked, false)
  assert.equal(view.reason, null)
  assert.equal(view.canUnlock, false)
})

test('the daily cap locks the app and emits exactly one locked event', () => {
  const env = makeBudget()
  env.usage.activeTodayMs = normalizeSettings({}).limits.dailyActiveMinutes * 60_000
  let view = env.budget.evaluate(1000)
  assert.equal(view.locked, true)
  assert.equal(view.reason, LOCK_REASON.daily)
  assert.equal(env.events().filter((kind) => kind === EVENT.locked).length, 1)
  view = env.budget.evaluate(2000)
  assert.equal(view.locked, true)
  assert.equal(env.events().filter((kind) => kind === EVENT.locked).length, 1)
})

test('an over-limit warning fires before the hard lock', () => {
  const env = makeBudget()
  const limits = normalizeSettings({}).limits
  env.usage.activeTodayMs = Math.ceil(limits.dailyActiveMinutes * 60_000 * 0.85)
  const view = env.budget.evaluate(0)
  assert.equal(view.locked, false)
  assert.equal(env.events().filter((kind) => kind === EVENT.limitWarning).length, 1)
})

test('continuous and session limits lock independently', () => {
  const env = makeBudget()
  const limits = normalizeSettings({}).limits
  env.usage.continuousMs = limits.continuousWorkMinutes * 60_000
  assert.equal(env.budget.evaluate(0).reason, LOCK_REASON.continuous)
  env.usage.continuousMs = 0
  env.focus.view = { phase: 'work', elapsedMs: limits.sessionMinutes * 60_000 }
  assert.equal(env.budget.evaluate(1000).reason, LOCK_REASON.session)
})

test('a password unlock grants the grace window and counts once', async () => {
  const env = makeBudget()
  env.setPassword('secret123')
  env.usage.activeTodayMs = normalizeSettings({}).limits.dailyActiveMinutes * 60_000
  env.budget.evaluate(1000)
  assert.equal(env.budget.getView(1000).canUnlock, true)
  assert.deepEqual(await env.budget.unlock({ password: 'wrong' }), { ok: false, code: 'bad-password' })
  const unlocked = await env.budget.unlock({ password: 'secret123' })
  assert.equal(unlocked.ok, true)
  const view = env.budget.getView(1000)
  assert.equal(view.locked, false)
  assert.equal(view.reason, LOCK_REASON.daily)
  assert.equal(view.unlockCountToday, 1)
  assert.ok(view.unlockUntil > 1000)
  assert.ok(env.events().includes(EVENT.unlocked))
  assert.ok(env.stats.some((record) => record.kind === 'unlock' && record.mode === 'password'))
})

test('the grace window expires and the app re-locks with a new event', async () => {
  const env = makeBudget()
  env.setPassword('secret123')
  env.usage.activeTodayMs = normalizeSettings({}).limits.dailyActiveMinutes * 60_000
  env.budget.evaluate(1000)
  await env.budget.unlock({ password: 'secret123' })
  const unlockUntil = env.budget.getView(1000).unlockUntil
  env.setClock(unlockUntil + 1000)
  const view = env.budget.evaluate(unlockUntil + 1000)
  assert.equal(view.locked, true)
  assert.equal(env.events().filter((kind) => kind === EVENT.locked).length, 2)
})

test('the daily unlock limit is enforced', async () => {
  const env = makeBudget({ limits: { dailyUnlockLimit: 1 } })
  env.setPassword('secret123')
  env.usage.activeTodayMs = normalizeSettings({}).limits.dailyActiveMinutes * 60_000
  env.budget.evaluate(1000)
  await env.budget.unlock({ password: 'secret123' })
  const unlockUntil = env.budget.getView(1000).unlockUntil
  env.setClock(unlockUntil + 1000)
  env.budget.evaluate(unlockUntil + 1000)
  assert.equal(env.budget.getView(unlockUntil + 1000).canUnlock, false)
  assert.deepEqual(await env.budget.unlock({ password: 'secret123' }), { ok: false, code: 'limit-reached' })
})

test('strict mode refuses password unlocks but allows resting', async () => {
  const env = makeBudget({ limits: { strictNoUnlock: true } })
  env.setPassword('secret123')
  env.usage.continuousMs = normalizeSettings({}).limits.continuousWorkMinutes * 60_000
  const locked = env.budget.evaluate(1000)
  assert.equal(locked.locked, true)
  assert.equal(locked.strict, true)
  assert.equal(locked.canUnlock, false)
  assert.deepEqual(await env.budget.unlock({ password: 'secret123' }), { ok: false, code: 'strict' })
  const rest = env.budget.restUnlock()
  assert.equal(rest.ok, true)
  assert.equal(env.budget.getView(1000).locked, false)
  assert.equal(env.usage.continuousMs, 0)
  assert.equal(env.budget.evaluate(1000).locked, false)
})

test('unlocking needs a configured password', async () => {
  const env = makeBudget()
  env.usage.activeTodayMs = normalizeSettings({}).limits.dailyActiveMinutes * 60_000
  env.budget.evaluate(0)
  assert.equal(env.budget.getView(0).canUnlock, false)
  assert.deepEqual(await env.budget.unlock({ password: 'x' }), { ok: false, code: 'no-password' })
})

test('resting clears a continuous lock without a password', () => {
  const env = makeBudget()
  env.usage.continuousMs = normalizeSettings({}).limits.continuousWorkMinutes * 60_000
  env.budget.evaluate(0)
  const rest = env.budget.restUnlock()
  assert.equal(rest.ok, true)
  assert.equal(env.usage.continuousMs, 0)
  assert.equal(env.budget.evaluate(0).locked, false)
})

test('unlock is rejected when nothing is locked', async () => {
  const env = makeBudget()
  assert.deepEqual(await env.budget.unlock({ password: 'x' }), { ok: false, code: 'not-locked' })
  assert.deepEqual(env.budget.restUnlock(), { ok: false, code: 'not-locked' })
})
