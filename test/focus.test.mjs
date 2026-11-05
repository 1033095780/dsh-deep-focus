import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventRing } from '../src/host/events.js'
import { createFocus, FOCUS_FILE, STATUS } from '../src/host/focus.js'
import { normalizeSettings } from '../src/host/settings.js'
import { localDayKey } from '../src/host/storage.js'
import { EVENT, PHASE } from '../src/shared/contract.js'

function makeFocus({ settings = {}, storage = null, startAt = 0 } = {}) {
  let clock = startAt
  const stats = []
  const ring = createEventRing({ now: () => clock })
  let settingsValue = normalizeSettings(settings)
  const settingsStore = { get: () => settingsValue }
  const focus = createFocus({
    settings: settingsStore,
    ring,
    storage,
    now: () => clock,
    onStat: (record) => stats.push(record),
  })
  return {
    focus,
    ring,
    stats,
    get clock() { return clock },
    setClock(value) { clock = value },
    advance(ms) { clock += ms },
    setSettings(patch) { settingsValue = normalizeSettings(patch) },
    events: () => ring.list().map((event) => event.kind),
    tickFor(ms, step = 1000) {
      let remaining = ms
      while (remaining > 0) {
        const delta = Math.min(step, remaining)
        clock += delta
        focus.tick(clock)
        remaining -= delta
      }
    },
  }
}

test('starting a focus session binds phase, session and deadline', () => {
  const { focus } = makeFocus()
  const result = focus.start({ task: 'write tests', sessionId: 'session-a', workMinutes: 25 })
  assert.equal(result.ok, true)
  const view = focus.getView(0)
  assert.equal(view.phase, PHASE.work)
  assert.equal(view.status, STATUS.running)
  assert.equal(view.sessionId, 'session-a')
  assert.equal(view.task, 'write tests')
  assert.equal(view.remainingMs, 25 * 60_000)
  assert.equal(focus.isBoundTo('session-a'), true)
  assert.equal(focus.isActive(), true)
  assert.deepEqual(focus.start({ sessionId: 'session-b' }), { ok: false, code: 'already-running' })
})

test('ticks accumulate elapsed time', () => {
  const env = makeFocus()
  env.focus.start({ sessionId: 'session-a', workMinutes: 25 })
  env.tickFor(5000)
  assert.equal(env.focus.getView(env.clock).elapsedMs, 5000)
})

test('a work block finishing naturally starts the break', () => {
  const env = makeFocus()
  env.focus.start({ sessionId: 'session-a', workMinutes: 1 })
  env.tickFor(60_000)
  const view = env.focus.getView(env.clock)
  assert.equal(view.phase, PHASE.break)
  assert.equal(view.status, STATUS.running)
  assert.equal(view.pomodorosToday, 1)
  assert.ok(env.events().includes(EVENT.focusCompleted))
  assert.ok(env.stats.some((record) => record.kind === 'pomodoro'))
})

test('autoStartBreak false returns to idle after work', () => {
  const env = makeFocus({ settings: { focus: { autoStartBreak: false } } })
  env.focus.start({ sessionId: 'session-a', workMinutes: 1 })
  env.tickFor(60_000)
  assert.equal(env.focus.getView(env.clock).phase, PHASE.idle)
  assert.equal(env.focus.getView(env.clock).sessionId, null)
})

test('a break finishing logs the event and starts the next round when configured', () => {
  const env = makeFocus({ settings: { focus: { workMinutes: 1, breakMinutes: 1, autoStartNext: true } } })
  env.focus.start({ sessionId: 'session-a', workMinutes: 1 })
  env.tickFor(60_000)
  assert.equal(env.focus.getView(env.clock).phase, PHASE.break)
  env.tickFor(60_000)
  const view = env.focus.getView(env.clock)
  assert.equal(view.phase, PHASE.work)
  assert.equal(view.status, STATUS.running)
  assert.equal(view.sessionId, 'session-a')
  assert.ok(env.events().includes(EVENT.breakCompleted))
  assert.equal(env.events().filter((kind) => kind === EVENT.focusStarted).length, 2)
})

test('pause freezes elapsed time and resume keeps the remaining time', () => {
  const env = makeFocus()
  env.focus.start({ sessionId: 'session-a', workMinutes: 25 })
  env.tickFor(5000)
  assert.equal(env.focus.pause().ok, true)
  const paused = env.focus.getView(env.clock)
  assert.equal(paused.status, STATUS.paused)
  assert.equal(paused.endsAt, null)
  assert.equal(paused.remainingMs, 25 * 60_000 - 5000)
  assert.equal(env.focus.getView(env.clock).elapsedMs, 5000)
  env.tickFor(10_000)
  assert.equal(env.focus.getView(env.clock).elapsedMs, 5000)
  assert.equal(env.focus.resume().ok, true)
  const resumed = env.focus.getView(env.clock)
  assert.equal(resumed.status, STATUS.running)
  assert.equal(resumed.remainingMs, 25 * 60_000 - 5000)
  assert.deepEqual(env.focus.pause(), { ok: true })
  assert.deepEqual(env.focus.pause(), { ok: false, code: 'not-running' })
})

test('idle activity auto-pauses and returning auto-resumes', () => {
  const env = makeFocus({ settings: { focus: { idlePauseSeconds: 120, autoResumeOnReturn: true } } })
  env.focus.start({ sessionId: 'session-a', workMinutes: 25 })
  env.focus.applyActivity({ active: false, idleMs: 130_000 }, env.clock)
  assert.equal(env.focus.getView(env.clock).status, STATUS.paused)
  assert.equal(env.focus.getView(env.clock).pauseCause, 'idle')
  env.focus.applyActivity({ active: true, idleMs: 1000 }, env.clock)
  assert.equal(env.focus.getView(env.clock).status, STATUS.running)
})

test('idle auto-pause can be disabled', () => {
  const env = makeFocus({ settings: { focus: { idlePauseSeconds: 0 } } })
  env.focus.start({ sessionId: 'session-a', workMinutes: 25 })
  env.focus.applyActivity({ active: false, idleMs: 600_000 }, env.clock)
  assert.equal(env.focus.getView(env.clock).status, STATUS.running)
})

test('manual complete ends work early and emits task-completed', () => {
  const env = makeFocus()
  env.focus.start({ sessionId: 'session-a', task: 'x', workMinutes: 25 })
  env.tickFor(5000)
  assert.equal(env.focus.complete('user').ok, true)
  assert.ok(env.events().includes(EVENT.taskCompleted))
  assert.equal(env.focus.getView(env.clock).phase, PHASE.break)
  assert.equal(env.focus.getView(env.clock).pomodorosToday, 1)
})

test('stop returns to idle and emits focus-stopped', () => {
  const env = makeFocus()
  env.focus.start({ sessionId: 'session-a', workMinutes: 25 })
  env.tickFor(5000)
  assert.equal(env.focus.stop('user').ok, true)
  const view = env.focus.getView(env.clock)
  assert.equal(view.phase, PHASE.idle)
  assert.equal(view.status, STATUS.idle)
  assert.equal(view.sessionId, null)
  assert.ok(env.events().includes(EVENT.focusStopped))
})

test('every fourth work block gets the long break', () => {
  const env = makeFocus({ settings: { focus: { workMinutes: 1, breakMinutes: 1, longBreakEvery: 4, longBreakMinutes: 15 } } })
  for (let index = 0; index < 4; index += 1) {
    env.focus.start({ sessionId: 'session-a', workMinutes: 1 })
    env.tickFor(60_000)
    assert.equal(env.focus.getView(env.clock).phase, PHASE.break)
    if (index < 3) {
      env.tickFor(60_000)
    }
  }
  const view = env.focus.getView(env.clock)
  assert.equal(view.phase, PHASE.break)
  assert.ok(view.remainingMs > 14 * 60_000, `expected a long break, got ${view.remainingMs}ms`)
  assert.ok(view.remainingMs <= 15 * 60_000)
})

test('the daily pomodoro count resets after midnight', () => {
  const start = new Date(2026, 10, 5, 23, 0, 0).getTime()
  const env = makeFocus({ startAt: start })
  env.focus.start({ sessionId: 'session-a', workMinutes: 1 })
  env.tickFor(60_000)
  assert.equal(env.focus.getView(env.clock).pomodorosToday, 1)
  env.setClock(new Date(2026, 10, 6, 0, 30, 0).getTime())
  env.focus.tick(env.clock)
  assert.equal(env.focus.getView(env.clock).pomodorosToday, 0)
})

test('load settles a session whose deadline already passed, exactly once', async () => {
  const written = []
  const document = {
    phase: 'work',
    status: 'running',
    sessionId: 'session-a',
    task: 'restored',
    startedAt: -60_000,
    endsAt: 1000,
    remainingMs: 0,
    elapsedMs: 59_000,
    pomodorosToday: 2,
    cycleCount: 1,
    dayKey: localDayKey(0),
    savedAt: 0,
  }
  const storage = {
    readJson: async (path) => {
      assert.equal(path, FOCUS_FILE)
      return document
    },
    writeJson: async (path, value) => { written.push({ path, value }) },
  }
  const env = makeFocus({ storage })
  await env.focus.load()
  assert.equal(env.focus.getView(0).status, STATUS.running)
  env.tickFor(1000)
  assert.equal(env.events().filter((kind) => kind === EVENT.focusCompleted).length, 1)
  assert.equal(env.focus.getView(env.clock).pomodorosToday, 3)
  env.tickFor(2000)
  assert.equal(env.events().filter((kind) => kind === EVENT.focusCompleted).length, 1)
  await env.focus.flush()
  assert.ok(written.length > 0)
  assert.equal(written[0].path, FOCUS_FILE)
})

test('load restores a paused session with its remaining time', async () => {
  const storage = {
    readJson: async () => ({
      phase: 'work',
      status: 'paused',
      sessionId: 'session-a',
      task: 'paused',
      startedAt: 0,
      endsAt: null,
      remainingMs: 5000,
      elapsedMs: 20_000,
      pomodorosToday: 0,
      cycleCount: 0,
      dayKey: localDayKey(0),
      savedAt: 0,
    }),
    writeJson: async () => {},
  }
  const env = makeFocus({ storage })
  await env.focus.load()
  const view = env.focus.getView(0)
  assert.equal(view.status, STATUS.paused)
  assert.equal(view.remainingMs, 5000)
  assert.equal(env.focus.resume().ok, true)
  assert.equal(env.focus.getView(env.clock).remainingMs, 5000)
})

test('load ignores a corrupt document and starts idle', async () => {
  const storage = { readJson: async () => ({ phase: 'nonsense', status: 'weird' }), writeJson: async () => {} }
  const env = makeFocus({ storage })
  await env.focus.load()
  assert.equal(env.focus.getView(0).phase, PHASE.idle)
})
