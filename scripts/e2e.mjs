#!/usr/bin/env node
/**
 * Live API smoke test for dsh-deep-focus v1 (conversation lock + DingTalk notice).
 *
 * The Host must be running with the plugin enabled. Pass the plugin API base URL:
 *
 *   node scripts/e2e.mjs http://127.0.0.1:61556/plugins/dsh-deep-focus/api
 *
 * What it checks (live Host only):
 *   - GET  /state              -> contract 5, now, lock fields, public settings, notify
 *   - GET  /settings           -> { ok, state } with the public settings shape only
 *   - POST /settings           -> token set / keep (empty string) / clear (null)*
 *   - POST /lock/skip          -> 409 `no-lock` when no lock is active
 *   - POST /notifications/test -> 409 `not-configured` when DingTalk is unconfigured
 *   - same-origin POST         -> rejected from a foreign Origin
 *   - unknown route / method   -> 404 / 405
 *
 * (*) When a token is already configured, the destructive clear test is skipped so a
 * real token is never removed; keep-semantics is still verified.
 *
 * Settings changed during the run are restored at the end (the enabled flag; the token
 * is only touched when no token was configured). A live lock is released via /lock/skip.
 */
import process from 'node:process'

const DEFAULT_BASE = 'http://127.0.0.1:61556/plugins/dsh-deep-focus/api'
const BASE = (process.argv[2] || process.env.DSH_DEEP_FOCUS_API || DEFAULT_BASE).replace(/\/+$/, '')
const TIMEOUT_MS = 8000

const results = []
function pass(name, detail) {
  results.push({ ok: true, name })
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, message) {
  results.push({ ok: false, name })
  console.log(`FAIL  ${name}: ${message}`)
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, options = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const headers = { accept: 'application/json', ...(options.headers || {}) }
    if (options.body) headers['content-type'] = 'application/json'
    const response = await fetch(`${BASE}${path}`, { ...options, signal: controller.signal, headers })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    return { status: response.status, body }
  } finally {
    clearTimeout(timer)
  }
}

/** `/state` returns the state at the top level; settings responses may wrap it in `state`. */
function stateOf(body) {
  if (body && typeof body === 'object' && body.state && typeof body.state === 'object') return body.state
  return body
}

/** Settings are either `body.settings` (settings routes) or `body.state.settings`. */
function settingsOf(body) {
  if (body && typeof body === 'object' && body.settings && typeof body.settings === 'object') return body.settings
  return stateOf(body)?.settings
}

function isPublicSettings(settings) {
  if (!settings || typeof settings !== 'object') return false
  if (!settings.notifications || typeof settings.notifications !== 'object') return false
  const notifications = settings.notifications
  if ('dingtalkToken' in notifications) return false
  return (
    typeof notifications.dingtalkEnabled === 'boolean' &&
    typeof notifications.dingtalkTokenSet === 'boolean' &&
    typeof notifications.dingtalkTokenHint === 'string'
  )
}

function assertStateShape(state) {
  assert(state && typeof state === 'object', 'state body must be an object')
  const version = state.version ?? state.contract
  assert(version === 5, `state.version must be 5, found ${version}`)
  assert(typeof state.now === 'number', 'state.now must be a number')
  assert(state.lock && typeof state.lock === 'object', 'state.lock must be an object')
  for (const key of ['active', 'sessionId', 'title', 'startedAt', 'elapsedMs']) {
    assert(key in state.lock, `state.lock.${key} is missing`)
  }
  assert(typeof state.lock.active === 'boolean', 'state.lock.active must be a boolean')
  assert(isPublicSettings(state.settings), 'state.settings must be the public shape (no token)')
}

async function main() {
  console.log(`dsh-deep-focus e2e → ${BASE}`)

  // 1. Read the current state and settings.
  const stateResponse = await request('/state')
  assert(stateResponse.status === 200, `GET /state expected 200, found ${stateResponse.status}`)
  assertStateShape(stateResponse.body)
  pass('GET /state', 'contract 5, lock + public settings shape')

  const settingsResponse = await request('/settings')
  assert(settingsResponse.status === 200, `GET /settings expected 200, found ${settingsResponse.status}`)
  const currentSettings = settingsOf(settingsResponse.body)
  assert(isPublicSettings(currentSettings), 'GET /settings must expose the public settings shape')
  pass('GET /settings', 'public shape, token never returned')

  const tokenSet = currentSettings.notifications.dingtalkTokenSet === true
  const originalEnabled = currentSettings.notifications.dingtalkEnabled === true
  let tokenTouched = false

  try {
    // 2. Token round-trip. Never destroy a real configured token.
    if (!tokenSet) {
      const setResponse = await request('/settings', {
        method: 'POST',
        body: JSON.stringify({ notifications: { dingtalkToken: 'e2e-test-token' } }),
      })
      assert(setResponse.status === 200, `token set expected 200, found ${setResponse.status}`)
      const setSettings = settingsOf(setResponse.body)
      assert(isPublicSettings(setSettings), 'POST /settings must return the public shape')
      assert(setSettings.notifications.dingtalkTokenSet === true, 'token set must report tokenSet=true')
      tokenTouched = true
      pass('POST /settings token set', 'stored, flag true, value hidden')

      const keepResponse = await request('/settings', {
        method: 'POST',
        body: JSON.stringify({ notifications: { dingtalkToken: '' } }),
      })
      assert(keepResponse.status === 200, `token keep expected 200, found ${keepResponse.status}`)
      assert(settingsOf(keepResponse.body).notifications.dingtalkTokenSet === true, 'empty token must keep the stored token')
      pass('POST /settings token keep', 'empty string keeps the token')

      const clearResponse = await request('/settings', {
        method: 'POST',
        body: JSON.stringify({ notifications: { dingtalkToken: null } }),
      })
      assert(clearResponse.status === 200, `token clear expected 200, found ${clearResponse.status}`)
      assert(settingsOf(clearResponse.body).notifications.dingtalkTokenSet === false, 'null must clear the token')
      tokenTouched = false
      pass('POST /settings token clear', 'null removes the token')
    } else {
      const keepResponse = await request('/settings', {
        method: 'POST',
        body: JSON.stringify({ notifications: { dingtalkToken: '' } }),
      })
      assert(keepResponse.status === 200, `token keep expected 200, found ${keepResponse.status}`)
      assert(settingsOf(keepResponse.body).notifications.dingtalkTokenSet === true, 'a configured token must survive an empty patch')
      pass('POST /settings token keep', 'existing token preserved (clear test skipped)')
    }

    // 3. The test route rejects an unconfigured notification setup.
    const disableResponse = await request('/settings', {
      method: 'POST',
      body: JSON.stringify({ notifications: { dingtalkEnabled: false } }),
    })
    assert(disableResponse.status === 200, `disable expected 200, found ${disableResponse.status}`)
    const testResponse = await request('/notifications/test', { method: 'POST', body: '{}' })
    assert(
      testResponse.status === 409,
      `POST /notifications/test must return 409 when unconfigured, found ${testResponse.status}`,
    )
    pass('POST /notifications/test unconfigured', '409 as expected')

    // 4. Skip with and without an active lock.
    const beforeSkip = await request('/state')
    if (stateOf(beforeSkip.body)?.lock?.active === true) {
      const skipActive = await request('/lock/skip', { method: 'POST', body: '{}' })
      assert(skipActive.status === 200, `skip on an active lock expected 200, found ${skipActive.status}`)
      pass('POST /lock/skip (active)', 'lock released')
    }
    const skipIdle = await request('/lock/skip', { method: 'POST', body: '{}' })
    assert(skipIdle.status === 409, `skip without a lock must be 409, found ${skipIdle.status}`)
    pass('POST /lock/skip (idle)', '409 as expected')

    // 5. Same-origin, unknown route, wrong method.
    const foreign = await request('/settings', {
      method: 'POST',
      headers: { origin: 'http://evil.example' },
      body: JSON.stringify({ notifications: { dingtalkEnabled: false } }),
    })
    assert([400, 403, 404].includes(foreign.status), `cross-origin POST must be rejected, found ${foreign.status}`)
    pass('same-origin POST', `rejected with ${foreign.status}`)

    const missing = await request('/does-not-exist')
    assert(missing.status === 404, `unknown route expected 404, found ${missing.status}`)
    const wrongMethod = await request('/state', { method: 'DELETE' })
    assert(wrongMethod.status === 405, `DELETE /state expected 405, found ${wrongMethod.status}`)
    pass('unknown route / wrong method', '404 / 405 as expected')

    // 6. Restore the settings this run changed.
    const restorePatch = tokenTouched
      ? { notifications: { dingtalkEnabled: originalEnabled, dingtalkToken: null } }
      : { notifications: { dingtalkEnabled: originalEnabled } }
    await request('/settings', { method: 'POST', body: JSON.stringify(restorePatch) })
    const restored = await request('/state')
    assertStateShape(restored.body)
    assert(
      stateOf(restored.body).settings.notifications.dingtalkEnabled === originalEnabled,
      'settings were not restored',
    )
    pass('restore settings', 'enabled flag restored')
  } catch (error) {
    fail('e2e flow', error && error.message ? error.message : String(error))
  }

  const failed = results.filter((result) => !result.ok)
  console.log('')
  if (failed.length > 0) {
    console.log(`e2e: ${failed.length} check(s) failed, ${results.length - failed.length}/${results.length} passed`)
    process.exitCode = 1
    return
  }
  console.log(`e2e: all ${results.length} checks passed (settings restored)`)
}

main().catch((error) => {
  console.error(`e2e: ${error && error.message ? error.message : error}`)
  console.error(`Is the Host running and the plugin enabled? Pass the API base URL, e.g. ${DEFAULT_BASE}`)
  process.exitCode = 1
})
