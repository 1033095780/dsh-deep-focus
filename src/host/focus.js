/**
 * Focus state machine: pomodoro work/break phases driven by wall-clock deadlines.
 * The Host is authoritative; the browser only renders `getView()` and polled events.
 */
import { EVENT, PHASE } from '../shared/contract.js'
import { localDayKey } from './storage.js'

export const FOCUS_FILE = 'focus.json'
export const STATUS = { idle: 'idle', running: 'running', paused: 'paused' }

const MAX_TICK_GAP_MS = 5000
const MIN_RESUME_MS = 1000
const MAX_TASK_LENGTH = 200
const MAX_SESSION_LENGTH = 200

function clampInt(value, min, max) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}

function emptyState(dayKey) {
  return {
    dayKey,
    phase: PHASE.idle,
    status: STATUS.idle,
    sessionId: null,
    task: null,
    startedAt: null,
    endsAt: null,
    remainingMs: 0,
    elapsedMs: 0,
    pauseCause: null,
    pomodorosToday: 0,
    cycleCount: 0,
  }
}

function cleanText(value, max) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().slice(0, max) : null
}

const noop = () => {}

/**
 * Create the focus machine. Time comes from the injected clock and `tick()`
 * is driven by the Host; tests can pump both directly.
 */
export function createFocus({ settings, ring, storage = null, now = Date.now, onStat = noop } = {}) {
  let state = emptyState(localDayKey(now()))
  let lastTickAt = now()
  let writeChain = Promise.resolve()
  let disposed = false

  function persist() {
    if (storage === null || disposed) return
    const document = { ...state, savedAt: now() }
    writeChain = writeChain.then(() => storage.writeJson(FOCUS_FILE, document)).catch(() => {})
  }

  function finishBreak(at) {
    ring.emit(EVENT.breakCompleted, {})
    onStat({ kind: 'break' })
    const s = settings.get()
    const { sessionId, task } = state
    if (s.focus.autoStartNext) {
      const minutes = clampInt(s.focus.workMinutes, 1, 180)
      state = {
        ...state,
        phase: PHASE.work,
        status: STATUS.running,
        startedAt: at,
        endsAt: at + minutes * 60_000,
        remainingMs: 0,
        elapsedMs: 0,
        pauseCause: null,
        sessionId,
        task,
      }
      ring.emit(EVENT.focusStarted, { minutes, task, auto: true })
    } else {
      state = { ...emptyState(localDayKey(at)), pomodorosToday: state.pomodorosToday, cycleCount: state.cycleCount }
    }
    lastTickAt = at
    persist()
  }

  function finishWork(cause, at) {
    const s = settings.get()
    const elapsedMs = state.elapsedMs
    const task = state.task
    const sessionId = state.sessionId
    onStat({ kind: 'focus', ms: Math.round(elapsedMs) })
    if (cause === 'natural') {
      ring.emit(EVENT.focusCompleted, { minutes: Math.round(elapsedMs / 60_000), task })
    } else {
      ring.emit(EVENT.taskCompleted, { source: cause, task })
    }
    const completed = state.cycleCount + 1
    const every = clampInt(s.focus.longBreakEvery, 0, 12)
    const longBreak = every > 0 && completed >= every
    state = {
      ...state,
      pomodorosToday: state.pomodorosToday + 1,
      cycleCount: longBreak ? 0 : completed,
      elapsedMs: Math.round(elapsedMs),
    }
    onStat({ kind: 'pomodoro' })
    const breakMinutes = longBreak && s.focus.longBreakMinutes > 0 ? s.focus.longBreakMinutes : s.focus.breakMinutes
    if (s.focus.autoStartBreak && breakMinutes > 0) {
      state = {
        ...state,
        phase: PHASE.break,
        status: STATUS.running,
        startedAt: at,
        endsAt: at + breakMinutes * 60_000,
        remainingMs: 0,
        elapsedMs: 0,
        pauseCause: null,
        sessionId,
        task,
      }
    } else {
      state = { ...emptyState(localDayKey(at)), pomodorosToday: state.pomodorosToday, cycleCount: state.cycleCount }
    }
    lastTickAt = at
    persist()
  }

  function pause(cause = 'user', at = now()) {
    if (state.status !== STATUS.running) return { ok: false, code: 'not-running' }
    state = {
      ...state,
      status: STATUS.paused,
      remainingMs: state.endsAt === null ? 0 : Math.max(0, state.endsAt - at),
      endsAt: null,
      pauseCause: cause,
    }
    lastTickAt = at
    persist()
    return { ok: true }
  }

  function resume(at = now()) {
    if (state.status !== STATUS.paused) return { ok: false, code: 'not-paused' }
    state = {
      ...state,
      status: STATUS.running,
      endsAt: at + Math.max(state.remainingMs, MIN_RESUME_MS),
      remainingMs: 0,
      pauseCause: null,
    }
    lastTickAt = at
    persist()
    return { ok: true }
  }

  function getView(at = now()) {
    const running = state.status === STATUS.running
    const remainingMs = running && state.endsAt !== null
      ? Math.max(0, state.endsAt - at)
      : state.status === STATUS.paused
        ? state.remainingMs
        : 0
    return {
      phase: state.phase,
      status: state.phase === PHASE.idle ? STATUS.idle : state.status,
      sessionId: state.sessionId,
      task: state.task,
      endsAt: running ? state.endsAt : null,
      remainingMs: Math.round(remainingMs),
      elapsedMs: Math.round(state.elapsedMs),
      pomodorosToday: state.pomodorosToday,
      startedAt: state.startedAt,
      pauseCause: state.pauseCause,
    }
  }

  return {
    get: () => state,
    isBoundTo: (sessionId) => typeof sessionId === 'string' && sessionId.length > 0 && state.sessionId === sessionId,
    isActive: () => state.phase !== PHASE.idle && (state.status === STATUS.running || state.status === STATUS.paused),

    async load() {
      const document = await storage?.readJson(FOCUS_FILE, null)
      const at = now()
      const dayKey = localDayKey(at)
      if (document === null || document === undefined || typeof document !== 'object') {
        lastTickAt = at
        return state
      }
      const phase = Object.values(PHASE).includes(document.phase) ? document.phase : PHASE.idle
      const status = Object.values(STATUS).includes(document.status) ? document.status : STATUS.idle
      const restored = {
        dayKey,
        phase,
        status: phase === PHASE.idle ? STATUS.idle : status,
        sessionId: typeof document.sessionId === 'string' ? document.sessionId.slice(0, MAX_SESSION_LENGTH) : null,
        task: cleanText(document.task, MAX_TASK_LENGTH),
        startedAt: Number.isFinite(document.startedAt) ? document.startedAt : null,
        endsAt: Number.isFinite(document.endsAt) ? document.endsAt : null,
        remainingMs: Number.isFinite(document.remainingMs) ? Math.max(0, document.remainingMs) : 0,
        elapsedMs: Number.isFinite(document.elapsedMs) ? Math.max(0, document.elapsedMs) : 0,
        pauseCause: document.pauseCause === 'idle' || document.pauseCause === 'user' ? document.pauseCause : null,
        pomodorosToday: Number.isFinite(document.pomodorosToday) ? Math.max(0, Math.round(document.pomodorosToday)) : 0,
        cycleCount: Number.isFinite(document.cycleCount) ? Math.max(0, Math.round(document.cycleCount)) : 0,
      }
      if (restored.dayKey !== document.dayKey) {
        restored.pomodorosToday = 0
        restored.cycleCount = 0
      }
      if (restored.status === STATUS.running && restored.endsAt === null) restored.status = STATUS.paused
      if (restored.status === STATUS.paused && restored.phase !== PHASE.idle) restored.endsAt = null
      state = restored
      lastTickAt = at
      // A running block that outlived the process is settled once by the next tick.
      return state
    },

    start({ task = null, sessionId = null, workMinutes } = {}, at = now()) {
      if (state.phase !== PHASE.idle) return { ok: false, code: 'already-running' }
      const s = settings.get()
      const minutes = clampInt(workMinutes ?? s.focus.workMinutes, 1, 180)
      state = {
        dayKey: localDayKey(at),
        phase: PHASE.work,
        status: STATUS.running,
        sessionId: cleanText(sessionId, MAX_SESSION_LENGTH),
        task: cleanText(task, MAX_TASK_LENGTH),
        startedAt: at,
        endsAt: at + minutes * 60_000,
        remainingMs: 0,
        elapsedMs: 0,
        pauseCause: null,
        pomodorosToday: state.pomodorosToday,
        cycleCount: state.cycleCount,
      }
      lastTickAt = at
      ring.emit(EVENT.focusStarted, { minutes, task: state.task })
      persist()
      return { ok: true }
    },

    pause: (at = now()) => pause('user', at),
    resume: (at = now()) => resume(at),

    stop(reason = 'user', at = now()) {
      if (state.phase === PHASE.idle) return { ok: false, code: 'not-running' }
      const elapsedMs = state.elapsedMs
      const wasWork = state.phase === PHASE.work
      if (wasWork && elapsedMs > 0) onStat({ kind: 'focus', ms: Math.round(elapsedMs) })
      state = { ...emptyState(localDayKey(at)), pomodorosToday: state.pomodorosToday, cycleCount: state.cycleCount }
      lastTickAt = at
      ring.emit(EVENT.focusStopped, { reason, elapsedMs: Math.round(elapsedMs) })
      persist()
      return { ok: true }
    },

    /** Manual "task done": ends the work block early and follows the same break transition. */
    complete(cause = 'user', at = now()) {
      if (state.phase !== PHASE.work) return { ok: false, code: 'not-running' }
      finishWork(cause === 'goal' ? 'goal' : 'user', at)
      return { ok: true }
    },

    /** Called by the Host once per second. */
    tick(at = now()) {
      const dayKey = localDayKey(at)
      if (state.dayKey !== dayKey) {
        state = { ...state, dayKey, pomodorosToday: 0, cycleCount: state.cycleCount }
        persist()
      }
      if (state.status === STATUS.running) {
        const gap = Math.min(Math.max(0, at - lastTickAt), MAX_TICK_GAP_MS)
        state = { ...state, elapsedMs: state.elapsedMs + gap }
        lastTickAt = at
        if (state.endsAt !== null && at >= state.endsAt) {
          if (state.phase === PHASE.work) finishWork('natural', at)
          else if (state.phase === PHASE.break) finishBreak(at)
        }
      } else {
        lastTickAt = at
      }
      return getView(at)
    },

    /** Consume the tracker's activity verdict for idle auto-pause / auto-resume. */
    applyActivity({ active, idleMs }, at = now()) {
      const s = settings.get()
      const thresholdMs = Math.max(0, clampInt(s.focus.idlePauseSeconds, 0, 3600)) * 1000
      if (state.phase !== PHASE.work) return
      if (state.status === STATUS.running && thresholdMs > 0 && Number.isFinite(idleMs) && idleMs >= thresholdMs) {
        pause('idle', at)
        return
      }
      if (state.status === STATUS.paused && state.pauseCause === 'idle' && active === true && s.focus.autoResumeOnReturn) {
        resume(at)
      }
    },

    getView,

    flush() {
      return writeChain
    },

    dispose() {
      disposed = true
    },
  }
}
