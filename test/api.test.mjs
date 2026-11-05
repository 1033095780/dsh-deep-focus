import assert from 'node:assert/strict'
import test from 'node:test'
import { createApi, isLoopbackAuthority, isTrustedRequest, readJsonBody } from '../src/host/api.js'
import { createBudget } from '../src/host/budget.js'
import { createEventRing, createStatusMap } from '../src/host/events.js'
import { createFocus } from '../src/host/focus.js'
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

async function makeFixture({ storage = null, samplerOverrides = {} } = {}) {
  let clock = new Date(2026, 10, 5, 10, 0, 0).getTime()
  const now = () => clock
  const settings = createSettingsStore()
  await settings.load()
  const tracker = createTracker({ storage: null, settings, now })
  const ring = createEventRing({ now })
  const focus = createFocus({ settings, ring, storage: null, now })
  const budget = createBudget({ settings, tracker, focus, ring, storage: null, now })
  const statusMap = createStatusMap()
  const sampler = {
    state: () => 'ok',
    appsState: () => 'ok',
    detail: () => null,
    setSampleSeconds: () => {},
    start: () => {},
    stop: () => {},
    ...samplerOverrides,
  }
  const agents = {
    list: () => [{ id: 'session-a' }, { id: 'session-b' }],
    get: (id) => (id === 'session-a' || id === 'session-b' ? { id } : undefined),
  }
  const api = createApi({
    settings,
    tracker,
    focus,
    budget,
    sampler,
    ring,
    statusMap,
    agents,
    storage,
    now,
  })
  return {
    api,
    settings,
    tracker,
    focus,
    budget,
    statusMap,
    ring,
    sampler,
    advance(ms) { clock += ms },
    get clock() { return clock },
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
  assert.equal(isLoopbackAuthority('LOCALHOST'), true)
  assert.equal(isLoopbackAuthority('192.168.1.5:51131'), false)
  assert.equal(isLoopbackAuthority('127.0.0.1.evil.test'), false)
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
  assert.equal(isTrustedRequest({ host: HOST, origin: 'ftp://127.0.0.1:51131' }), false)
  assert.equal(isTrustedRequest({ origin: `http://${HOST}` }), true)
  assert.equal(isTrustedRequest({ host: '192.168.1.5:51131', origin: 'http://192.168.1.5:51131' }), true)
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

test('GET /state returns the v2 contract shape', async () => {
  const fixture = await makeFixture()
  const result = await call(fixture.api, makeRequest({ url: ROUTES.state }))
  assert.equal(result.status, 200)
  assert.equal(result.headers['cache-control'], 'no-store')
  const state = result.json
  assert.deepEqual(Object.keys(state).sort(), ['alerts', 'appsToday', 'events', 'focus', 'lock', 'now', 'sessions', 'settings', 'usage'])
  assert.deepEqual(Object.keys(state.focus).sort(), [
    'elapsedMs', 'endsAt', 'pauseCause', 'phase', 'pomodorosToday', 'remainingMs', 'sessionId', 'sessionLive', 'startedAt', 'status', 'task',
  ])
  assert.deepEqual(Object.keys(state.usage).sort(), ['activeTodayMs', 'appsSampling', 'continuousMs', 'dayKey', 'sampling'])
  assert.deepEqual(Object.keys(state.appsToday).sort(), ['top', 'totalMs'])
  assert.deepEqual(Object.keys(state.lock).sort(), ['canUnlock', 'locked', 'reason', 'since', 'strict', 'unlockMinutes', 'unlockUntil'])
  assert.equal(state.focus.phase, 'idle')
  assert.equal(state.focus.sessionLive, null)
  assert.equal(state.usage.sampling, 'ok')
  assert.equal(state.usage.appsSampling, 'ok')
  assert.equal(state.lock.strict, false)
  assert.equal(state.lock.unlockMinutes, 20)
  assert.equal(state.settings.limits.dailyActiveMinutes, 0)
  assert.equal(state.settings.security, undefined)
  assert.equal(state.settings.lock, undefined)
  assert.deepEqual(state.sessions, [{ id: 'session-a', running: false }, { id: 'session-b', running: false }])
  assert.deepEqual(state.events, [])
  assert.equal(result.body.includes('password'), false)
})

test('appsSampling reflects the sampler and the trackApps setting', async () => {
  const off = await makeFixture({ samplerOverrides: { appsState: () => 'off' } })
  assert.equal((await call(off.api, makeRequest({ url: ROUTES.state }))).json.usage.appsSampling, 'off')

  const fixture = await makeFixture()
  await fixture.settings.update({ usage: { trackApps: false } })
  assert.equal((await call(fixture.api, makeRequest({ url: ROUTES.state }))).json.usage.appsSampling, 'off')

  const stopped = await makeFixture({ samplerOverrides: { state: () => 'off' } })
  assert.equal((await call(stopped.api, makeRequest({ url: ROUTES.state }))).json.usage.appsSampling, 'off')
})

test('unknown paths 404 and unsupported methods 405', async () => {
  const fixture = await makeFixture()
  const missing = await call(fixture.api, makeRequest({ url: `${API_BASE}/nope` }))
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not-found')
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

test('settings are read and written without any secret fields', async () => {
  const fixture = await makeFixture()
  const read = await call(fixture.api, makeRequest({ url: ROUTES.settings }))
  assert.equal(read.status, 200)
  assert.equal(read.json.ok, true)
  assert.equal(read.json.settings.focus.workMinutes, 25)

  const write = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    headers: { host: HOST, origin: `http://${HOST}` },
    body: JSON.stringify({ settings: { focus: { workMinutes: 50 }, usage: { trackApps: false }, alerts: { volume: 2 } } }),
  }))
  assert.equal(write.status, 200)
  assert.equal(write.json.ok, true)
  assert.equal(write.json.settings.focus.workMinutes, 50)
  assert.equal(write.json.settings.usage.trackApps, false)
  assert.equal(write.json.settings.alerts.volume, 1)
  assert.equal(write.body.includes('passwordHash'), false)

  // Removed v1 sections can be sent but are dropped, never persisted.
  const legacy = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    headers: { host: HOST },
    body: JSON.stringify({ settings: { security: { passwordHash: 'x' }, lock: { singleConversation: true } } }),
  }))
  assert.equal(legacy.status, 200)
  assert.equal(legacy.json.settings.security, undefined)
  assert.equal(legacy.json.settings.lock, undefined)
})

test('settings bodies reject malformed and oversized payloads', async () => {
  const fixture = await makeFixture()
  const badJson = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.settings, body: '{nope' }))
  assert.equal(badJson.status, 400)
  assert.equal(badJson.json.error.code, 'bad-json')
  const notObject = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.settings, body: '[1,2]' }))
  assert.equal(notObject.status, 400)
  assert.equal(notObject.json.error.code, 'invalid-settings')
  const badSettings = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    body: JSON.stringify({ settings: ['nope'] }),
  }))
  assert.equal(badSettings.status, 400)
  assert.equal(badSettings.json.error.code, 'invalid-settings')
  const tooLarge = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    body: JSON.stringify({ settings: { task: 'x'.repeat(40_000) } }),
  }))
  assert.equal(tooLarge.status, 413)
  assert.equal(tooLarge.json.error.code, 'body-too-large')
})

test('GET /apps aggregates per-app usage over the requested days', async () => {
  const fixture = await makeFixture()
  const todayKey = localDayKey(fixture.clock)
  const yesterdayKey = shiftDayKey(todayKey, -1)
  const storage = makeUsageStorage(new Map([
    [yesterdayKey, { activeMs: 60_000, apps: new Map([['chrome', 40_000], ['code', 20_000]]) }],
  ]))
  const apiFixture = await makeFixture({ storage })
  // Today is still in memory until the next minute flush.
  apiFixture.tracker.sample({ idleMs: 100, app: 'msedge' }, apiFixture.clock)
  for (let index = 0; index < 4; index += 1) {
    apiFixture.advance(5000)
    apiFixture.tracker.sample({ idleMs: 100, app: 'msedge' }, apiFixture.clock)
  }
  for (let index = 0; index < 2; index += 1) {
    apiFixture.advance(5000)
    apiFixture.tracker.sample({ idleMs: 100, app: 'wechat' }, apiFixture.clock)
  }

  const result = await call(apiFixture.api, makeRequest({ url: `${ROUTES.apps}?days=2` }))
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.retentionDays, 30)
  assert.equal(result.json.days.length, 2)
  assert.equal(result.json.days[0].day, yesterdayKey)
  assert.deepEqual(result.json.days[0].apps, [
    { id: 'chrome', name: '浏览器', ms: 40_000 },
    { id: 'code', name: 'VS Code', ms: 20_000 },
  ])
  assert.equal(result.json.today.day, todayKey)
  assert.equal(result.json.today.activeMs, 30_000)
  assert.deepEqual(result.json.today.apps, [
    { id: 'msedge', name: '浏览器', ms: 20_000 },
    { id: 'wechat', name: '微信', ms: 10_000 },
  ])
  assert.deepEqual(result.json.top[0], { id: 'msedge', name: '浏览器', ms: 20_000 })
})

test('GET /state exposes today per-app usage from the tracker', async () => {
  const fixture = await makeFixture()
  fixture.tracker.sample({ idleMs: 100, app: 'chrome' }, fixture.clock)
  fixture.advance(5000)
  fixture.tracker.sample({ idleMs: 200, app: 'chrome' }, fixture.clock)
  fixture.advance(5000)
  fixture.tracker.sample({ idleMs: 200, app: 'Code' }, fixture.clock)
  const state = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.equal(state.appsToday.totalMs, 10_000)
  assert.deepEqual(state.appsToday.top, [
    { id: 'chrome', name: '浏览器', ms: 5000 },
    { id: 'code', name: 'VS Code', ms: 5000 },
  ])
  assert.equal(state.usage.activeTodayMs, 10_000)
})

test('GET /stats keeps the focus statistics shape', async () => {
  const fixture = await makeFixture()
  fixture.tracker.sample({ idleMs: 100, app: 'chrome' }, fixture.clock)
  for (let index = 0; index < 6; index += 1) {
    fixture.advance(5000)
    fixture.tracker.sample({ idleMs: 100, app: 'chrome' }, fixture.clock)
  }
  const result = await call(fixture.api, makeRequest({ url: `${ROUTES.stats}?days=3` }))
  assert.equal(result.status, 200)
  assert.equal(result.json.days.length, 3)
  assert.deepEqual(Object.keys(result.json.days[0]).sort(), ['activeMs', 'breakCount', 'day', 'focusMs', 'pomodoros', 'unlocks'])
  assert.equal(result.json.today.activeMs, 30_000)
})

test('focus commands drive the state machine through the API', async () => {
  const fixture = await makeFixture()
  const started = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.focusStart,
    body: JSON.stringify({ task: 'write tests', sessionId: 'session-a', workMinutes: 25 }),
  }))
  assert.equal(started.status, 200)
  assert.equal(started.json.state.focus.phase, 'work')
  assert.equal(started.json.state.focus.status, 'running')
  assert.equal(started.json.state.focus.sessionId, 'session-a')
  assert.equal(started.json.state.focus.sessionLive, true)
  assert.equal(started.json.state.focus.task, 'write tests')

  const paused = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.focusPause, body: '{}' }))
  assert.equal(paused.json.state.focus.status, 'paused')
  const resumed = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.focusResume, body: '{}' }))
  assert.equal(resumed.json.state.focus.status, 'running')
  const stopped = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.focusStop, body: '{}' }))
  assert.equal(stopped.json.state.focus.phase, 'idle')

  const conflict = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.focusPause, body: '{}' }))
  assert.equal(conflict.status, 409)
  assert.equal(conflict.json.error.code, 'not-running')
})

test('unlock is a one-click 20-minute grant and re-locks after the grace window', async () => {
  const fixture = await makeFixture()
  await fixture.settings.update({ limits: { dailyActiveMinutes: 1 } })
  for (let index = 0; index < 14; index += 1) {
    fixture.tracker.sample({ idleMs: 100, app: 'chrome' }, fixture.clock)
    fixture.advance(5000)
  }
  const locked = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.equal(locked.lock.locked, true)
  assert.equal(locked.lock.reason, 'daily')
  assert.equal(locked.lock.unlockMinutes, 20)
  assert.equal(locked.lock.canUnlock, true)
  assert.equal(locked.lock.strict, false)

  const unlocked = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.unlock, body: '{}' }))
  assert.equal(unlocked.status, 200)
  assert.equal(unlocked.json.ok, true)
  assert.equal(unlocked.json.state.lock.locked, false)
  assert.equal(unlocked.json.state.lock.reason, 'daily')
  assert.ok(unlocked.json.state.lock.unlockUntil > unlocked.json.state.now)
  assert.equal(unlocked.json.state.lock.unlockUntil - unlocked.json.state.now, 20 * 60_000)

  fixture.advance(20 * 60_000 + 2000)
  const relocked = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.equal(relocked.lock.locked, true)
})

test('rest unlock ends the lock and resets continuous work', async () => {
  const fixture = await makeFixture()
  await fixture.settings.update({ limits: { continuousWorkMinutes: 1 } })
  for (let index = 0; index < 14; index += 1) {
    fixture.tracker.sample({ idleMs: 100, app: 'chrome' }, fixture.clock)
    fixture.advance(5000)
  }
  const locked = (await call(fixture.api, makeRequest({ url: ROUTES.state }))).json
  assert.equal(locked.lock.locked, true)
  assert.equal(locked.lock.reason, 'continuous')
  const rested = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.unlock,
    body: JSON.stringify({ mode: 'rest' }),
  }))
  assert.equal(rested.status, 200)
  assert.equal(rested.json.state.lock.locked, false)
  assert.equal(rested.json.state.usage.continuousMs, 0)
})

test('unlock is rejected when nothing is locked', async () => {
  const fixture = await makeFixture()
  const result = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.unlock, body: '{}' }))
  assert.equal(result.status, 409)
  assert.equal(result.json.error.code, 'not-locked')
})
