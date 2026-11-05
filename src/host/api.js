/**
 * Same-origin HTTP JSON API v2: state, stats, per-app usage, settings, focus
 * commands and one-click unlock. Handlers never throw to the webServer.
 */
import { API_BASE, ROUTES, isPlainObject } from '../shared/contract.js'
import { appsToRows, appsTotal } from './apps.js'
import { localDayKey, shiftDayKey } from './storage.js'

export const BODY_LIMIT_BYTES = 32 * 1024
export const MAX_STATS_DAYS = 90
export const MAX_APPS_DAYS = 31
export const TOP_APPS_LIMIT = 8

const noop = () => {}

/** Loopback authorities a browser page may use (`127.0.0.1`, `localhost`, `[::1]`). */
export function isLoopbackAuthority(host) {
  if (typeof host !== 'string') return false
  const lower = host.trim().toLowerCase()
  if (lower.length === 0) return false
  const name = lower.startsWith('[') ? lower.slice(0, lower.indexOf(']') + 1) : lower.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]'
}

function hostnameOf(authority) {
  const lower = authority.trim().toLowerCase()
  return lower.startsWith('[') ? lower.slice(0, lower.indexOf(']') + 1) : lower.split(':')[0]
}

/**
 * Trust rule for every route, reads included.
 * Host/Origin absence is allowed (non-browser clients and the Desktop proxy strip
 * them); a present Origin must match the request authority, and a page that states
 * `cross-site` is always refused. Chrome omits the port on loopback Origins.
 */
export function isTrustedRequest(headers = {}) {
  if (headers['sec-fetch-site'] === 'cross-site') return false
  const rawOrigin = headers.origin
  if (rawOrigin === undefined) return true
  if (typeof rawOrigin !== 'string' || rawOrigin.length === 0 || rawOrigin === 'null') return false
  let origin
  try {
    origin = new URL(rawOrigin)
  } catch {
    return false
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return false
  const rawHost = headers.host
  if (typeof rawHost !== 'string' || rawHost.length === 0) return true
  const host = rawHost.toLowerCase()
  if (origin.host.toLowerCase() === host) return true
  if (origin.port === '' && isLoopbackAuthority(host) && hostnameOf(origin.hostname) === hostnameOf(host)) return true
  return false
}

/** Read a size-capped JSON body; rejects with a stable `code` for the API layer. */
export async function readJsonBody(request, maxBytes = BODY_LIMIT_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) {
      const error = new Error('request body too large')
      error.code = 'body-too-large'
      throw error
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text.length === 0) return {}
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error('request body is not valid JSON')
    error.code = 'bad-json'
    throw error
  }
}

function sendJson(response, status, payload) {
  if (response.headersSent || response.writableEnded) return
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(`${JSON.stringify(payload)}\n`)
}

const ERROR_STATUS = { 'body-too-large': 413, 'bad-json': 400, 'invalid-settings': 400, internal: 500 }

function errorPayload(error) {
  const code = typeof error?.code === 'string' && ERROR_STATUS[error.code] !== undefined ? error.code : 'internal'
  return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error) } }
}

function errorMessage(code) {
  const messages = {
    'already-running': 'A focus session is already running.',
    'not-running': 'No focus session is running.',
    'not-paused': 'The focus session is not paused.',
    'not-locked': 'The app is not locked.',
    'untrusted-origin': 'This request came from an untrusted origin and was refused.',
    'body-too-large': 'The request body is too large.',
    'bad-json': 'The request body is not valid JSON.',
    'invalid-settings': 'The settings payload must be a JSON object.',
    'not-found': 'Unknown deep-focus API path.',
  }
  return messages[code] ?? code
}

/**
 * Build the API facade. `buildState()` is also used by route handlers after a
 * mutation so the browser receives the fresh authoritative state immediately.
 */
export function createApi({
  settings,
  tracker,
  focus,
  budget,
  sampler,
  ring,
  statusMap,
  agents,
  storage = null,
  now = Date.now,
  onChange = noop,
}) {
  function listSessions() {
    try {
      const list = agents.list()
      if (!Array.isArray(list)) return []
      return list
        .filter((agent) => typeof agent?.id === 'string')
        .map((agent) => ({ id: agent.id, running: statusMap.isRunning(agent.id) }))
    } catch {
      return []
    }
  }

  function appsSampling(current) {
    if (current.usage.trackApps !== true) return 'off'
    if (sampler.state() === 'off') return 'off'
    return sampler.appsState() === 'ok' ? 'ok' : 'off'
  }

  /** Today lives in memory until the next minute flush; read it from the tracker so pages are immediate. */
  function liveUsage(at) {
    try {
      const snapshot = tracker.snapshot(at)
      return { dayKey: snapshot.dayKey, activeTodayMs: snapshot.activeTodayMs, apps: snapshot.apps }
    } catch {
      return { dayKey: localDayKey(at), activeTodayMs: 0, apps: new Map() }
    }
  }

  function buildState() {
    const at = now()
    // Keep the lock fresh even if a poll arrives between budget timer ticks.
    budget.evaluate(at)
    const current = settings.get()
    const focusView = focus.getView(at)
    const usage = tracker.snapshot(at)
    const lock = budget.getView(at)
    // Optional hint for the browser: a bound session with no live agent cannot
    // hold the UI focus mode, so the sidebar must not stay grayed out.
    let sessionLive = null
    if (typeof focusView.sessionId === 'string' && focusView.sessionId.length > 0) {
      try {
        sessionLive = agents.get(focusView.sessionId) !== undefined
      } catch {
        sessionLive = null
      }
    }
    const appRows = appsToRows(usage.apps)
    return {
      now: at,
      focus: { ...focusView, sessionLive },
      usage: {
        activeTodayMs: usage.activeTodayMs,
        continuousMs: usage.continuousMs,
        sampling: sampler.state(),
        appsSampling: appsSampling(current),
        dayKey: usage.dayKey,
      },
      appsToday: {
        totalMs: Math.round(appsTotal(usage.apps)),
        top: appRows.slice(0, TOP_APPS_LIMIT),
      },
      lock,
      alerts: {
        sound: current.alerts.sound,
        volume: current.alerts.volume,
        quietHoursStart: current.alerts.quietHoursStart,
        quietHoursEnd: current.alerts.quietHoursEnd,
      },
      settings: settings.getPublic(),
      sessions: listSessions(),
      events: ring.list(),
    }
  }

  async function buildStats(requestedDays) {
    const parsed = Number(requestedDays)
    const days = Number.isFinite(parsed) ? Math.min(MAX_STATS_DAYS, Math.max(1, Math.round(parsed))) : 7
    const at = now()
    const live = liveUsage(at)
    const todayKey = live.dayKey
    const rows = []
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = shiftDayKey(todayKey, -offset)
      const usage = day === todayKey
        ? { activeMs: live.activeTodayMs }
        : storage === null ? { activeMs: 0 } : await storage.readUsageDay(day)
      const records = storage === null ? [] : await storage.readJsonl(`stats/${day}.jsonl`)
      let focusMs = 0
      let breakCount = 0
      let pomodoros = 0
      let unlocks = 0
      for (const record of records) {
        if (record === null || typeof record !== 'object') continue
        if (record.kind === 'focus' && Number.isFinite(record.ms)) focusMs += Math.max(0, record.ms)
        else if (record.kind === 'break') breakCount += 1
        else if (record.kind === 'pomodoro') pomodoros += 1
        else if (record.kind === 'unlock') unlocks += 1
      }
      rows.push({ day, activeMs: Math.round(usage.activeMs), focusMs, breakCount, pomodoros, unlocks })
    }
    return {
      ok: true,
      retentionDays: settings.get().usage.retentionDays,
      days: rows,
      today: rows[rows.length - 1],
      totalActiveMs: rows.reduce((sum, row) => sum + row.activeMs, 0),
      totalFocusMs: rows.reduce((sum, row) => sum + row.focusMs, 0),
    }
  }

  async function buildApps(requestedDays) {
    const parsed = Number(requestedDays)
    const days = Number.isFinite(parsed) ? Math.min(MAX_APPS_DAYS, Math.max(1, Math.round(parsed))) : 7
    const at = now()
    const live = liveUsage(at)
    const todayKey = live.dayKey
    const rows = []
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = shiftDayKey(todayKey, -offset)
      const usage = day === todayKey
        ? { activeMs: live.activeTodayMs, apps: live.apps }
        : storage === null ? { activeMs: 0, apps: new Map() } : await storage.readUsageDay(day)
      rows.push({ day, activeMs: Math.round(usage.activeMs), apps: appsToRows(usage.apps) })
    }
    const today = rows[rows.length - 1]
    return {
      ok: true,
      retentionDays: settings.get().usage.retentionDays,
      days: rows,
      today,
      top: today.apps.slice(0, TOP_APPS_LIMIT),
    }
  }

  async function handleStateCommand(request, response, action) {
    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      sendJson(response, ERROR_STATUS[error.code] ?? 400, errorPayload(error))
      return
    }
    if (!isPlainObject(body)) {
      sendJson(response, 400, { ok: false, error: { code: 'bad-json', message: errorMessage('bad-json') } })
      return
    }
    let result
    if (action === 'start') {
      result = focus.start({
        sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
        task: typeof body.task === 'string' ? body.task : null,
        workMinutes: typeof body.workMinutes === 'number' ? body.workMinutes : undefined,
      })
    } else if (action === 'pause') {
      result = focus.pause()
    } else if (action === 'resume') {
      result = focus.resume()
    } else if (action === 'stop') {
      result = focus.stop(typeof body.reason === 'string' ? body.reason : 'user')
    } else {
      result = focus.complete('user')
    }
    if (!result.ok) {
      sendJson(response, 409, { ok: false, error: { code: result.code, message: errorMessage(result.code) } })
      return
    }
    if (action === 'stop' || action === 'complete') tracker.resetContinuous()
    budget.evaluate(now())
    sendJson(response, 200, { ok: true, state: buildState() })
  }

  async function handleSettingsWrite(request, response) {
    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      sendJson(response, ERROR_STATUS[error.code] ?? 400, errorPayload(error))
      return
    }
    if (!isPlainObject(body) || (body.settings !== undefined && !isPlainObject(body.settings))) {
      sendJson(response, 400, { ok: false, error: { code: 'invalid-settings', message: errorMessage('invalid-settings') } })
      return
    }
    if (body.settings !== undefined) await settings.update(body.settings)
    onChange(settings.get())
    sendJson(response, 200, { ok: true, settings: settings.getPublic() })
  }

  async function handleUnlock(request, response) {
    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      sendJson(response, ERROR_STATUS[error.code] ?? 400, errorPayload(error))
      return
    }
    if (!isPlainObject(body)) {
      sendJson(response, 400, { ok: false, error: { code: 'bad-json', message: errorMessage('bad-json') } })
      return
    }
    const result = budget.unlock({ mode: body.mode === 'rest' ? 'rest' : 'click' })
    if (!result.ok) {
      sendJson(response, 409, { ok: false, error: { code: result.code, message: errorMessage(result.code) } })
      return
    }
    budget.evaluate(now())
    sendJson(response, 200, { ok: true, state: buildState() })
  }

  const table = [
    {
      method: 'GET',
      path: ROUTES.state,
      handler: (request, response) => sendJson(response, 200, buildState()),
    },
    {
      method: 'GET',
      path: ROUTES.stats,
      handler: async (request, response, url) => sendJson(response, 200, await buildStats(url.searchParams.get('days'))),
    },
    {
      method: 'GET',
      path: ROUTES.apps,
      handler: async (request, response, url) => sendJson(response, 200, await buildApps(url.searchParams.get('days'))),
    },
    {
      method: 'GET',
      path: ROUTES.settings,
      handler: (request, response) => sendJson(response, 200, { ok: true, settings: settings.getPublic() }),
    },
    { method: 'POST', path: ROUTES.settings, handler: handleSettingsWrite },
    { method: 'POST', path: ROUTES.focusStart, handler: (request, response) => handleStateCommand(request, response, 'start') },
    { method: 'POST', path: ROUTES.focusPause, handler: (request, response) => handleStateCommand(request, response, 'pause') },
    { method: 'POST', path: ROUTES.focusResume, handler: (request, response) => handleStateCommand(request, response, 'resume') },
    { method: 'POST', path: ROUTES.focusStop, handler: (request, response) => handleStateCommand(request, response, 'stop') },
    { method: 'POST', path: ROUTES.focusComplete, handler: (request, response) => handleStateCommand(request, response, 'complete') },
    { method: 'POST', path: ROUTES.unlock, handler: handleUnlock },
  ]

  async function handle(request, response) {
    try {
      if (!isTrustedRequest(request.headers)) {
        sendJson(response, 403, { ok: false, error: { code: 'untrusted-origin', message: errorMessage('untrusted-origin') } })
        return
      }
      const url = new URL(typeof request.url === 'string' ? request.url : '/', 'http://127.0.0.1')
      const pathname = url.pathname.replace(/\/+$/, '') || '/'
      const matches = table.filter((route) => route.path === pathname)
      if (matches.length === 0) {
        sendJson(response, 404, { ok: false, error: { code: 'not-found', message: errorMessage('not-found') } })
        return
      }
      const route = matches.find((candidate) => candidate.method === request.method)
      if (route === undefined) {
        response.writeHead(405, { allow: matches.map((candidate) => candidate.method).join(', ') })
        response.end()
        return
      }
      await route.handler(request, response, url)
    } catch (error) {
      if (response.headersSent) {
        response.end()
        return
      }
      sendJson(response, ERROR_STATUS[error?.code] ?? 500, errorPayload(error))
    }
  }

  return { buildState, buildStats, buildApps, handle }
}

/** Register the API route on the Host web server; returns the disposer. */
export function registerApi({ ctx, api }) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: API_BASE,
    handler: (request, response) => {
      void api.handle(request, response)
    },
  })
}
