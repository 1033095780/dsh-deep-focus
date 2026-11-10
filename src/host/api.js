/**
 * Same-origin HTTP JSON API: state, per-app usage, settings, assistant switch,
 * pause/resume, forced rest controls and the daily extend action. Handlers never
 * throw to the webServer; every failure becomes a JSON error response.
 */
import { API_BASE, ROUTES, isPlainObject } from '../shared/contract.js'
import { appsToRows, appsTotal } from './apps.js'
import { shiftDayKey } from './storage.js'

const BODY_LIMIT_BYTES = 32 * 1024
const MAX_APPS_DAYS = 31
const TOP_APPS_LIMIT = 8

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

const ERROR_STATUS = { 'body-too-large': 413, 'bad-json': 400, 'invalid-settings': 400, 'invalid-assistant': 400, internal: 500 }

function errorPayload(error) {
  const code = typeof error?.code === 'string' && ERROR_STATUS[error.code] !== undefined ? error.code : 'internal'
  return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error) } }
}

const CONFLICT_STATUS = {
  'already-resting': 409,
  'assistant-off': 409,
  'not-resting': 409,
  'already-paused': 409,
  'not-paused': 409,
  'not-locked': 409,
  'extend-limit-reached': 409,
  'tracking-only': 409,
}

function errorMessage(code) {
  const messages = {
    'untrusted-origin': 'This request came from an untrusted origin and was refused.',
    'body-too-large': 'The request body is too large.',
    'bad-json': 'The request body is not valid JSON.',
    'invalid-settings': 'The settings payload must be a JSON object.',
    'invalid-assistant': 'The assistant payload must be {enabled: boolean}.',
    'already-resting': 'A rest is already running.',
    'assistant-off': 'The focus assistant is off.',
    'not-resting': 'No rest is running.',
    'already-paused': 'Counting is already paused.',
    'not-paused': 'Counting is not paused.',
    'not-locked': 'The daily usage cap is not reached.',
    'extend-limit-reached': "Today's extend limit is used up.",
    'tracking-only': 'Tracking-only mode is on: pause and rest are unavailable.',
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
  limits,
  sampler,
  ring,
  statusMap,
  agents,
  storage = null,
  now = Date.now,
  onChange = noop,
  getSessions = null,
}) {
  function appsSampling(current) {
    if (current.usage.trackApps !== true) return 'off'
    if (sampler.state() === 'off') return 'off'
    return sampler.appsState() === 'ok' ? 'ok' : 'off'
  }

  /**
   * Reconcile the event-derived running flag with the durable turn log, in both
   * directions: repair a flag missed during a reload mid-turn, and drop a stale
   * "running" after the turn ended (so the one-conversation mode never grays the
   * sidebar on a finished conversation). The event source still owns upgrades
   * between polls; this only corrects a provable mismatch and is fully guarded.
   */
  function reconcileRunning(sessions) {
    if (typeof getSessions !== 'function') return
    let store = null
    try {
      store = getSessions()
    } catch {
      return
    }
    if (store === null || store === undefined || typeof store.get !== 'function') return
    if (typeof agents.turnBoundaryOf !== 'function') return
    for (const session of sessions) {
      let live
      try {
        live = store.get(session.id)
      } catch {
        continue
      }
      if (live === undefined || live === null) continue
      try {
        const boundary = agents.turnBoundaryOf(live)
        const openTurn = boundary !== null && boundary !== undefined && boundary.openTurnStartSeq !== null
        if (openTurn && !session.running) {
          statusMap.set(session.id, true)
          session.running = true
        } else if (!openTurn && session.running) {
          statusMap.set(session.id, false)
          session.running = false
        }
      } catch {
        // A session without a readable log boundary keeps the event-derived value.
      }
    }
  }

  function listRootSessions() {
    try {
      const roots = agents.roots()
      if (!Array.isArray(roots)) return []
      return roots
        .filter((agent) => typeof agent?.id === 'string')
        .map((agent) => ({ id: agent.id, running: statusMap.isRunning(agent.id) }))
    } catch {
      return []
    }
  }

  /**
   * The single conversation the one-conversation mode pins to: the running root
   * whose turn started most recently (stable tie-break by session id).
   */
  function primaryRootSession(running) {
    let primary = null
    let newest = Number.NEGATIVE_INFINITY
    for (const id of running) {
      const at = typeof statusMap.startedAt === 'function' ? statusMap.startedAt(id) : null
      const stamp = Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY
      if (primary === null || stamp > newest || (stamp === newest && id < primary)) {
        newest = stamp
        primary = id
      }
    }
    return primary
  }

  /** Today lives in memory until the next minute flush; read it from the tracker so pages are immediate. */
  function liveUsage(at) {
    try {
      const snapshot = tracker.snapshot(at)
      return { dayKey: snapshot.dayKey, activeTodayMs: snapshot.activeTodayMs, apps: snapshot.apps }
    } catch {
      return { dayKey: '', activeTodayMs: 0, apps: new Map() }
    }
  }

  /**
   * Whether ANY agent turn is still running (roots, subagents and teammates alike),
   * so the UI never announces "all done" while a child task is in flight.
   * Prefers the durable turn log per live agent, falls back to the event status map,
   * and keeps the legacy root-only scan when the agents service has no list().
   */
  function computeActivity() {
    let listed = null
    try {
      if (typeof agents.list === 'function') {
        const value = agents.list()
        if (Array.isArray(value)) listed = value
      }
    } catch {
      listed = null
    }
    if (listed === null) {
      // Agents service unavailable: keep the existing root scan so nothing breaks.
      try {
        const roots = agents.roots()
        const ids = Array.isArray(roots)
          ? roots
            .filter((agent) => typeof agent?.id === 'string' && statusMap.isRunning(agent.id))
            .map((agent) => agent.id)
            .sort()
          : []
        return { running: ids.length > 0, count: ids.length, ids }
      } catch {
        return { running: false, count: 0, ids: [] }
      }
    }
    let store = null
    if (typeof getSessions === 'function' && typeof agents.turnBoundaryOf === 'function') {
      try {
        const candidate = getSessions()
        if (candidate !== null && candidate !== undefined && typeof candidate.get === 'function') store = candidate
      } catch {
        store = null
      }
    }
    const ids = []
    for (const agent of listed) {
      const id = agent?.id
      if (typeof id !== 'string') continue
      let open = statusMap.isRunning(id)
      if (store !== null) {
        let live
        try {
          live = store.get(id)
        } catch {
          live = undefined
        }
        if (live !== undefined && live !== null) {
          try {
            const boundary = agents.turnBoundaryOf(live)
            if (boundary !== null && boundary !== undefined) open = boundary.openTurnStartSeq !== null
          } catch {
            // Keep the status-map fallback for this agent.
          }
        }
      }
      if (open) ids.push(id)
    }
    ids.sort()
    return { running: ids.length > 0, count: ids.length, ids }
  }

  function buildState() {
    const at = now()
    // Finish an elapsed rest and re-check the caps before publishing state.
    limits.evaluate(at)
    const current = settings.get()
    const usage = tracker.snapshot(at)
    const sessions = listRootSessions()
    reconcileRunning(sessions)
    const running = sessions.filter((session) => session.running).map((session) => session.id)
    const appRows = appsToRows(usage.apps)
    const idleMs = typeof sampler.lastIdleMs === 'function' ? sampler.lastIdleMs() : null
    const away = idleMs !== null
      && Number.isFinite(idleMs)
      && idleMs >= Math.max(0, Math.round(current.alerts.awayIdleSeconds)) * 1000
    return {
      now: at,
      usage: {
        activeTodayMs: usage.activeTodayMs,
        continuousMs: usage.continuousMs,
        sampling: sampler.state(),
        appsSampling: appsSampling(current),
        dayKey: usage.dayKey,
        idleMs: Number.isFinite(idleMs) ? idleMs : null,
        away,
        // Same convention as limits: true until the first sampler sample arrives.
        foregroundDsh: limits.isForegroundDsh(),
      },
      appsToday: {
        totalMs: Math.round(appsTotal(usage.apps)),
        top: appRows.slice(0, TOP_APPS_LIMIT),
      },
      limit: limits.getView(at),
      settings: settings.getPublic(),
      sessions,
      solo: { active: running.length > 0, sessions: running, primary: primaryRootSession(running) },
      activity: computeActivity(),
      events: ring.list(),
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

  async function handleCommand(request, response, run) {
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
    const result = run()
    if (!result.ok) {
      sendJson(response, CONFLICT_STATUS[result.code] ?? 409, {
        ok: false,
        error: { code: result.code, message: errorMessage(result.code) },
      })
      return
    }
    limits.evaluate(now())
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

  async function handleAssistant(request, response) {
    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      sendJson(response, ERROR_STATUS[error.code] ?? 400, errorPayload(error))
      return
    }
    if (!isPlainObject(body) || typeof body.enabled !== 'boolean') {
      sendJson(response, 400, { ok: false, error: { code: 'invalid-assistant', message: errorMessage('invalid-assistant') } })
      return
    }
    await settings.update({ assistant: { enabled: body.enabled } })
    onChange(settings.get())
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
      path: ROUTES.apps,
      handler: async (request, response, url) => sendJson(response, 200, await buildApps(url.searchParams.get('days'))),
    },
    {
      method: 'GET',
      path: ROUTES.settings,
      handler: (request, response) => sendJson(response, 200, { ok: true, settings: settings.getPublic() }),
    },
    { method: 'POST', path: ROUTES.settings, handler: handleSettingsWrite },
    { method: 'POST', path: ROUTES.assistant, handler: handleAssistant },
    {
      method: 'POST',
      path: ROUTES.pause,
      handler: (request, response) => handleCommand(request, response, () => limits.pause()),
    },
    {
      method: 'POST',
      path: ROUTES.resume,
      handler: (request, response) => handleCommand(request, response, () => limits.resume()),
    },
    {
      method: 'POST',
      path: ROUTES.restStart,
      handler: (request, response) => handleCommand(request, response, () => limits.startRest()),
    },
    {
      method: 'POST',
      path: ROUTES.restFinish,
      handler: (request, response) => handleCommand(request, response, () => limits.finishRest()),
    },
    {
      method: 'POST',
      path: ROUTES.extend,
      handler: (request, response) => handleCommand(request, response, () => limits.extend()),
    },
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

  return { handle }
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
