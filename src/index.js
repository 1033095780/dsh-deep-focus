/**
 * dsh-deep-focus Host entry (v1 product): conversation task lock plus optional
 * DingTalk completion notification. Fully event-driven — no sampler process, no
 * usage/timer/limit state machine.
 */
import { API_BASE } from './shared/contract.js'
import { createStorage, pluginDataDir } from './host/storage.js'
import { createSettingsStore } from './host/settings.js'
import { createLockController, createLockStore } from './host/lock.js'
import { createNotifier } from './host/dingtalk.js'
import { createApi, registerApi } from './host/api.js'

export const name = 'dsh-deep-focus'
export const inject = ['agents', 'webServer']

export function apply(ctx) {
  let runtime
  try {
    runtime = createRuntime(ctx)
  } catch (error) {
    warn(ctx, 'failed to initialise; the plugin stays inactive', error)
    return
  }
  ctx.effect(() => runtime.start(), 'dsh-deep-focus: host runtime')
}

function warn(ctx, message, error) {
  try {
    const suffix = error === undefined ? '' : `: ${error instanceof Error ? error.message : String(error)}`
    ctx.logger?.warn?.(`[dsh-deep-focus] ${message}${suffix}`)
  } catch {
    // Logging must never break activation or cleanup.
  }
}

function createRuntime(ctx) {
  const now = () => Date.now()
  const storage = createStorage({ dir: pluginDataDir() })
  const settings = createSettingsStore({ storage })
  const titleCache = new Map()
  let controllerRef = null
  const lockStore = createLockStore({
    storage,
    now,
    onChange: () => {
      try {
        controllerRef?.onLockChanged()
      } catch (error) {
        warn(ctx, 'lock change could not be applied', error)
      }
    },
  })

  function optionalService(name) {
    try {
      return typeof ctx.get === 'function' ? ctx.get(name) ?? null : null
    } catch {
      return null
    }
  }

  function sessionOf(sessionId) {
    const sessions = optionalService('sessions')
    if (sessions === null || typeof sessions.get !== 'function') return undefined
    try {
      return sessions.get(sessionId)
    } catch {
      return undefined
    }
  }

  /**
   * Only a top-level conversation may take the lock. Root agents carry no owning
   * agent context; when the registry cannot answer, fall back to the session's
   * header (no parentSession and not a subagent origin).
   */
  function isRootSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return false
    try {
      const roots = ctx.agents?.roots?.()
      if (Array.isArray(roots) && roots.length > 0) return roots.some((agent) => agent?.id === sessionId)
    } catch {
      // Fall through to the session header.
    }
    const session = sessionOf(sessionId)
    if (session === undefined || session === null) return false
    const header = session.header ?? {}
    return header.parentSession === undefined && header.origin !== 'subagent'
  }

  function cacheTitle(sessionId, title) {
    if (typeof title !== 'string') return
    const trimmed = title.trim().slice(0, 120)
    if (trimmed.length > 0) titleCache.set(sessionId, trimmed)
  }

  /** Title for the overlay notification: cached, then sessionTitle, then cwd basename. */
  function titleFor(sessionId) {
    const cached = titleCache.get(sessionId)
    if (typeof cached === 'string' && cached.length > 0) return cached
    const session = sessionOf(sessionId)
    if (session === undefined || session === null) return ''
    const titles = optionalService('sessionTitle')
    if (titles !== null && typeof titles.get === 'function') {
      try {
        const snapshot = titles.get(session)
        if (snapshot !== null && snapshot !== undefined && typeof snapshot.title === 'string') {
          const title = snapshot.title.trim().slice(0, 120)
          if (title.length > 0) {
            cacheTitle(sessionId, title)
            return title
          }
        }
      } catch {
        // Fall through to the directory fallback.
      }
    }
    const cwd = session.header?.cwd
    if (typeof cwd === 'string' && cwd.length > 0) {
      const base = cwd.split(/[\\/]/).filter((part) => part.length > 0).at(-1)
      if (typeof base === 'string' && base.length > 0) {
        const title = base.slice(0, 80)
        cacheTitle(sessionId, title)
        return title
      }
    }
    return ''
  }

  const notifier = createNotifier({ settings, now })

  const controller = createLockController({
    lockStore,
    agents: ctx.agents,
    getSessions: () => optionalService('sessions'),
    getSubagents: () => optionalService('subagents'),
    getTitle: titleFor,
    notify: async (lock) => {
      if (!notifier.enabled()) return
      await notifier.sendCompletion(lock)
    },
    now,
    warn: (message, error) => warn(ctx, message, error),
  })
  controllerRef = controller

  const api = createApi({ settings, controller, notifier, now })

  /** A user-authored durable message: lock (or move/refresh) the conversation. */
  function onUserActivity(sessionId) {
    if (!isRootSession(sessionId)) return
    try {
      lockStore.set(sessionId, titleFor(sessionId), now())
    } catch (error) {
      warn(ctx, 'lock could not be set', error)
    }
  }

  function onSessionAdded(summary) {
    const sessionId = summary?.sessionId
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    if (summary?.running === true || summary?.agentAvailable === true) {
      const title = titleFor(sessionId)
      if (title.length > 0) cacheTitle(sessionId, title)
    }
  }

  return {
    start() {
      let stopped = false
      const disposers = []

      const listen = (event, handler) => {
        try {
          const dispose = ctx.on(event, handler)
          if (typeof dispose === 'function') disposers.push(dispose)
        } catch (error) {
          warn(ctx, `event listener "${event}" could not be installed`, error)
        }
      }

      listen('api-session/activity', (sessionId) => {
        onUserActivity(sessionId)
      })
      listen('api-session/added', (summary) => {
        onSessionAdded(summary)
      })
      listen('api-session/removed', (sessionId) => {
        if (typeof sessionId === 'string') {
          titleCache.delete(sessionId)
          controller.handleGone(sessionId)
        }
      })
      listen('session/disposed', (session) => {
        const sessionId = session?.id
        if (typeof sessionId === 'string') {
          titleCache.delete(sessionId)
          controller.handleGone(sessionId)
        }
      })
      // Early completion checks: a burst of turn/subagent transitions coalesces
      // into one debounced reconcile. The 1.5s timer remains the safety net.
      listen('session/event', (session, event) => {
        if (event?.type === 'turn/start' || event?.type === 'turn/end') controller.poke()
      })
      listen('agent/status', () => controller.poke())
      listen('agent/disposed', () => controller.poke())
      listen('subagent/start', () => controller.poke())
      listen('subagent/end', () => controller.poke())

      try {
        disposers.push(registerApi({ ctx, api, base: API_BASE }))
      } catch (error) {
        warn(ctx, 'HTTP API could not be registered', error)
      }

      const boot = (async () => {
        try {
          await settings.load()
          await lockStore.load()
          await storage.cleanupLegacyData().catch(() => {})
          if (stopped) return
          controller.onLockChanged()
          // A restored lock reconciles immediately, then follows the cadence.
          if (lockStore.get() !== null) void controller.reconcile()
        } catch (error) {
          warn(ctx, 'initialisation failed; running with defaults', error)
        }
      })()

      return async () => {
        if (stopped) return
        stopped = true
        controller.dispose()
        for (const dispose of disposers.splice(0).reverse()) {
          try {
            dispose()
          } catch (error) {
            warn(ctx, 'cleanup step failed', error)
          }
        }
        try {
          await lockStore.flush()
          await storage.flush()
        } catch {
          // Losing a final flush is better than failing unload.
        }
        await boot.catch(() => {})
      }
    },
  }
}
