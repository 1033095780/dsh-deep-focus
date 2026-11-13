/**
 * Same-origin JSON API: tiny `/state`, settings patch, skip-lock and a DingTalk
 * test notification. Handlers never throw to the webServer; every failure
 * becomes a small JSON error response, and the DingTalk token never leaves the
 * Host (not in state, not in errors, not in test results).
 */
import { API_BASE, CONTRACT_VERSION, ROUTES } from '../shared/contract.js'

const BODY_LIMIT_BYTES = 32 * 1024
const noop = () => {}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

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
 * Trust rule for every route, reads included. Host/Origin absence is allowed
 * (non-browser clients and the Desktop proxy strip them); a present Origin must
 * match the request authority, and `cross-site` is always refused.
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

const ERROR_STATUS = {
  'untrusted-origin': 403,
  'body-too-large': 413,
  'bad-json': 400,
  'invalid-settings': 400,
  'no-lock': 409,
  'not-configured': 409,
  'method-not-allowed': 405,
  'not-found': 404,
  internal: 500,
}

const ERROR_MESSAGES = {
  'untrusted-origin': 'This request came from an untrusted origin and was refused.',
  'body-too-large': 'The request body is too large.',
  'bad-json': 'The request body is not valid JSON.',
  'invalid-settings': 'The settings payload must be a JSON object.',
  'no-lock': 'No conversation task lock is active.',
  'not-configured': 'DingTalk notifications are not configured.',
  'method-not-allowed': 'This method is not allowed for the route.',
  'not-found': 'Unknown deep-focus API path.',
  internal: 'The host could not complete this request.',
}

function errorPayload(code) {
  return { ok: false, error: { code, message: ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal } }
}

/** Strip the registered `API_BASE` prefix and query string from a request URL. */
export function routePathOf(requestUrl, base = API_BASE) {
  try {
    const parsed = new URL(typeof requestUrl === 'string' ? requestUrl : '/', 'http://localhost')
    let path = parsed.pathname
    if (path === base) return '/'
    if (path.startsWith(`${base}/`)) path = path.slice(base.length)
    return path
  } catch {
    return ''
  }
}

/**
 * Build the API facade. `buildState()` is intentionally tiny: lock view, public
 * settings and notifier status only.
 */
export function createApi({ settings, controller, notifier, now = Date.now } = {}) {
  function buildState() {
    const at = now()
    const last = typeof notifier?.lastResult === 'function' ? notifier.lastResult() : null
    return {
      ok: true,
      version: CONTRACT_VERSION,
      now: at,
      lock: controller?.view?.(at) ?? { active: false, sessionId: null, title: '', startedAt: 0, elapsedMs: 0 },
      settings: settings?.getPublic?.() ?? {},
      notify: {
        configured: typeof notifier?.enabled === 'function' ? notifier.enabled() === true : false,
        last,
      },
    }
  }

  async function handleSettingsWrite(request, response) {
    let body
    try {
      body = await readJsonBody(request)
    } catch (error) {
      sendJson(response, ERROR_STATUS[error.code] ?? 400, errorPayload(error.code ?? 'internal'))
      return
    }
    const patch = isPlainObject(body) && body.settings !== undefined ? body.settings : body
    if (!isPlainObject(patch)) {
      sendJson(response, 400, errorPayload('invalid-settings'))
      return
    }
    try {
      if (typeof settings?.update === 'function') await settings.update(patch)
      const state = buildState()
      sendJson(response, 200, { ok: true, version: CONTRACT_VERSION, settings: state.settings, state })
    } catch {
      sendJson(response, 500, errorPayload('internal'))
    }
  }

  async function handleSkip(request, response) {
    try {
      const skipped = typeof controller?.skip === 'function' ? controller.skip() : false
      if (!skipped) {
        sendJson(response, 409, errorPayload('no-lock'))
        return
      }
      sendJson(response, 200, { ok: true, state: buildState() })
    } catch {
      sendJson(response, 500, errorPayload('internal'))
    }
  }

  async function handleTestNotify(request, response) {
    try {
      if (typeof notifier?.enabled !== 'function' || notifier.enabled() !== true) {
        sendJson(response, 409, errorPayload('not-configured'))
        return
      }
      const delivered = typeof notifier.sendTest === 'function' ? await notifier.sendTest() : { ok: false }
      sendJson(response, 200, { ok: true, delivered: delivered?.ok === true, state: buildState() })
    } catch {
      sendJson(response, 500, errorPayload('internal'))
    }
  }

  const routes = [
    { method: 'GET', path: ROUTES.state, handler: (request, response) => sendJson(response, 200, buildState()) },
    { method: 'GET', path: ROUTES.settings, handler: (request, response) => sendJson(response, 200, { ok: true, version: CONTRACT_VERSION, settings: buildState().settings }) },
    { method: 'POST', path: ROUTES.settings, handler: handleSettingsWrite },
    { method: 'POST', path: ROUTES.skip, handler: handleSkip },
    { method: 'POST', path: ROUTES.testNotify, handler: handleTestNotify },
  ]

  async function handle(request, response) {
    try {
      const headers = request?.headers ?? {}
      if (!isTrustedRequest(headers)) {
        sendJson(response, 403, errorPayload('untrusted-origin'))
        return
      }
      const method = typeof request?.method === 'string' ? request.method.toUpperCase() : 'GET'
      const path = routePathOf(request?.url)
      const matches = routes.filter((route) => route.path === path)
      if (matches.length === 0) {
        sendJson(response, 404, errorPayload('not-found'))
        return
      }
      const route = matches.find((candidate) => candidate.method === method)
      if (route === undefined) {
        sendJson(response, 405, errorPayload('method-not-allowed'))
        return
      }
      await route.handler(request, response)
    } catch {
      sendJson(response, 500, errorPayload('internal'))
    }
  }

  return { handle, buildState }
}

/** Register the Host prefix route; returns the webServer disposer. */
export function registerApi({ ctx, api, base = API_BASE }) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: base,
    handler: (request, response) => {
      void api.handle(request, response).catch(noop)
    },
  })
}
