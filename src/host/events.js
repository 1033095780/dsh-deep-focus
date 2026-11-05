/** Host event feed v3: the state ring buffer, live root-agent status map and completion alerts. */
import { EVENT } from '../shared/contract.js'

export const EVENT_RING_SIZE = 50

/**
 * Fixed-size event ring. Sequence numbers start from the current epoch so a
 * Host restart cannot make the browser treat old events as new.
 */
export function createEventRing({ size = EVENT_RING_SIZE, now = Date.now } = {}) {
  let seq = now()
  const items = []
  return {
    emit(kind, meta = {}) {
      seq += 1
      const event = { seq, kind, at: now(), meta }
      items.push(event)
      if (items.length > size) items.shift()
      return event
    },
    list() {
      return items.map((event) => ({ ...event, meta: { ...event.meta } }))
    },
    lastSeq: () => seq,
  }
}

/** Live `agent/status` snapshot, keyed by session id. */
export function createStatusMap() {
  const running = new Map()
  return {
    set(id, isRunning) {
      if (typeof id !== 'string' || id.length === 0) return
      running.set(id, isRunning === true)
    },
    delete(id) {
      running.delete(id)
    },
    isRunning: (id) => running.get(id) === true,
    runningIds: () => [...running.entries()].filter(([, isRunning]) => isRunning).map(([id]) => id),
  }
}

/**
 * Bridge Host events into the state ring and the status map.
 * Only completion alerts remain: v3 has no focus/pomodoro blocks.
 *
 * Running-state sources, most authoritative first:
 * 1. `api-session/status` — a root-level emit, the only feed an unscoped plugin
 *    context reliably receives.
 * 2. `session/event` durable turn boundaries (`turn/start` / `turn/end`).
 * 3. `agent/status` — scoped to the agent context, so it may never reach us; it
 *    is kept as a harmless bonus source.
 * Returns one disposer; the caller owns it inside its own effect.
 */
export function installHostEventListeners({ ctx, ring, statusMap }) {
  const disposers = []

  disposers.push(ctx.on('api-session/status', (sessionId, running) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    statusMap.set(sessionId, running === true)
  }))

  // A freshly visible session (or one whose agent was just created/disposed)
  // arrives with its current running state; upsert it.
  disposers.push(ctx.on('api-session/added', (summary) => {
    if (typeof summary?.sessionId !== 'string' || summary.sessionId.length === 0) return
    statusMap.set(summary.sessionId, summary.running === true)
  }))

  // Durable turn boundaries double as a status source (and carry the completion alert).
  disposers.push(ctx.on('session/event', (session, event) => {
    const sessionId = session?.id
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      if (event?.type === 'turn/start') statusMap.set(sessionId, true)
      else if (event?.type === 'turn/end') statusMap.set(sessionId, false)
    }
    if (event?.type !== 'turn/end') return
    if (event.data?.reason?.kind !== 'completed') return
    ring.emit(EVENT.taskCompleted, {
      source: 'turn',
      sessionId: session?.id ?? null,
      turn: event.data.turn,
    })
  }))

  // Best effort: agent-scoped delivery is not guaranteed for an unscoped root context.
  disposers.push(ctx.on('agent/status', (payload) => {
    const agent = payload?.agent
    if (agent?.id === undefined) return
    statusMap.set(agent.id, payload.status === 'running')
  }))

  disposers.push(ctx.on('agent/disposed', (payload) => {
    const agent = payload?.agent
    if (agent?.id === undefined) return
    statusMap.delete(agent.id)
  }))

  disposers.push(ctx.on('goal/changed', (payload) => {
    const change = payload?.change
    if (change?.operation !== 'complete') return
    const task = typeof change.goal?.objective === 'string' ? change.goal.objective.slice(0, 200) : null
    ring.emit(EVENT.taskCompleted, {
      source: 'goal',
      sessionId: payload?.agent?.id ?? null,
      task,
    })
  }))

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // An already-disposed listener must not block the rest of the cleanup.
      }
    }
  }
}
