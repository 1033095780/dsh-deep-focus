import assert from 'node:assert/strict'
import test from 'node:test'
import { createLockController, createLockStore, LOCK_FILE } from '../src/host/lock.js'

function memoryStorage(initial = null) {
  const files = new Map()
  if (initial !== null) files.set(LOCK_FILE, initial)
  return {
    files,
    async readJson(name, fallback = null) {
      return files.has(name) ? files.get(name) : fallback
    },
    async writeJson(name, value) {
      files.set(name, structuredClone(value))
    },
  }
}

function makeWorld({
  closed = false,
  descendants = [],
  agentMissing = false,
  subagentsMissing = false,
  settleMs = 0,
} = {}) {
  const world = {
    now: 1000,
    closed,
    descendants,
    agentMissing,
    subagentsMissing,
    settleMs,
    notify: [],
    interval: null,
    timeout: null,
    intervalsStarted: 0,
  }
  world.lockStore = createLockStore({ storage: null, now: () => world.now })
  const agents = {
    get: (id) => (world.agentMissing ? undefined : { id }),
    turnBoundaryOf: () => ({ openTurnStartSeq: world.closed ? null : 7 }),
  }
  const sessions = { get: (id) => (world.agentMissing ? undefined : { id }) }
  const subagents = { listDescendants: async () => world.descendants }
  world.controller = createLockController({
    lockStore: world.lockStore,
    agents,
    getSessions: () => sessions,
    getSubagents: () => (world.subagentsMissing ? null : subagents),
    getTitle: () => '最新标题',
    notify: async (lock) => { world.notify.push(lock) },
    now: () => world.now,
    settleMs: world.settleMs,
    reconcileMs: 500,
    setIntervalImpl: () => {
      world.intervalsStarted += 1
      return { unref() {} }
    },
    clearIntervalImpl: () => {},
    setTimeoutImpl: () => ({ unref() {} }),
    clearTimeoutImpl: () => {},
    warn: () => {},
  })
  return world
}

test('store: set exposes an active view with elapsed time', () => {
  const store = createLockStore({ storage: null, now: () => 5000 })
  assert.deepEqual(store.view(5000), { active: false, sessionId: null, title: '', startedAt: 0, elapsedMs: 0 })
  store.set('root-1', '  修复登录  ', 1000)
  const view = store.view(6500)
  assert.equal(view.active, true)
  assert.equal(view.sessionId, 'root-1')
  assert.equal(view.title, '修复登录')
  assert.equal(view.elapsedMs, 5500)
})

test('store: a new message in the same session refreshes startedAt', () => {
  let now = 1000
  const store = createLockStore({ storage: null, now: () => now })
  store.set('root-1', 'first', 1000)
  now = 9000
  store.set('root-1', 'second', 9000)
  const view = store.view(9000)
  assert.equal(view.startedAt, 9000)
  assert.equal(view.title, 'second')
  assert.equal(view.elapsedMs, 0)
})

test('store: a message in another session moves the lock', () => {
  const store = createLockStore({ storage: null })
  store.set('root-1', 'one', 1000)
  store.set('root-2', 'two', 2000)
  const view = store.view(2500)
  assert.equal(view.sessionId, 'root-2')
  assert.equal(view.title, 'two')
})

test('store: clear only reports success while locked', () => {
  const store = createLockStore({ storage: null })
  assert.equal(store.clear(), false)
  store.set('root-1', 't', 1000)
  assert.equal(store.clear(), true)
  assert.equal(store.view().active, false)
})

test('store: lock.json round-trips through load', async () => {
  const storage = memoryStorage()
  const first = createLockStore({ storage })
  first.set('root-9', 'persisted', 1234)
  await first.flush()
  assert.deepEqual(storage.files.get(LOCK_FILE), {
    version: 1,
    lock: { sessionId: 'root-9', title: 'persisted', startedAt: 1234 },
  })
  const second = createLockStore({ storage })
  const restored = await second.load()
  assert.deepEqual(restored, { sessionId: 'root-9', title: 'persisted', startedAt: 1234 })
  assert.equal(second.view(2234).elapsedMs, 1000)
})

test('store: malformed documents load as unlocked', async () => {
  const store = createLockStore({ storage: memoryStorage({ version: 1, lock: { title: 1 } }) })
  assert.equal(await store.load(), null)
  assert.equal(store.view().active, false)
})

test('controller: reconcile does nothing without a lock', async () => {
  const world = makeWorld({ closed: true })
  assert.equal(await world.controller.reconcile(), false)
  assert.equal(world.notify.length, 0)
})

test('controller: an open root turn keeps the lock', async () => {
  const world = makeWorld({ closed: false })
  world.lockStore.set('root-1', 't', 1000)
  assert.equal(await world.controller.reconcile(), false)
  assert.equal(await world.controller.reconcile(), false)
  assert.equal(world.lockStore.view().active, true)
  assert.equal(world.notify.length, 0)
})

test('controller: releases once after the turn closes and children are idle', async () => {
  const world = makeWorld({ closed: true })
  world.lockStore.set('root-1', 't', 1000)
  assert.equal(await world.controller.reconcile(), false) // settle window
  assert.equal(await world.controller.reconcile(), true)
  assert.equal(world.lockStore.view().active, false)
  assert.equal(world.notify.length, 1)
  assert.equal(world.notify[0].sessionId, 'root-1')
  assert.equal(world.notify[0].title, '最新标题')
  assert.equal(await world.controller.reconcile(), false)
  assert.equal(world.notify.length, 1)
})

test('controller: a running descendant keeps the lock', async () => {
  const world = makeWorld({ closed: true, descendants: [{ kind: 'child', activity: 'running' }] })
  world.lockStore.set('root-1', 't', 1000)
  assert.equal(await world.controller.reconcile(), false)
  assert.equal(await world.controller.reconcile(), false)
  assert.equal(world.lockStore.view().active, true)
})

test('controller: idle descendants do not block release', async () => {
  const world = makeWorld({ closed: true, descendants: [{ kind: 'child', activity: 'inactive' }] })
  world.lockStore.set('root-1', 't', 1000)
  await world.controller.reconcile()
  assert.equal(await world.controller.reconcile(), true)
})

test('controller: a missing subagents service treats children as idle', async () => {
  const world = makeWorld({ closed: true, subagentsMissing: true })
  world.lockStore.set('root-1', 't', 1000)
  await world.controller.reconcile()
  assert.equal(await world.controller.reconcile(), true)
})

test('controller: an absent agent counts as closed', async () => {
  const world = makeWorld({ closed: false, agentMissing: true })
  world.lockStore.set('root-1', 't', 1000)
  await world.controller.reconcile()
  assert.equal(await world.controller.reconcile(), true)
})

test('controller: the settle window delays the release', async () => {
  const world = makeWorld({ closed: true, settleMs: 1000 })
  world.lockStore.set('root-1', 't', 1000)
  world.now = 1000
  assert.equal(await world.controller.reconcile(), false)
  world.now = 1500
  assert.equal(await world.controller.reconcile(), false)
  world.now = 2000
  assert.equal(await world.controller.reconcile(), true)
})

test('controller: skip clears the lock without notifying', async () => {
  const world = makeWorld({ closed: true })
  world.lockStore.set('root-1', 't', 1000)
  assert.equal(world.controller.skip(), true)
  assert.equal(world.lockStore.view().active, false)
  assert.equal(world.notify.length, 0)
  assert.equal(world.controller.skip(), false)
})

test('controller: a vanished session releases silently', async () => {
  const world = makeWorld({ closed: true })
  world.lockStore.set('root-1', 't', 1000)
  assert.equal(world.controller.handleGone('root-2'), false)
  assert.equal(world.controller.handleGone('root-1'), true)
  assert.equal(world.lockStore.view().active, false)
  assert.equal(world.notify.length, 0)
})

test('controller: onLockChanged starts the safety timer; clearing stops it', () => {
  const world = makeWorld({ closed: false })
  world.lockStore.set('root-1', 't', 1000)
  world.controller.onLockChanged()
  assert.equal(world.intervalsStarted, 1)
  world.lockStore.clear()
  world.controller.onLockChanged()
  assert.equal(world.lockStore.view().active, false)
})

test('controller: dispose makes later reconciles no-ops', async () => {
  const world = makeWorld({ closed: true })
  world.lockStore.set('root-1', 't', 1000)
  world.controller.dispose()
  assert.equal(await world.controller.reconcile(), false)
  assert.equal(world.lockStore.view().active, true)
})
