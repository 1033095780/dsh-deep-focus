/**
 * Conversation lock: persisted `lock.json` state, a view for `/state`, and the
 * reconciler that releases the lock only after the root turn closed and every
 * subagent/child descendant is idle (then notifies once).
 */
import { LOCK_RECONCILE_MS, LOCK_SETTLE_MS } from '../shared/contract.js'

export const LOCK_FILE = 'lock.json'
const LOCK_VERSION = 1
const RECONCILE_DEBOUNCE_MS = 250
const TITLE_LIMIT = 120

function normalizeTitle(title) {
  return typeof title === 'string' ? title.trim().slice(0, TITLE_LIMIT) : ''
}

function inactiveView() {
  return { active: false, sessionId: null, title: '', startedAt: 0, elapsedMs: 0 }
}

/**
 * Durable lock state. `set` always wins (a message in another conversation moves
 * the lock; the same conversation refreshes `startedAt`).
 */
export function createLockStore({ storage = null, now = Date.now, onChange = null } = {}) {
  let lock = null
  let writeChain = Promise.resolve()

  function persist() {
    if (storage === null || typeof storage.writeJson !== 'function') return
    const document = lock === null
      ? { version: LOCK_VERSION, lock: null }
      : { version: LOCK_VERSION, lock: { ...lock } }
    writeChain = writeChain.then(() => storage.writeJson(LOCK_FILE, document)).catch(() => {})
  }

  function notifyChange() {
    if (typeof onChange !== 'function') return
    try {
      onChange(lock)
    } catch {
      // A listener failure must not break the state transition.
    }
  }

  return {
    async load() {
      const raw = await (storage?.readJson?.(LOCK_FILE, null) ?? Promise.resolve(null))
      const value = raw !== null && raw !== undefined && typeof raw === 'object' ? raw.lock : null
      lock = value !== null && value !== undefined
        && typeof value.sessionId === 'string' && value.sessionId.length > 0
        && Number.isFinite(value.startedAt)
        ? { sessionId: value.sessionId, title: normalizeTitle(value.title), startedAt: value.startedAt }
        : null
      return lock
    },

    get() {
      return lock
    },

    set(sessionId, title, at = now()) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null
      lock = {
        sessionId,
        title: normalizeTitle(title),
        startedAt: Number.isFinite(at) ? at : now(),
      }
      persist()
      notifyChange()
      return lock
    },

    clear() {
      if (lock === null) return false
      lock = null
      persist()
      notifyChange()
      return true
    },

    view(at = now()) {
      if (lock === null) return inactiveView()
      return {
        active: true,
        sessionId: lock.sessionId,
        title: lock.title,
        startedAt: lock.startedAt,
        elapsedMs: Math.max(0, at - lock.startedAt),
      }
    },

    flush() {
      return writeChain
    },
  }
}

/**
 * Release engine. `notify(lock)` runs exactly once per automatic release, after
 * the lock is cleared so the overlay disappears immediately even if DingTalk is
 * slow or down.
 */
export function createLockController({
  lockStore,
  agents,
  getSessions,
  getSubagents,
  getTitle,
  notify = null,
  now = Date.now,
  settleMs = LOCK_SETTLE_MS,
  reconcileMs = LOCK_RECONCILE_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  warn = () => {},
} = {}) {
  let timer = null
  let debounceTimer = null
  let settleAt = null
  let inflight = null
  let disposed = false

  const locked = () => lockStore?.get?.() !== null && lockStore?.get?.() !== undefined

  function stopTimer() {
    if (timer === null) return
    try {
      clearIntervalImpl(timer)
    } catch {
      // Timer may already be gone.
    }
    timer = null
  }

  function clearDebounce() {
    if (debounceTimer === null) return
    try {
      clearTimeoutImpl(debounceTimer)
    } catch {
      // Debounce timer may already be gone.
    }
    debounceTimer = null
  }

  function ensureTimer() {
    if (disposed || timer !== null || !locked()) return
    timer = setIntervalImpl(() => { void reconcile() }, reconcileMs)
    timer?.unref?.()
  }

  function sessionFor(sessionId) {
    try {
      const store = typeof getSessions === 'function' ? getSessions() : null
      return store !== null && store !== undefined && typeof store.get === 'function'
        ? store.get(sessionId)
        : undefined
    } catch {
      return undefined
    }
  }

  function agentPresent(sessionId) {
    try {
      if (agents === null || agents === undefined || typeof agents.get !== 'function') return true
      return agents.get(sessionId) !== undefined
    } catch {
      return true
    }
  }

  async function descendantsRunning(rootSessionId) {
    const service = typeof getSubagents === 'function' ? getSubagents() : null
    if (service === null || service === undefined || typeof service.listDescendants !== 'function') {
      // Guarded: a missing subagent service must not deadlock the lock forever.
      return false
    }
    try {
      const entries = await service.listDescendants(rootSessionId)
      return Array.isArray(entries)
        && entries.some((entry) => entry !== null && entry !== undefined && entry.kind === 'child' && entry.activity === 'running')
    } catch {
      // Unavailable/corrupt catalog: treat as no running descendants.
      return false
    }
  }

  /** True when the root turn is closed AND no descendant is still running. */
  async function isFinished(sessionId) {
    if (agentPresent(sessionId)) {
      const session = sessionFor(sessionId)
      if (session === null || session === undefined) return false
      if (agents === null || agents === undefined || typeof agents.turnBoundaryOf !== 'function') return false
      try {
        const boundary = agents.turnBoundaryOf(session)
        const closed = boundary === null || boundary === undefined || boundary.openTurnStartSeq === null
        if (!closed) return false
      } catch {
        return false
      }
    }
    return !(await descendantsRunning(sessionId))
  }

  async function finishLock(lock) {
    lockStore.clear()
    settleAt = null
    stopTimer()
    if (typeof notify === 'function') {
      let title = lock.title
      if (typeof getTitle === 'function') {
        try {
          const latest = getTitle(lock.sessionId)
          if (typeof latest === 'string' && latest.trim().length > 0) title = latest.trim()
        } catch {
          // Keep the stored title.
        }
      }
      try {
        void Promise.resolve(notify({ ...lock, title })).catch((error) => warn('notification failed', error))
      } catch (error) {
        warn('notification failed', error)
      }
    }
  }

  function reconcile() {
    if (disposed || !locked()) return Promise.resolve(false)
    if (inflight !== null) return inflight
    inflight = (async () => {
      try {
        const lock = lockStore.get()
        if (lock === null || lock === undefined) return false
        if (!(await isFinished(lock.sessionId))) {
          settleAt = null
          return false
        }
        const at = now()
        if (settleAt === null) {
          // First proof of completion: let late children register before releasing.
          settleAt = at + settleMs
          return false
        }
        if (at < settleAt) return false
        if (!(await isFinished(lock.sessionId))) {
          settleAt = null
          return false
        }
        await finishLock(lock)
        return true
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  function skip() {
    if (!locked()) return false
    lockStore.clear()
    settleAt = null
    stopTimer()
    return true
  }

  function handleGone(sessionId) {
    const lock = lockStore.get()
    if (lock === null || lock === undefined || lock.sessionId !== sessionId) return false
    // A vanished session is released silently: no completion notification.
    lockStore.clear()
    settleAt = null
    stopTimer()
    return true
  }

  /** Event-driven early reconcile; debounced so bursts coalesce into one pass. */
  function poke(delayMs = RECONCILE_DEBOUNCE_MS) {
    if (disposed || !locked()) return
    if (debounceTimer !== null) return
    debounceTimer = setTimeoutImpl(() => {
      debounceTimer = null
      void reconcile()
    }, delayMs)
    debounceTimer?.unref?.()
  }

  function onLockChanged() {
    settleAt = null
    if (locked()) {
      ensureTimer()
      return
    }
    stopTimer()
    clearDebounce()
  }

  function dispose() {
    disposed = true
    stopTimer()
    clearDebounce()
  }

  return {
    reconcile,
    skip,
    handleGone,
    poke,
    onLockChanged,
    dispose,
    isFinished,
    view: (at = now()) => (lockStore?.view?.(at) ?? inactiveView()),
  }
}
