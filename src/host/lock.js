/**
 * Tool guard: the Host-side hard wall for "one conversation at a time" and for an
 * over-budget app. Denials carry a stable `[dsh-deep-focus:<code>]` prefix plus
 * bilingual text, so the browser can localize from the code if it wants to.
 */
const PREFIX = '[dsh-deep-focus'

const REASON_TEXT = {
  'budget-lock': {
    zh: '专注用量已超限并锁定，工具调用被拒绝。请在专注面板中解锁或休息。',
    en: 'Deep focus budget is over the limit and locked; tool calls are refused. Unlock or rest from the deep-focus panel.',
  },
  'conversation-lock': {
    zh: '专注中只能使用当前专注会话，其它会话的工具调用被拒绝。请回到专注会话继续。',
    en: 'Deep focus is bound to one conversation; tool calls from other conversations are refused. Return to the focused conversation.',
  },
}

/** Human-readable, stable-code denial string. */
export function denialReason(code, meta = {}) {
  const text = REASON_TEXT[code] ?? { zh: '已被深度专注插件拒绝。', en: 'Refused by the deep-focus plugin.' }
  const suffix = meta.sessionId ? ` (${String(meta.sessionId).slice(0, 64)})` : ''
  return `${PREFIX}:${code}] ${text.zh}${suffix} / ${text.en}`
}

/**
 * Pure denial decision for one tool execution.
 * `view` supplies the live facts so the guard itself stays synchronous and cheap.
 *
 * @returns {{ code: string, reason: string } | null} null means "allow"
 */
export function decideToolDenial(exec, view) {
  const agentId = exec?.agent?.id
  if (view.budgetLocked) {
    return { code: 'budget-lock', reason: denialReason('budget-lock', { sessionId: agentId }) }
  }
  if (!view.singleConversation || !view.blockToolsOutsideFocus) return null
  if (typeof agentId !== 'string' || agentId.length === 0) return null
  // A focus block whose bound session no longer has a live agent must not freeze
  // every other conversation; the panel's stop/rest action clears it.
  if (view.focusBindingStale === true) return null

  // A conversation lock only protects user-visible root conversations. Subagents,
  // workflow children and Agent Teams members are work performed for a root, never
  // a competing conversation, so freezing them would stall the task being focused.
  if (typeof view.isRootAgent === 'function' && view.isRootAgent(agentId) === false) return null

  const allowed = new Set()
  if (view.focusActive && typeof view.focusSessionId === 'string' && view.focusSessionId.length > 0) {
    allowed.add(view.focusSessionId)
  } else {
    for (const id of view.runningIds ?? []) allowed.add(id)
  }
  if (allowed.size === 0) return null
  if (allowed.has(agentId)) return null

  if (view.exemptSubagents) {
    let teamMember = false
    try {
      teamMember = view.isTeamMember?.(agentId) === true
    } catch {
      teamMember = false
    }
    if (teamMember) return null
    for (const ownerId of allowed) {
      try {
        if (view.isOwnedBy(agentId, ownerId) === true) return null
      } catch {
        // A stale agent id is not an exemption.
      }
    }
  }
  return {
    code: 'conversation-lock',
    reason: denialReason('conversation-lock', { sessionId: view.focusSessionId ?? [...allowed][0] }),
  }
}

/**
 * The live view the guard reads on every tool call.
 * `getAgentTeams` is a getter because the optional service can mount after this
 * plugin; a value captured at start would silently disable the Team exemption.
 */
export function createGuardView({ settings, statusMap, focus, budget, agents, getAgentTeams, now = Date.now }) {
  let cachedTeamService = null

  function teamService() {
    if (cachedTeamService !== null) return cachedTeamService
    try {
      const service = getAgentTeams?.()
      if (service !== undefined && service !== null) cachedTeamService = service
    } catch {
      // The optional service is not available yet; retry on the next evaluation.
    }
    return cachedTeamService
  }

  return function currentView() {
    const at = now()
    const lock = budget.getView(at)
    const focusView = focus.getView(at)
    const current = settings.get()
    const focusActive = focusView.phase !== 'idle' && (focusView.status === 'running' || focusView.status === 'paused')
    const focusSessionId = typeof focusView.sessionId === 'string' ? focusView.sessionId : null

    let focusBindingStale = false
    if (focusActive && focusSessionId !== null) {
      try {
        focusBindingStale = agents.get(focusSessionId) === undefined
      } catch {
        focusBindingStale = false
      }
    }

    // Root agents are the user's conversations; `null` means the lookup failed,
    // so the non-root exemption is skipped rather than widened blindly.
    let rootIds = null
    try {
      const roots = agents.roots()
      if (Array.isArray(roots)) {
        rootIds = new Set(roots.map((agent) => agent?.id).filter((id) => typeof id === 'string'))
      }
    } catch {
      rootIds = null
    }

    return {
      budgetLocked: lock.locked,
      budgetReason: lock.reason,
      singleConversation: current.lock.singleConversation === true,
      blockToolsOutsideFocus: current.lock.blockToolsOutsideFocus === true,
      focusActive,
      focusSessionId,
      focusBindingStale,
      runningIds: statusMap.runningIds(),
      exemptSubagents: current.lock.exemptSubagents === true,
      isRootAgent(sessionId) {
        if (rootIds === null) return true
        return rootIds.has(sessionId)
      },
      isTeamMember(sessionId) {
        const service = teamService()
        if (service === null) return false
        try {
          const agent = agents.get(sessionId)
          if (agent === undefined || agent === null) return false
          const membership = service.tryMembership?.(agent) ?? service.membership?.(agent)
          return membership !== undefined && membership !== null
        } catch {
          return false
        }
      },
      isOwnedBy(childId, ownerId) {
        const owner = agents.get(ownerId)
        return owner !== undefined && owner !== null && agents.isOwnedBy(childId, owner) === true
      },
    }
  }
}

/** Register the guard on the Host tools service; the returned disposer removes it. */
export function registerToolGuard({ ctx, getView }) {
  return ctx.tools.guard((exec) => {
    const denial = decideToolDenial(exec, getView())
    return denial === null ? undefined : denial.reason
  })
}
