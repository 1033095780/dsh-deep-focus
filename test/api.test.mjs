import assert from 'node:assert/strict'
import test from 'node:test'
import { createApi, routePathOf } from '../src/host/api.js'
import { API_BASE, ROUTES, applySettingsPatch, publicSettings } from '../src/shared/contract.js'

function makeResponse() {
  return {
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

function makeRequest({ method = 'GET', url, headers = {}, body = null } = {}) {
  const chunks = body === null ? [] : [Buffer.from(body)]
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
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

function makeSettingsStore(initial = { dingtalkEnabled: false, dingtalkToken: '' }) {
  let current = {
    version: 5,
    notifications: { dingtalkEnabled: initial.dingtalkEnabled, dingtalkToken: initial.dingtalkToken },
  }
  const updates = []
  return {
    updates,
    get: () => current,
    getPublic: () => publicSettings(current),
    async update(patch) {
      updates.push(patch)
      current = applySettingsPatch(current, patch)
      return current
    },
  }
}

function makeApi({
  lock = { active: false, sessionId: null, title: '', startedAt: 0, elapsedMs: 0 },
  skipResult = false,
  notifications = { dingtalkEnabled: false, dingtalkToken: '' },
  now = () => 1_700_000_000_000,
} = {}) {
  const settings = makeSettingsStore(notifications)
  const notifier = {
    enabled: () => notifications.dingtalkEnabled && notifications.dingtalkToken.length > 0,
    sendTest: async () => ({ ok: true, attempts: 1 }),
    lastResult: () => null,
  }
  const controller = {
    view: () => lock,
    skip: () => skipResult,
  }
  return { api: createApi({ settings, controller, notifier, now }), settings, notifier }
}

test('GET /state is a tiny contract-v5 payload with the lock view', async () => {
  const { api } = makeApi()
  const result = await call(api, makeRequest({ url: ROUTES.state }))
  assert.equal(result.status, 200)
  assert.equal(result.headers['cache-control'], 'no-store')
  assert.deepEqual(Object.keys(result.json).sort(), ['lock', 'notify', 'now', 'ok', 'settings', 'version'])
  assert.equal(result.json.ok, true)
  assert.equal(result.json.version, 5)
  assert.deepEqual(result.json.lock, { active: false, sessionId: null, title: '', startedAt: 0, elapsedMs: 0 })
  assert.equal(result.json.notify.configured, false)
})

test('an active lock is reflected in GET /state', async () => {
  const lock = { active: true, sessionId: 'root-1', title: '修复登录', startedAt: 1000, elapsedMs: 5000 }
  const { api } = makeApi({ lock })
  const result = await call(api, makeRequest({ url: ROUTES.state }))
  assert.deepEqual(result.json.lock, lock)
})

test('state never exposes the DingTalk token', async () => {
  const { api } = makeApi({ notifications: { dingtalkEnabled: true, dingtalkToken: 'super-secret-token' } })
  const result = await call(api, makeRequest({ url: ROUTES.state }))
  assert.equal(result.body.includes('super-secret-token'), false)
  assert.equal(result.json.settings.notifications.dingtalkTokenSet, true)
  assert.equal(result.json.notify.configured, true)
})

test('GET /settings returns the same small state', async () => {
  const { api } = makeApi()
  const result = await call(api, makeRequest({ url: ROUTES.settings }))
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.version, 5)
  assert.ok(result.json.settings)
  assert.equal('dingtalkToken' in result.json.settings.notifications, false)
})

test('POST /settings applies a wrapped patch and returns fresh state', async () => {
  const { api, settings } = makeApi()
  const body = JSON.stringify({ settings: { notifications: { dingtalkEnabled: true, dingtalkToken: 'abc12345' } } })
  const result = await call(api, makeRequest({ method: 'POST', url: ROUTES.settings, body }))
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(settings.updates.length, 1)
  assert.equal(result.json.settings.notifications.dingtalkEnabled, true)
  assert.equal(result.body.includes('abc12345'), false)
})

test('POST /settings accepts a raw patch object', async () => {
  const { api, settings } = makeApi()
  const body = JSON.stringify({ notifications: { dingtalkEnabled: true } })
  const result = await call(api, makeRequest({ method: 'POST', url: ROUTES.settings, body }))
  assert.equal(result.status, 200)
  assert.equal(result.json.settings.notifications.dingtalkEnabled, true)
  assert.equal(settings.get().notifications.dingtalkEnabled, true)
})

test('POST /settings rejects non-object payloads', async () => {
  const { api } = makeApi()
  const result = await call(api, makeRequest({ method: 'POST', url: ROUTES.settings, body: '[1,2,3]' }))
  assert.equal(result.status, 400)
  assert.equal(result.json.error.code, 'invalid-settings')
})

test('POST /settings rejects invalid JSON', async () => {
  const { api } = makeApi()
  const result = await call(api, makeRequest({ method: 'POST', url: ROUTES.settings, body: '{oops' }))
  assert.equal(result.status, 400)
  assert.equal(result.json.error.code, 'bad-json')
})

test('POST /settings rejects an oversized body', async () => {
  const { api } = makeApi()
  const big = JSON.stringify({ settings: { pad: 'x'.repeat(40 * 1024) } })
  const result = await call(api, makeRequest({ method: 'POST', url: ROUTES.settings, body: big }))
  assert.equal(result.status, 413)
  assert.equal(result.json.error.code, 'body-too-large')
})

test('POST /lock/skip clears an active lock', async () => {
  const { api } = makeApi({ skipResult: true })
  const result = await call(api, makeRequest({ method: 'POST', url: ROUTES.skip, body: '{}' }))
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
})

test('POST /lock/skip reports 409 when no lock is active', async () => {
  const { api } = makeApi({ skipResult: false })
  const result = await call(api, makeRequest({ method: 'POST', url: ROUTES.skip, body: '{}' }))
  assert.equal(result.status, 409)
  assert.equal(result.json.error.code, 'no-lock')
})

test('POST /notifications/test reports 409 when unconfigured', async () => {
  const { api } = makeApi()
  const result = await call(api, makeRequest({ method: 'POST', url: ROUTES.testNotify, body: '{}' }))
  assert.equal(result.status, 409)
  assert.equal(result.json.error.code, 'not-configured')
})

test('POST /notifications/test sends when configured', async () => {
  const { api } = makeApi({ notifications: { dingtalkEnabled: true, dingtalkToken: 'token-1234' } })
  const result = await call(api, makeRequest({ method: 'POST', url: ROUTES.testNotify, body: '{}' }))
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(result.json.delivered, true)
  assert.equal(result.body.includes('token-1234'), false)
})

test('cross-site requests are refused', async () => {
  const { api } = makeApi()
  const result = await call(api, makeRequest({ url: ROUTES.state, headers: { 'sec-fetch-site': 'cross-site' } }))
  assert.equal(result.status, 403)
  assert.equal(result.json.error.code, 'untrusted-origin')
})

test('origin must match the request authority when present', async () => {
  const { api } = makeApi()
  const bad = await call(api, makeRequest({
    url: ROUTES.state,
    headers: { origin: 'https://evil.example', host: '127.0.0.1:57544' },
  }))
  assert.equal(bad.status, 403)
  const good = await call(api, makeRequest({
    url: ROUTES.state,
    headers: { origin: 'http://127.0.0.1:57544', host: '127.0.0.1:57544' },
  }))
  assert.equal(good.status, 200)
  const sameHostNoPort = await call(api, makeRequest({
    url: ROUTES.state,
    headers: { origin: 'http://localhost', host: 'localhost:57544' },
  }))
  assert.equal(sameHostNoPort.status, 200)
})

test('the registered API_BASE prefix is stripped from request URLs', async () => {
  const { api } = makeApi()
  const result = await call(api, makeRequest({ url: `${API_BASE}${ROUTES.state}` }))
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(routePathOf(`${API_BASE}${ROUTES.state}`), ROUTES.state)
  assert.equal(routePathOf(`${API_BASE}${ROUTES.state}?x=1`), ROUTES.state)
})

test('unknown paths are 404 and wrong methods are 405', async () => {
  const { api } = makeApi()
  const missing = await call(api, makeRequest({ url: '/nope' }))
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'not-found')
  const wrongMethod = await call(api, makeRequest({ method: 'DELETE', url: ROUTES.state }))
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.json.error.code, 'method-not-allowed')
})

test('error responses remain small and token-free', async () => {
  const { api } = makeApi({ notifications: { dingtalkEnabled: true, dingtalkToken: 'leak-me-if-you-can' } })
  const responses = [
    await call(api, makeRequest({ method: 'POST', url: ROUTES.skip, body: '{}' })),
    await call(api, makeRequest({ url: '/missing' })),
    await call(api, makeRequest({ url: ROUTES.state, headers: { 'sec-fetch-site': 'cross-site' } })),
  ]
  for (const response of responses) {
    assert.equal(response.body.includes('leak-me-if-you-can'), false)
    assert.ok(response.body.length < 512)
  }
})
