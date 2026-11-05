/** Host event feed: the state ring buffer the browser polls, the live agent status map, and completion alerts. */
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
 * Returns one disposer; the caller owns it inside its own effect.
 */
export function installHostEventListeners({ ctx, ring, focus, settings, statusMap }) {
  const disposers = []

  disposers.push(ctx.on('agent/status', (payload) => {
    const agent = payload?.agent
    if (agent?.id === undefined) return
    statusMap.set(agent.id, payload.status === 'running')
  }))

  disposers.push(ctx.on('agent/disposed', (payload) => {
    const agent = payload?.agent
    if (agent?.id === undefined) return
    statusMap.delete(agent.id)
    // A disposed owner must not leave a ghost lock behind: drop the bound focus
    // block so a persisted focus.json cannot restore into a foreign session.
    try {
      if (focus.isBoundTo(agent.id) && focus.isActive()) focus.stop('owner-disposed')
    } catch {
      // Recorded focus state is best-effort while the agent is being torn down.
    }
  }))

  // Durable turn completion: `alerts.turnDone` is the opt-in "agent round finished" notice.
  disposers.push(ctx.on('session/event', (session, event) => {
    if (event?.type !== 'turn/end') return
    if (event.data?.reason?.kind !== 'completed') return
    if (!settings.get().alerts.turnDone) return
    ring.emit(EVENT.taskCompleted, {
      source: 'turn',
      sessionId: session?.id ?? null,
      turn: event.data.turn,
    })
  }))

  // Goal completion: a bound focus session completes; otherwise it is a task-done notice.
  disposers.push(ctx.on('goal/changed', (payload) => {
    const change = payload?.change
    if (change?.operation !== 'complete') return
    const sessionId = payload?.agent?.id
    const task = typeof change.goal?.objective === 'string' ? change.goal.objective.slice(0, 200) : null
    if (focus.isBoundTo(sessionId)) {
      focus.complete('goal')
      return
    }
    if (!settings.get().alerts.taskDone) return
    ring.emit(EVENT.taskCompleted, { source: 'goal', sessionId: sessionId ?? null, task })
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
