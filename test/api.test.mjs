import assert from 'node:assert/strict'
import test from 'node:test'
import { createApi, isLoopbackAuthority, isTrustedRequest, readJsonBody } from '../src/host/api.js'
import { createEventRing, createStatusMap, installHostEventListeners } from '../src/host/events.js'
import { createLimits } from '../src/host/limits.js'
import { createSettingsStore } from '../src/host/settings.js'
import { createTracker } from '../src/host/tracker.js'
import { API_BASE, ROUTES } from '../src/shared/contract.js'
import { localDayKey, shiftDayKey } from '../src/host/storage.js'

const HOST = '127.0.0.1:51131'

function makeRequest({ method = 'GET', url, headers = { host: HOST }, body } = {}) {
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.isBuffer(body) ? body : Buffer.from(body)
    },
  }
}

function makeResponse() {
  return {
    headersSent: false,
    writableEnded: false,
    status: 0,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      if (typeof body === 'string') this.body += body
      this.writableEnded = true
    },
  }
}

async function call(api, request) {
  const response = makeResponse()
  await api.handle(request, response)
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
    json: response.body.length > 0 ? JSON.parse(response.body) : null,
  }
}

async function makeFixture({
  storage = null,
  samplerOverrides = {},
  roots = ['root-1', 'root-2'],
  running = [],
  settingsPatch = null,
  sessionsStore = null,
  turnBoundaryOf = null,
} = {}) {
  let clock = new Date(2026, 10, 5, 10, 0, 0).getTime()
  const now = () => clock
  const settings = createSettingsStore()
  await settings.load()
  if (settingsPatch !== null) await settings.update(settingsPatch)
  const tracker = createTracker({ storage: null, settings, now })
  const ring = createEventRing({ now })
  const statusMap = createStatusMap()
  for (const id of running) statusMap.set(id, true)
  const agents = {
    roots: () => roots.map((id) => ({ id })),
    list: () => [...roots.map((id) => ({ id })), { id: 'subagent-1' }, { id: 'teammate-1' }],
    ...(turnBoundaryOf === null ? {} : { turnBoundaryOf }),
  }
  const limits = createLimits({ settings, tracker, ring, storage: null, now })
  const sampler = {
    state: () => 'ok',
    appsState: () => 'ok',
    detail: () => null,
    setSampleSeconds: () => {},
    start: () => {},
    stop: () => {},
    ...samplerOverrides,
  }
  const api = createApi({
    settings,
    tracker,
    limits,
    sampler,
    ring,
    statusMap,
    agents,
    storage,
    now,
    getSessions: sessionsStore === null ? null : () => sessionsStore,
    // Mirrors src/index.js: a settings write re-applies the assistant switch.
    onChange(next) {
      limits.setAssistantEnabled(next.assistant.enabled === true)
      limits.evaluate(clock)
    },
  })
  return {
    api,
    settings,
    tracker,
    limits,
    statusMap,
    ring,
    sampler,
    advance(ms) { clock += ms },
    get clock() { return clock },
    feedActive(app = 'chrome', count = 1) {
      tracker.sample({ idleMs: 100, app }, clock)
      for (let index = 1; index < count; index += 1) {
        clock += 5000
        tracker.sample({ idleMs: 100, app }, clock)
      }
    },
  }
}

function makeUsageStorage(rowsByDay) {
  return {
    readUsageDay: async (day) => rowsByDay.get(day) ?? { activeMs: 0, apps: new Map() },
    readJsonl: async () => [],
  }
}

test('loopback authority detection', () => {
  assert.equal(isLoopbackAuthority('127.0.0.1:51131'), true)
  assert.equal(isLoopbackAuthority('localhost:51131'), true)
  assert.equal(isLoopbackAuthority('[::1]:51131'), true)
  assert.equal(isLoopbackAuthority('192.168.1.5:51131'), false)
  assert.equal(isLoopbackAuthority(undefined), false)
})

test('same-origin trust rule', () => {
  assert.equal(isTrustedRequest({}), true)
  assert.equal(isTrustedRequest({ host: HOST }), true)
  assert.equal(isTrustedRequest({ host: HOST, 'sec-fetch-site': 'cross-site' }), false)
  assert.equal(isTrustedRequest({ host: HOST, origin: 'null' }), false)
  assert.equal(isTrustedRequest({ host: HOST, origin: 'http://evil.test' }), false)
  assert.equal(isTrustedRequest({ host: HOST, origin: `http://${HOST}` }), true)
  assert.equal(isTrustedRequest({ host: HOST, origin: 'http://127.0.0.1' }), true)
  assert.equal(isTrustedRequest({ host: HOST, origin: 'http://127.0.0.1:9999' }), false)
})

test('readJsonBody enforces a size cap and rejects malformed JSON', async () => {
  assert.deepEqual(await readJsonBody(makeRequest({ body: '{"a":1}' })), { a: 1 })
  assert.deepEqual(await readJsonBody(makeRequest({ body: '' })), {})
  await assert.rejects(readJsonBody(makeRequest({ body: '{oops' })), (error) => error.code === 'bad-json')
  await assert.rejects(
    readJsonBody(makeRequest({ body: 'x'.repeat(100) }), 10),
    (error) => error.code === 'body-too-large',
  )
})

test('GET /state returns the v3 contract shape with root-only sessions and solo', async () => {
  const fixture = await makeFixture({ running: ['root-2'] })
  const result = await call(fixture.api, makeRequest({ url: ROUTES.state }))
  assert.equal(result.status, 200)
  assert.equal(result.headers['cache-control'], 'no-store')
  const state = result.json
  assert.deepEqual(Object.keys(state).sort(), ['appsToday', 'events', 'limit', 'now', 'sessions', 'settings', 'solo', 'usage'])
  assert.deepEqual(Object.keys(state.usage).sort(), ['activeTodayMs', 'appsSampling', 'continuousMs', 'dayKey', 'sampling'])
  assert.deepEqual(Object.keys(state.appsToday).sort(), ['top', 'totalMs'])
  assert.deepEqual(Object.keys(state.limit).sort(), [
    'assistantEnabled', 'continuousLimitMs', 'continuousUsedMs', 'dailyLimitMs', 'dailyLocked', 'dailyUsedMs',
    'extendCountToday', 'extendLimit', 'extendedUntil', 'restDue', 'restRemainingMs', 'restUntil', 'resting',
  ])
  assert.deepEqual(Object.keys(state.settings).sort(), ['alerts', 'assistant', 'limits', 'usage', 'version'])
  assert.equal(state.settings.version, 3)
  assert.equal(state.settings.focus, undefined)
  assert.equal(state.settings.security, undefined)
  assert.equal(state.limit.assistantEnabled, true)
  assert.equal(state.limit.dailyLimitMs, 180 * 60_000)
  assert.equal(state.limit.continuousLimitMs, 30 * 60_000)
  assert.equal(state.limit.dailyLocked, false)
  assert.equal(state.limit.resting, false)
  assert.equal(state.usage.sampling, 'ok')
  assert.equal(state.usage.appsSampling, 'ok')
  // Roots only: subagent/teammate sessions never leak into the sidebar list.
  assert.deepEqual(state.sessions, [
    { id: 'root-1', running: false },
    { id: 'root-2', running: true },
  ])
  assert.deepEqual(state.solo, { active: true, sessions: ['root-2'] })
  assert.deepEqual(state.events, [])
})

test('solo is inactive when no root agent runs', async () => {
  const fixture = await makeFixture()
  const state = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.deepEqual(state.solo, { active: false, sessions: [] })
})

test('appsSampling reflects the sampler and the trackApps setting', async () => {
  const off = await makeFixture({ samplerOverrides: { appsState: () => 'off' } })
  assert.equal((await call(off.api, makeRequest({ url: ROUTES.state }))).json.usage.appsSampling, 'off')

  const fixture = await makeFixture()
  await fixture.settings.update({ usage: { trackApps: false } })
  assert.equal((await call(fixture.api, makeRequest({ url: ROUTES.state }))).json.usage.appsSampling, 'off')
})

test('unknown paths 404, removed /stats 404 and unsupported methods 405', async () => {
  const fixture = await makeFixture()
  assert.equal((await call(fixture.api, makeRequest({ url: `${API_BASE}/nope` }))).status, 404)
  assert.equal((await call(fixture.api, makeRequest({ url: `${API_BASE}/stats` }))).status, 404)
  const wrongMethod = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.state }))
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.allow, 'GET')
})

test('cross-origin writes are refused', async () => {
  const fixture = await makeFixture()
  const result = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    headers: { host: HOST, origin: 'http://evil.test' },
    body: '{}',
  }))
  assert.equal(result.status, 403)
  assert.equal(result.json.error.code, 'untrusted-origin')
})

test('settings are read and written as a deep partial', async () => {
  const fixture = await makeFixture()
  const read = await call(fixture.api, makeRequest({ url: ROUTES.settings }))
  assert.equal(read.status, 200)
  assert.equal(read.json.ok, true)
  assert.equal(read.json.settings.limits.dailyMinutes, 180)

  const write = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    headers: { host: HOST, origin: `http://${HOST}` },
    body: JSON.stringify({
      settings: {
        limits: { dailyMinutes: 60, continuousMinutes: 45 },
        assistant: { enabled: false },
        usage: { trackApps: false },
        alerts: { volume: 2 },
      },
    }),
  }))
  assert.equal(write.status, 200)
  assert.equal(write.json.settings.limits.dailyMinutes, 60)
  assert.equal(write.json.settings.limits.continuousMinutes, 45)
  assert.equal(write.json.settings.assistant.enabled, false)
  assert.equal(write.json.settings.usage.trackApps, false)
  assert.equal(write.json.settings.alerts.volume, 1)

  const invalid = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    body: JSON.stringify({ settings: ['nope'] }),
  }))
  assert.equal(invalid.status, 400)
  assert.equal(invalid.json.error.code, 'invalid-settings')
})

test('POST /assistant toggles the assistant and its events', async () => {
  const fixture = await makeFixture()
  const off = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.assistant,
    body: JSON.stringify({ enabled: false }),
  }))
  assert.equal(off.status, 200)
  assert.equal(off.json.state.settings.assistant.enabled, false)
  assert.equal(off.json.state.limit.assistantEnabled, false)
  assert.ok(off.json.state.events.some((event) => event.kind === 'assistant-off'))

  const on = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.assistant,
    body: JSON.stringify({ enabled: true }),
  }))
  assert.equal(on.status, 200)
  assert.equal(on.json.state.limit.assistantEnabled, true)
  assert.ok(on.json.state.events.some((event) => event.kind === 'assistant-on'))

  const invalid = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.assistant,
    body: JSON.stringify({ enabled: 'yes' }),
  }))
  assert.equal(invalid.status, 400)
  assert.equal(invalid.json.error.code, 'invalid-assistant')
})

test('the continuous cap forces a rest and the rest finishes automatically', async () => {
  const fixture = await makeFixture()
  fixture.feedActive('chrome', 361)
  const resting = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.equal(resting.limit.resting, true)
  assert.equal(resting.limit.restRemainingMs, 10 * 60_000)
  assert.equal(resting.usage.continuousMs, 0)
  assert.ok(resting.events.some((event) => event.kind === 'rest-started'))
  const usedBefore = resting.usage.activeTodayMs
  assert.ok(usedBefore >= 30 * 60_000)

  fixture.advance(10 * 60_000 + 1000)
  const finished = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.equal(finished.limit.resting, false)
  assert.equal(finished.limit.restRemainingMs, 0)
  assert.ok(finished.events.some((event) => event.kind === 'rest-finished'))
  // The rest window added no usage.
  assert.equal(finished.usage.activeTodayMs, usedBefore)
})

test('manual rest start/finish and their conflicts', async () => {
  const fixture = await makeFixture()
  const started = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.restStart, body: '{}' }))
  assert.equal(started.status, 200)
  assert.equal(started.json.state.limit.resting, true)
  assert.equal(started.json.state.limit.restRemainingMs, 10 * 60_000)

  const again = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.restStart, body: '{}' }))
  assert.equal(again.status, 409)
  assert.equal(again.json.error.code, 'already-resting')

  const finished = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.restFinish, body: '{}' }))
  assert.equal(finished.status, 200)
  assert.equal(finished.json.state.limit.resting, false)

  const finishAgain = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.restFinish, body: '{}' }))
  assert.equal(finishAgain.status, 409)
  assert.equal(finishAgain.json.error.code, 'not-resting')

  await fixture.settings.update({ assistant: { enabled: false } })
  const off = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.restStart, body: '{}' }))
  assert.equal(off.status, 409)
  assert.equal(off.json.error.code, 'assistant-off')
})

test('the daily cap locks and extend grants two windows then refuses', async () => {
  const fixture = await makeFixture({ settingsPatch: { limits: { dailyMinutes: 1 } } })
  fixture.feedActive('chrome', 13)
  const locked = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.equal(locked.limit.dailyLocked, true)
  assert.equal(locked.limit.extendCountToday, 0)
  assert.equal(locked.limit.extendLimit, 2)
  assert.ok(locked.limit.dailyUsedMs >= 60_000)
  assert.ok(locked.events.some((event) => event.kind === 'daily-locked'))

  const first = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.extend, body: '{}' }))
  assert.equal(first.status, 200)
  assert.equal(first.json.state.limit.dailyLocked, false)
  assert.equal(first.json.state.limit.extendCountToday, 1)
  assert.equal(first.json.state.limit.extendedUntil - first.json.state.now, 20 * 60_000)
  assert.ok(first.json.state.events.some((event) => event.kind === 'extended'))

  fixture.advance(20 * 60_000 + 1000)
  const relocked = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.equal(relocked.limit.dailyLocked, true)

  const second = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.extend, body: '{}' }))
  assert.equal(second.status, 200)
  assert.equal(second.json.state.limit.extendCountToday, 2)

  fixture.advance(20 * 60_000 + 1000)
  const third = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.extend, body: '{}' }))
  assert.equal(third.status, 409)
  assert.equal(third.json.error.code, 'extend-limit-reached')
})

test('extend is refused when nothing is locked', async () => {
  const fixture = await makeFixture()
  const result = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.extend, body: '{}' }))
  assert.equal(result.status, 409)
  assert.equal(result.json.error.code, 'not-locked')
})

test('assistant off only tracks: no lock, no rest', async () => {
  const fixture = await makeFixture({ settingsPatch: { limits: { dailyMinutes: 1 } } })
  fixture.feedActive('chrome', 14)
  const locked = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.equal(locked.limit.dailyLocked, true)

  await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.assistant, body: JSON.stringify({ enabled: false }) }))
  fixture.feedActive('chrome', 10)
  const state = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.equal(state.limit.assistantEnabled, false)
  assert.equal(state.limit.dailyLocked, false)
  assert.equal(state.limit.resting, false)
  // Usage still advances while the assistant is off.
  assert.ok(state.usage.activeTodayMs > locked.usage.activeTodayMs)
})

test('solo follows the real event bridge status map', async () => {
  const fixture = await makeFixture()
  const handlers = new Map()
  const ctx = {
    on(name, listener) {
      handlers.set(name, listener)
      return () => handlers.delete(name)
    },
  }
  const dispose = installHostEventListeners({
    ctx,
    ring: fixture.ring,
    settings: fixture.settings,
    statusMap: fixture.statusMap,
  })
  // The root-level feed is what actually reaches an unscoped plugin context.
  handlers.get('api-session/status')('root-2', true)
  let state = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.deepEqual(state.solo, { active: true, sessions: ['root-2'] })
  assert.equal(state.sessions.find((session) => session.id === 'root-2').running, true)

  handlers.get('api-session/status')('root-2', false)
  state = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.deepEqual(state.solo, { active: false, sessions: [] })
  assert.equal(state.sessions.find((session) => session.id === 'root-2').running, false)

  // Durable turn boundaries work as an independent fallback source.
  handlers.get('session/event')({ id: 'root-1' }, { type: 'turn/start', data: { turn: 1 } })
  state = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.deepEqual(state.solo, { active: true, sessions: ['root-1'] })
  dispose()
})

test('/state recovers a running root session missed during a reload', async () => {
  const liveSession = { id: 'root-1' }
  const fixture = await makeFixture({
    sessionsStore: { get: (id) => (id === 'root-1' ? liveSession : undefined) },
    turnBoundaryOf: () => ({ openTurnStartSeq: 5 }),
  })
  const state = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.equal(state.sessions.find((session) => session.id === 'root-1').running, true)
  assert.equal(state.sessions.find((session) => session.id === 'root-2').running, false)
  assert.deepEqual(state.solo, { active: true, sessions: ['root-1'] })
})

test('/state does not invent a running session when its turn is closed', async () => {
  const fixture = await makeFixture({
    sessionsStore: { get: () => ({ id: 'root-1' }) },
    turnBoundaryOf: () => ({ openTurnStartSeq: null }),
  })
  const state = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.deepEqual(state.solo, { active: false, sessions: [] })
})

test('a broken session lookup never breaks GET /state', async () => {
  const fixture = await makeFixture({
    sessionsStore: {
      get() { throw new Error('store closed') },
    },
    turnBoundaryOf: () => ({ openTurnStartSeq: 1 }),
  })
  const result = await call(fixture.api, makeRequest({ url: ROUTES.state }))
  assert.equal(result.status, 200)
  assert.deepEqual(result.json.solo, { active: false, sessions: [] })
})

test('GET /apps keeps the v2 aggregation shape and live today data', async () => {
  const fixture = await makeFixture()
  const todayKey = localDayKey(fixture.clock)
  const yesterdayKey = shiftDayKey(todayKey, -1)
  const storage = makeUsageStorage(new Map([
    [yesterdayKey, { activeMs: 60_000, apps: new Map([['chrome', 40_000], ['code', 20_000]]) }],
  ]))
  const apiFixture = await makeFixture({ storage })
  apiFixture.feedActive('msedge', 5)
  const result = await call(apiFixture.api, makeRequest({ url: `${ROUTES.apps}?days=2` }))
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.days.length, 2)
  assert.deepEqual(result.json.days[0].apps, [
    { id: 'chrome', name: '浏览器', ms: 40_000 },
    { id: 'code', name: 'VS Code', ms: 20_000 },
  ])
  assert.equal(result.json.today.day, todayKey)
  assert.equal(result.json.today.activeMs, 20_000)
  assert.deepEqual(result.json.top[0], { id: 'msedge', name: '浏览器', ms: 20_000 })
})
