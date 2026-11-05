import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventRing, createStatusMap, installHostEventListeners } from '../src/host/events.js'
import { normalizeSettings } from '../src/host/settings.js'
import { EVENT } from '../src/shared/contract.js'

test('the event ring increments, copies and caps', () => {
  let clock = 100
  const ring = createEventRing({ size: 3, now: () => clock })
  const first = ring.emit(EVENT.focusStarted, { task: 'a' })
  clock += 10
  ring.emit(EVENT.focusCompleted, {})
  ring.emit(EVENT.breakCompleted, {})
  ring.emit(EVENT.taskCompleted, {})
  const list = ring.list()
  assert.equal(list.length, 3)
  assert.equal(list[0].kind, EVENT.focusCompleted)
  assert.equal(list[2].kind, EVENT.taskCompleted)
  assert.ok(first.seq < list[2].seq)
  assert.equal(ring.lastSeq(), list[2].seq)
  list[0].meta.injected = true
  assert.equal(ring.list()[0].meta.injected, undefined)
})

test('the ring sequence survives a "restart" without repeating numbers', () => {
  const first = createEventRing({ now: () => 1000 })
  first.emit(EVENT.focusStarted)
  const second = createEventRing({ now: () => 2000 })
  const event = second.emit(EVENT.focusStarted)
  assert.ok(event.seq > first.lastSeq())
})

test('the status map tracks running agents', () => {
  const statusMap = createStatusMap()
  assert.equal(statusMap.isRunning('a'), false)
  statusMap.set('a', true)
  statusMap.set('b', false)
  statusMap.set('c', true)
  assert.equal(statusMap.isRunning('a'), true)
  assert.deepEqual(statusMap.runningIds(), ['a', 'c'])
  statusMap.delete('a')
  assert.equal(statusMap.isRunning('a'), false)
  statusMap.set(undefined, true)
})

function makeHarness() {
  const handlers = new Map()
  const ctx = {
    handlers,
    on(name, listener) {
      handlers.set(name, listener)
      return () => handlers.delete(name)
    },
  }
  let settingsValue = normalizeSettings({ alerts: { taskDone: true, turnDone: false } })
  const settings = { get: () => settingsValue }
  const completed = []
  const stops = []
  const focus = {
    isBoundTo: (id) => id === 'focus-session',
    isActive: () => true,
    complete: (cause) => completed.push(cause),
    stop: (reason) => stops.push(reason),
  }
  let clock = 0
  const ring = createEventRing({ now: () => clock })
  const statusMap = createStatusMap()
  const dispose = installHostEventListeners({ ctx, ring, focus, settings, statusMap })
  return {
    handlers,
    completed,
    stops,
    ring,
    statusMap,
    dispose,
    setSettings(patch) { settingsValue = normalizeSettings(patch) },
    lastEvent: () => ring.list().at(-1),
  }
}

test('goal completion completes a bound focus session', () => {
  const harness = makeHarness()
  harness.handlers.get('goal/changed')({
    agent: { id: 'focus-session' },
    change: { operation: 'complete', goal: { objective: 'ship it' } },
  })
  assert.deepEqual(harness.completed, ['goal'])
  assert.equal(harness.ring.list().length, 0)
})

test('goal completion elsewhere becomes a task-completed event when enabled', () => {
  const harness = makeHarness()
  harness.handlers.get('goal/changed')({
    agent: { id: 'other-session' },
    change: { operation: 'complete', goal: { objective: 'ship it' } },
  })
  const event = harness.lastEvent()
  assert.equal(event.kind, EVENT.taskCompleted)
  assert.equal(event.meta.source, 'goal')
  assert.equal(event.meta.sessionId, 'other-session')
  assert.equal(event.meta.task, 'ship it')
  harness.setSettings({ alerts: { taskDone: false } })
  harness.handlers.get('goal/changed')({
    agent: { id: 'third-session' },
    change: { operation: 'complete', goal: { objective: 'nope' } },
  })
  assert.equal(harness.ring.list().length, 1)
})

test('turn completion alerts follow the turnDone setting', () => {
  const harness = makeHarness()
  const payload = { id: 'session-x' }
  const event = { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } }
  harness.handlers.get('session/event')(payload, event)
  assert.equal(harness.ring.list().length, 0)
  harness.setSettings({ alerts: { turnDone: true } })
  harness.handlers.get('session/event')(payload, event)
  assert.equal(harness.lastEvent().kind, EVENT.taskCompleted)
  assert.equal(harness.lastEvent().meta.source, 'turn')
  harness.handlers.get('session/event')(payload, { type: 'turn/end', data: { turn: 3, reason: { kind: 'aborted' } } })
  assert.equal(harness.ring.list().length, 1)
})

test('agent status and disposal update the status map', () => {
  const harness = makeHarness()
  harness.handlers.get('agent/status')({ agent: { id: 'a' }, status: 'running' })
  harness.handlers.get('agent/status')({ agent: { id: 'b' }, status: 'idle' })
  assert.deepEqual(harness.statusMap.runningIds(), ['a'])
  harness.handlers.get('agent/disposed')({ agent: { id: 'a' } })
  assert.deepEqual(harness.statusMap.runningIds(), [])
})

test('disposing the focused owner stops the focus block', () => {
  const harness = makeHarness()
  harness.handlers.get('agent/disposed')({ agent: { id: 'focus-session' } })
  assert.deepEqual(harness.stops, ['owner-disposed'])
  harness.handlers.get('agent/disposed')({ agent: { id: 'other-session' } })
  assert.deepEqual(harness.stops, ['owner-disposed'])
})

test('the agent/disposed listener is removed on unload', () => {
  const harness = makeHarness()
  assert.equal(harness.handlers.has('agent/disposed'), true)
  harness.dispose()
  assert.equal(harness.handlers.has('agent/disposed'), false)
})

test('the disposer removes every listener', () => {
  const harness = makeHarness()
  assert.ok(harness.handlers.size > 0)
  harness.dispose()
  assert.equal(harness.handlers.size, 0)
})
