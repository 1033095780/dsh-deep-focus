/**
 * DingTalk text sender: serialized async queue, 3s timeout per attempt, 2 retries,
 * and a hard rule that only `[+] `-prefixed messages are ever sent. The token is
 * never logged and never appears in a returned result or error.
 */
import {
  DINGTALK_PREFIX,
  DINGTALK_RETRY,
  DINGTALK_TIMEOUT_MS,
  DINGTALK_WEBHOOK,
  buildCompletionMessage,
  buildTestMessage,
} from '../shared/contract.js'

const ERROR_MESSAGES = {
  prefix: 'Only messages beginning with "[+] " may be sent.',
  'not-configured': 'DingTalk notifications are not configured.',
  delivery: 'DingTalk delivery failed.',
}

function result(code, attempts) {
  return { ok: false, code, message: ERROR_MESSAGES[code] ?? code, attempts }
}

/** One JSON body, or null when the endpoint answered non-JSON. */
async function readJsonResponse(response) {
  try {
    const text = await response.text()
    if (typeof text !== 'string' || text.trim().length === 0) return null
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Build the notifier. `fetchImpl` is injectable for tests; the default is the
 * process-wide fetch. `timeoutMs`/`retry` are injectable to keep tests fast.
 */
export function createNotifier({
  settings,
  fetchImpl = globalThis.fetch,
  timeoutMs = DINGTALK_TIMEOUT_MS,
  retry = DINGTALK_RETRY,
  now = Date.now,
} = {}) {
  const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : null
  const attemptsLimit = Math.max(1, 1 + Math.max(0, retry))
  let queue = Promise.resolve()
  let last = null

  function config() {
    const notifications = settings?.get?.()?.notifications ?? {}
    const token = typeof notifications.dingtalkToken === 'string' ? notifications.dingtalkToken.trim() : ''
    return { enabled: notifications.dingtalkEnabled === true, token }
  }

  function enabled() {
    const { enabled: on, token } = config()
    return on && token.length > 0
  }

  function remember(value) {
    last = { ...value, at: now() }
    return last
  }

  function timeoutSignal() {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      return AbortSignal.timeout(timeoutMs)
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    timer.unref?.()
    return controller.signal
  }

  async function deliver(text) {
    const { token } = config()
    const url = `${DINGTALK_WEBHOOK}${encodeURIComponent(token)}`
    let attempts = 0
    for (let index = 0; index < attemptsLimit; index += 1) {
      attempts += 1
      try {
        const response = await fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
          signal: timeoutSignal(),
        })
        const body = response === null || response === undefined ? null : await readJsonResponse(response)
        const accepted = response?.ok === true && (body === null || body?.errcode === 0 || body?.errcode === undefined)
        if (accepted) return remember({ ok: true, attempts })
      } catch {
        // Network failure, timeout or a parse error: retry within the budget.
      }
    }
    return remember(result('delivery', attempts))
  }

  /** Enqueue one message; only `[+] ` messages reach the network. */
  function send(text) {
    if (typeof text !== 'string' || !text.startsWith(DINGTALK_PREFIX)) {
      return Promise.resolve(remember(result('prefix', 0)))
    }
    if (!enabled()) return Promise.resolve(remember(result('not-configured', 0)))
    const job = queue.then(() => deliver(text))
    queue = job.then(() => {}, () => {})
    return job
  }

  return {
    enabled,
    sendTest: () => send(buildTestMessage(new Date(now()))),
    sendCompletion(lock) {
      const startedAt = Number.isFinite(lock?.startedAt) ? lock.startedAt : now()
      const minutes = Math.max(0, Math.round((now() - startedAt) / 60_000))
      return send(buildCompletionMessage({
        title: typeof lock?.title === 'string' ? lock.title : '',
        minutes,
        finishedAt: new Date(now()),
      }))
    },
    send,
    lastResult: () => (last === null ? null : { ...last }),
  }
}
