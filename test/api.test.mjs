import assert from 'node:assert/strict'
import test from 'node:test'
import { createApi, isLoopbackAuthority, isTrustedRequest, readJsonBody } from '../src/host/api.js'
import { createBudget } from '../src/host/budget.js'
import { createEventRing, createStatusMap } from '../src/host/events.js'
import { createFocus } from '../src/host/focus.js'
import { createSettingsStore } from '../src/host/settings.js'
import { createTracker } from '../src/host/tracker.js'
import { API_BASE, ROUTES } from '../src/shared/contract.js'

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

async function makeFixture() {
  let clock = 1_700_000_000_000
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
    detail: () => null,
    setSampleSeconds: () => {},
    start: () => {},
    stop: () => {},
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
    storage: null,
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
    get clock() { return clock },
    advance(ms) { clock += ms },
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
  assert.equal(isTrustedRequest({ host: '192.168.1.5:51131' }), true)
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

test('GET /state returns the contract shape', async () => {
  const fixture = await makeFixture()
  const result = await call(fixture.api, makeRequest({ url: ROUTES.state }))
  assert.equal(result.status, 200)
  const state = result.json
  for (const key of ['now', 'focus', 'usage', 'lock', 'alerts', 'settings', 'sessions', 'events']) {
    assert.ok(key in state, `missing state.${key}`)
  }
  assert.deepEqual(Object.keys(state.focus).sort(), [
    'elapsedMs', 'endsAt', 'pauseCause', 'phase', 'pomodorosToday', 'remainingMs', 'sessionId', 'sessionLive', 'startedAt', 'status', 'task',
  ])
  assert.equal(state.focus.phase, 'idle')
  assert.equal(state.focus.status, 'idle')
  assert.equal(state.focus.sessionLive, null)
  assert.equal(state.usage.sampling, 'ok')
  assert.equal(state.settings.security, undefined)
  assert.equal(state.settings.focus.workMinutes, 25)
  assert.deepEqual(state.sessions, [{ id: 'session-a', running: false }, { id: 'session-b', running: false }])
  assert.deepEqual(state.events, [])
  assert.equal(state.lock.locked, false)
  assert.equal(state.alerts.volume, 0.6)
  assert.equal(result.headers['cache-control'], 'no-store')
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

test('settings round-trip without exposing the password', async () => {
  const fixture = await makeFixture()
  const read = await call(fixture.api, makeRequest({ url: ROUTES.settings }))
  assert.equal(read.status, 200)
  assert.equal(read.json.hasPassword, false)
  assert.equal(read.json.settings.security, undefined)

  const write = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    headers: { host: HOST, origin: `http://${HOST}` },
    body: JSON.stringify({ settings: { focus: { workMinutes: 50 }, alerts: { volume: 2 } } }),
  }))
  assert.equal(write.status, 200)
  assert.equal(write.json.settings.focus.workMinutes, 50)
  assert.equal(write.json.settings.alerts.volume, 1)

  const password = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    headers: { host: HOST, origin: `http://${HOST}` },
    body: JSON.stringify({ password: 'secret123' }),
  }))
  assert.equal(password.status, 200)
  assert.equal(password.json.hasPassword, true)
  assert.equal(password.body.includes('passwordHash'), false)
  assert.equal(fixture.settings.hasPassword(), true)

  const badClear = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    headers: { host: HOST },
    body: JSON.stringify({ clearPassword: true, currentPassword: 'wrong' }),
  }))
  assert.equal(badClear.status, 403)
  assert.equal(badClear.json.error.code, 'bad-current-password')

  const shortPassword = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    headers: { host: HOST },
    body: JSON.stringify({ password: 'abc', currentPassword: 'secret123' }),
  }))
  assert.equal(shortPassword.status, 400)
  assert.equal(shortPassword.json.error.code, 'password-too-short')
})

test('settings bodies reject malformed and oversized payloads', async () => {
  const fixture = await makeFixture()
  const badJson = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.settings, body: '{nope' }))
  assert.equal(badJson.status, 400)
  assert.equal(badJson.json.error.code, 'bad-json')
  const tooLarge = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.settings,
    body: JSON.stringify({ settings: { task: 'x'.repeat(40_000) } }),
  }))
  assert.equal(tooLarge.status, 413)
  assert.equal(tooLarge.json.error.code, 'body-too-large')
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

test('unlock is rejected when nothing is locked', async () => {
  const fixture = await makeFixture()
  const result = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.unlock, body: JSON.stringify({ password: 'x' }) }))
  assert.equal(result.status, 409)
  assert.equal(result.json.error.code, 'not-locked')
})

test('GET /state refreshes the budget lock', async () => {
  const fixture = await makeFixture()
  await fixture.settings.update({ limits: { dailyActiveMinutes: 1 } })
  for (let index = 0; index < 14; index += 1) {
    fixture.tracker.sample(100, fixture.clock)
    fixture.advance(5000)
  }
  const result = await call(fixture.api, makeRequest({ url: ROUTES.state }))
  assert.equal(result.json.lock.locked, true)
  assert.equal(result.json.lock.reason, 'daily')
})

test('ending focus while locked releases the budget lock (rest escape)', async () => {
  const fixture = await makeFixture()
  const started = await call(fixture.api, makeRequest({
    method: 'POST',
    url: ROUTES.focusStart,
    body: JSON.stringify({ sessionId: 'session-a', workMinutes: 25 }),
  }))
  assert.equal(started.status, 200)
  await fixture.settings.update({ limits: { dailyActiveMinutes: 1 } })
  for (let index = 0; index < 14; index += 1) {
    fixture.tracker.sample(100, fixture.clock)
    fixture.advance(5000)
  }
  const locked = await call(fixture.api, makeRequest({ url: ROUTES.state }))
  assert.equal(locked.json.lock.locked, true)
  const stopped = await call(fixture.api, makeRequest({ method: 'POST', url: ROUTES.focusStop, body: '{}' }))
  assert.equal(stopped.status, 200)
  assert.equal(stopped.json.state.focus.phase, 'idle')
  assert.equal(stopped.json.state.lock.locked, false)
  assert.ok(stopped.json.state.lock.unlockUntil > stopped.json.state.now)
})

test('GET /stats returns the requested number of days', async () => {
  const fixture = await makeFixture()
  const result = await call(fixture.api, makeRequest({ url: `${ROUTES.stats}?days=3` }))
  assert.equal(result.status, 200)
  assert.equal(result.json.days.length, 3)
  assert.deepEqual(Object.keys(result.json.days[0]).sort(), ['activeMs', 'breakCount', 'day', 'focusMs', 'pomodoros', 'unlocks'])
  assert.equal(result.json.today.day, result.json.days[2].day)
})
