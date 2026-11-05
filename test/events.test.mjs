import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventRing, createStatusMap, installHostEventListeners } from '../src/host/events.js'
import { EVENT } from '../src/shared/contract.js'

test('the event ring increments, copies and caps', () => {
  let clock = 100
  const ring = createEventRing({ size: 3, now: () => clock })
  const first = ring.emit(EVENT.restStarted, { minutes: 10 })
  clock += 10
  ring.emit(EVENT.restFinished, {})
  ring.emit(EVENT.dailyLocked, {})
  ring.emit(EVENT.extended, {})
  const list = ring.list()
  assert.equal(list.length, 3)
  assert.equal(list[0].kind, EVENT.restFinished)
  assert.equal(list[2].kind, EVENT.extended)
  assert.ok(first.seq < list[2].seq)
  assert.equal(ring.lastSeq(), list[2].seq)
  list[0].meta.injected = true
  assert.equal(ring.list()[0].meta.injected, undefined)
})

test('the ring sequence survives a "restart" without repeating numbers', () => {
  const first = createEventRing({ now: () => 1000 })
  first.emit(EVENT.restStarted)
  const second = createEventRing({ now: () => 2000 })
  assert.ok(second.emit(EVENT.restStarted).seq > first.lastSeq())
})

test('the status map tracks running agents', () => {
  const statusMap = createStatusMap()
  assert.equal(statusMap.isRunning('a'), false)
  statusMap.set('a', true)
  statusMap.set('b', false)
  statusMap.set('c', true)
  assert.equal(statusMap.isRunning('a'), true)
  assert.deepEqual(statusMap.runningIds(), ['a', 'c'])
  assert.equal(statusMap.startedAt('a') !== null, true)
  statusMap.set('a', true, 4242)
  assert.equal(statusMap.startedAt('a'), 4242)
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
  let clock = 0
  const ring = createEventRing({ now: () => clock })
  const statusMap = createStatusMap()
  const rootIds = new Set(['root-1'])
  const dispose = installHostEventListeners({
    ctx,
    ring,
    statusMap,
    isRootSession: (sessionId) => rootIds.has(sessionId),
  })
  return {
    handlers,
    ring,
    statusMap,
    dispose,
    lastEvent: () => ring.list().at(-1),
  }
}

test('turn completion alerts only for root conversations', () => {
  const harness = makeHarness()
  harness.handlers.get('session/event')({ id: 'root-1' }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  const event = harness.lastEvent()
  assert.equal(event.kind, EVENT.taskCompleted)
  assert.deepEqual(event.meta, { source: 'turn', sessionId: 'root-1', turn: 2 })

  // A background subagent turn must not ring the user's completion chime.
  harness.handlers.get('session/event')({ id: 'subagent-7' }, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } })
  assert.equal(harness.ring.list().length, 1)

  // Root but not a completed turn: no alert.
  harness.handlers.get('session/event')({ id: 'root-1' }, { type: 'turn/end', data: { turn: 4, reason: { kind: 'aborted' } } })
  assert.equal(harness.ring.list().length, 1)
})

test('goal completion becomes a task-completed alert', () => {
  const harness = makeHarness()
  harness.handlers.get('goal/changed')({
    agent: { id: 'session-y' },
    change: { operation: 'complete', goal: { objective: 'ship it' } },
  })
  const event = harness.lastEvent()
  assert.equal(event.kind, EVENT.taskCompleted)
  assert.deepEqual(event.meta, { source: 'goal', sessionId: 'session-y', task: 'ship it' })
})

test('api-session/status is the primary running-state source', () => {
  const harness = makeHarness()
  harness.handlers.get('api-session/status')('session-a', true)
  assert.equal(harness.statusMap.isRunning('session-a'), true)
  assert.equal(Number.isFinite(harness.statusMap.startedAt('session-a')), true)
  harness.handlers.get('api-session/status')('session-a', false)
  assert.equal(harness.statusMap.isRunning('session-a'), false)
  harness.handlers.get('api-session/status')('', true)
  assert.deepEqual(harness.statusMap.runningIds(), [])
})

test('api-session/added upserts the current running state', () => {
  const harness = makeHarness()
  harness.handlers.get('api-session/added')({ sessionId: 'session-a', running: true })
  assert.equal(harness.statusMap.isRunning('session-a'), true)
  harness.handlers.get('api-session/added')({ sessionId: 'session-a', running: false })
  assert.equal(harness.statusMap.isRunning('session-a'), false)
  harness.handlers.get('api-session/added')({ sessionId: '', running: true })
  assert.deepEqual(harness.statusMap.runningIds(), [])
})

test('durable turn boundaries update the running state independently', () => {
  const harness = makeHarness()
  harness.handlers.get('session/event')({ id: 'session-b' }, { type: 'turn/start', time: 500, data: { turn: 1 } })
  assert.equal(harness.statusMap.isRunning('session-b'), true)
  assert.equal(harness.statusMap.startedAt('session-b'), 500)
  harness.handlers.get('session/event')({ id: 'session-b' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'blocked' } } })
  assert.equal(harness.statusMap.isRunning('session-b'), false)
  assert.equal(harness.ring.list().length, 0)

  // A completed root turn clears its status and emits the completion alert.
  harness.handlers.get('session/event')({ id: 'root-1' }, { type: 'turn/start', time: 900, data: { turn: 2 } })
  assert.equal(harness.statusMap.isRunning('root-1'), true)
  assert.equal(harness.statusMap.startedAt('root-1'), 900)
  harness.handlers.get('session/event')({ id: 'root-1' }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
  assert.equal(harness.statusMap.isRunning('root-1'), false)
  assert.equal(harness.lastEvent().kind, EVENT.taskCompleted)
})

test('agent status and disposal update the status map', () => {
  const harness = makeHarness()
  harness.handlers.get('agent/status')({ agent: { id: 'a' }, status: 'running' })
  harness.handlers.get('agent/status')({ agent: { id: 'b' }, status: 'idle' })
  assert.deepEqual(harness.statusMap.runningIds(), ['a'])
  harness.handlers.get('agent/disposed')({ agent: { id: 'a' } })
  assert.deepEqual(harness.statusMap.runningIds(), [])
})

test('the disposer removes every listener', () => {
  const harness = makeHarness()
  assert.ok(harness.handlers.size > 0)
  harness.dispose()
  assert.equal(harness.handlers.size, 0)
})
