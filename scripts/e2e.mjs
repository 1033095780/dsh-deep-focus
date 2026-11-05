#!/usr/bin/env node
/**
 * Live end-to-end smoke test for the running dsh-deep-focus plugin.
 *
 * Usage:
 *   node scripts/e2e.mjs [baseUrl]
 * Default: http://127.0.0.1:61556/plugins/dsh-deep-focus/api
 *
 * It only talks to the plugin's own HTTP API (no DSH internals), so it works
 * against a live Host. It changes settings temporarily and always restores
 * them, and it never installs, enables or restarts anything.
 */

const BASE = (process.argv[2] || process.env.DSH_DEEP_FOCUS_API || 'http://127.0.0.1:61556/plugins/dsh-deep-focus/api').replace(/\/+$/, '')

const results = []
let failed = 0
let skipped = 0

function ok(name, detail = '') {
  results.push({ ok: true, name, detail })
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name, detail = '') {
  failed += 1
  results.push({ ok: false, name, detail })
  console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
}
function assert(condition, name, detail = '') {
  if (condition) ok(name, detail)
  else fail(name, detail)
}
function skipCheck(name, detail = '') {
  skipped += 1
  results.push({ ok: true, name, detail, skipped: true })
  console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function req(method, path, body) {
  const init = { method, headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) }
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  const response = await fetch(`${BASE}${path}`, init)
  let json = null
  try {
    json = await response.json()
  } catch {
    // Non-JSON responses (405/404 with an empty body) are valid in some checks.
  }
  return { status: response.status, json }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function state() {
  const { status, json } = await req('GET', '/state')
  if (status !== 200 || json === null || typeof json !== 'object') throw new Error(`GET /state -> ${status}`)
  return json
}

async function patchSettings(patch) {
  const { status, json } = await req('POST', '/settings', { settings: patch })
  if (status !== 200 || json?.ok !== true) throw new Error(`POST /settings -> ${status} ${JSON.stringify(json)}`)
  return json.settings
}

async function main() {
  // 1. Contract + health.
  const s0 = await state()
  assert(s0.settings?.version === 4, 'state reports settings version 4')
  assert(typeof s0.usage?.sampling === 'string', 'usage.sampling present')
  assert(Array.isArray(s0.sessions), 'sessions is an array')
  assert(typeof s0.solo === 'object' && Array.isArray(s0.solo.sessions), 'solo shape present')
  assert(typeof s0.limit?.paused === 'boolean', 'limit.paused present')
  assert(s0.limit?.extendLimit === 0 || typeof s0.limit?.extendLimit === 'number', 'limit.extendLimit numeric')
  assert(Array.isArray(s0.appsToday?.top), 'appsToday.top is an array')
  assert(typeof s0.usage?.idleMs === 'number' || s0.usage?.idleMs === null, 'usage.idleMs present')

  // 2. /apps shape.
  const apps = await req('GET', '/apps?days=7')
  assert(apps.status === 200 && Array.isArray(apps.json?.days) && apps.json.days.length === 7, '/apps?days=7 returns 7 days')
  assert(Array.isArray(apps.json?.today?.apps), '/apps today.apps is an array')

  // 3. Removed routes stay removed.
  for (const path of ['/stats', '/focus/start']) {
    const r = await req('POST', path, {})
    assert(r.status === 404 || r.status === 405, `removed route ${path} is gone (${r.status})`)
  }

  // 4. Pause / resume stability: resume must hold while the machine is idle
  //    (it must not immediately re-pause on a stale idle sample).
  const originalUsage = (await state()).settings.usage
  await patchSettings({ usage: { autoPauseSeconds: 1, idleThresholdSeconds: 1 } })
  let sawAutoPause = false
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000)
    const s = await state()
    if (s.limit.paused === true && s.limit.pausedReason === 'idle') {
      sawAutoPause = true
      break
    }
  }
  if (!sawAutoPause) {
    const latest = await state()
    const idle = typeof latest.usage?.idleMs === 'number' ? latest.usage.idleMs : null
    // Auto-pause needs the machine to actually be idle. If the user is at the
    // keyboard right now this check cannot be exercised; report it as skipped
    // instead of pretending the plugin failed.
    if (idle !== null && idle < 1000) {
      skipCheck('idle auto-pause fires after usage.autoPauseSeconds', `machine in use (idleMs=${idle})`)
      skipCheck('resume stability: stayed unpaused for 8s', 'depends on auto-pause')
    } else {
      fail('idle auto-pause fires after usage.autoPauseSeconds', `idleMs=${idle}`)
    }
  } else {
    assert(sawAutoPause, 'idle auto-pause fires after usage.autoPauseSeconds')

    const resumedFromAuto = await req('POST', '/resume', {})
    assert(resumedFromAuto.status === 200 && resumedFromAuto.json?.state?.limit?.paused === false, 'resume after auto-pause')

    let repaused = false
    for (let i = 0; i < 8; i += 1) {
      await sleep(1000)
      const s = await state()
      if (s.limit.paused === true) {
        repaused = true
        fail('resume stability: stayed unpaused for 8s', `re-paused after ${i + 1}s (idleMs=${s.usage.idleMs}, reason=${s.limit.pausedReason})`)
        break
      }
    }
    if (!repaused) ok('resume stability: stayed unpaused for 8s')
  }

  const prePause = await state()
  if (prePause.limit.paused === true) await req('POST', '/resume', {})
  const paused = await req('POST', '/pause', {})
  assert(paused.status === 200 && paused.json?.state?.limit?.paused === true, 'POST /pause pauses')
  const dupPause = await req('POST', '/pause', {})
  assert(dupPause.status === 409, 'pause twice -> 409')
  const resumed = await req('POST', '/resume', {})
  assert(resumed.status === 200 && resumed.json?.state?.limit?.paused === false, 'POST /resume resumes')
  await patchSettings({ usage: { autoPauseSeconds: originalUsage.autoPauseSeconds, idleThresholdSeconds: originalUsage.idleThresholdSeconds } })

  // 5. Extend behaviour: not locked -> 409 not-locked.
  const extend = await req('POST', '/extend', {})
  assert(extend.status === 409 && extend.json?.error?.code === 'not-locked', 'extend without a lock -> 409 not-locked')

  // 6. Rest skip: not resting -> 409; manually start a rest then skip it.
  const skipIdle = await req('POST', '/rest/finish', {})
  assert(skipIdle.status === 409, 'rest/finish without a rest -> 409')
  const restStart = await req('POST', '/rest/start', {})
  assert(restStart.status === 200 && restStart.json?.state?.limit?.resting === true, 'rest/start starts a rest')
  const skip = await req('POST', '/rest/finish', {})
  assert(skip.status === 200 && skip.json?.state?.limit?.resting === false, 'rest/finish skips the rest')

  // 7. Settings round-trip + limits are accepted (restore afterwards).
  const before = await state()
  const wanted = before.settings
  await patchSettings({ limits: { dailyMinutes: 181, continuousMinutes: 31, restMinutes: 11 }, usage: { autoPauseSeconds: 120 } })
  const after = await state()
  assert(after.settings.limits.dailyMinutes === 181 && after.settings.limits.restMinutes === 11, 'settings round-trip applies values')
  assert(after.settings.usage.autoPauseSeconds === 120, 'usage.autoPauseSeconds round-trip')
  await patchSettings({
    limits: {
      dailyMinutes: wanted.limits.dailyMinutes,
      continuousMinutes: wanted.limits.continuousMinutes,
      restMinutes: wanted.limits.restMinutes,
      extendMinutes: wanted.limits.extendMinutes,
      dailyExtendLimit: wanted.limits.dailyExtendLimit,
    },
    usage: { autoPauseSeconds: wanted.usage.autoPauseSeconds },
  })
  const restored = await state()
  assert(
    restored.settings.limits.dailyMinutes === wanted.limits.dailyMinutes &&
      restored.settings.usage.autoPauseSeconds === wanted.usage.autoPauseSeconds,
    'settings restored',
  )

  // 8. Assistant toggle round-trip.
  const off = await req('POST', '/assistant', { enabled: false })
  assert(off.status === 200 && off.json?.state?.limit?.assistantEnabled === false, 'assistant off')
  const on = await req('POST', '/assistant', { enabled: true })
  assert(on.status === 200 && on.json?.state?.limit?.assistantEnabled === true, 'assistant on')

  // 9. Bad requests.
  const bad = await req('POST', '/settings', { settings: 'nope' })
  assert(bad.status === 400, 'non-object settings -> 400')
  const unknown = await req('GET', '/nope')
  assert(unknown.status === 404, 'unknown path -> 404')

  console.log('')
  const passed = results.length - failed
  const suffix = skipped > 0 ? ` (${skipped} skipped)` : ''
  console.log(`e2e: ${passed}/${results.length} checks passed${suffix}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(`e2e crashed: ${error?.message ?? error}`)
  process.exitCode = 2
})
