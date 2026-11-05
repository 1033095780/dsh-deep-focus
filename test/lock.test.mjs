import assert from 'node:assert/strict'
import test from 'node:test'
import { createStatusMap } from '../src/host/events.js'
import { createGuardView, decideToolDenial, denialReason } from '../src/host/lock.js'
import { normalizeSettings } from '../src/host/settings.js'

function view(overrides = {}) {
  return {
    budgetLocked: false,
    budgetReason: null,
    singleConversation: true,
    blockToolsOutsideFocus: true,
    focusActive: false,
    focusSessionId: null,
    runningIds: [],
    exemptSubagents: true,
    isOwnedBy: () => false,
    teamRootOf: () => undefined,
    ...overrides,
  }
}

const exec = (agentId) => ({ name: 'bash', agent: agentId === undefined ? undefined : { id: agentId } })

test('the budget lock denies every tool call, attributed or not', () => {
  const locked = view({ budgetLocked: true, budgetReason: 'daily' })
  assert.equal(decideToolDenial(exec('session-a'), locked).code, 'budget-lock')
  assert.equal(decideToolDenial(exec(undefined), locked).code, 'budget-lock')
  assert.match(decideToolDenial(exec('session-a'), locked).reason, /^\[dsh-deep-focus:budget-lock\]/)
})

test('with nothing running and no focus session, nothing is denied', () => {
  assert.equal(decideToolDenial(exec('session-a'), view()), null)
  assert.equal(decideToolDenial(exec(undefined), view()), null)
})

test('while any agent runs, only running sessions may call tools', () => {
  const running = view({ runningIds: ['session-a', 'session-b'] })
  assert.equal(decideToolDenial(exec('session-a'), running), null)
  assert.equal(decideToolDenial(exec('session-b'), running), null)
  assert.equal(decideToolDenial(exec('session-c'), running).code, 'conversation-lock')
  assert.equal(decideToolDenial(exec(undefined), running), null)
})

test('a bound focus session wins over the running set', () => {
  const focus = view({ focusActive: true, focusSessionId: 'session-a', runningIds: ['session-a'] })
  assert.equal(decideToolDenial(exec('session-a'), focus), null)
  assert.equal(decideToolDenial(exec('session-b'), focus).code, 'conversation-lock')
  assert.match(decideToolDenial(exec('session-b'), focus).reason, /session-a/)
})

test('a paused focus session still holds the lock', () => {
  const paused = view({ focusActive: true, focusSessionId: 'session-a', runningIds: [] })
  assert.equal(decideToolDenial(exec('session-b'), paused).code, 'conversation-lock')
})

test('a focus session without a bound id falls back to the running set', () => {
  const fallback = view({ focusActive: true, focusSessionId: null, runningIds: ['session-a'] })
  assert.equal(decideToolDenial(exec('session-a'), fallback), null)
  assert.equal(decideToolDenial(exec('session-b'), fallback).code, 'conversation-lock')
})

test('the lock can be disabled by settings', () => {
  assert.equal(decideToolDenial(exec('session-b'), view({ singleConversation: false, runningIds: ['session-a'] })), null)
  assert.equal(decideToolDenial(exec('session-b'), view({ blockToolsOutsideFocus: false, runningIds: ['session-a'] })), null)
})

test('owned subagents are exempt only when configured', () => {
  const isOwnedBy = (childId, ownerId) => childId === 'child' && ownerId === 'session-a'
  const exempt = view({ focusActive: true, focusSessionId: 'session-a', isOwnedBy })
  assert.equal(decideToolDenial(exec('child'), exempt), null)
  const strict = view({ focusActive: true, focusSessionId: 'session-a', isOwnedBy, exemptSubagents: false })
  assert.equal(decideToolDenial(exec('child'), strict).code, 'conversation-lock')
})

test('team members are exempt regardless of which session is the team root', () => {
  const isTeamMember = () => true
  const exempt = view({ focusActive: true, focusSessionId: 'session-a', isTeamMember })
  assert.equal(decideToolDenial(exec('teammate'), exempt), null)
  const strict = view({ focusActive: true, focusSessionId: 'session-a', isTeamMember, exemptSubagents: false })
  assert.equal(decideToolDenial(exec('teammate'), strict).code, 'conversation-lock')
})

test('non-root agents are never denied by the conversation lock', () => {
  const rootView = view({
    focusActive: true,
    focusSessionId: 'session-a',
    isRootAgent: (id) => id === 'session-a' || id === 'session-b',
  })
  assert.equal(decideToolDenial(exec('subagent-1'), rootView), null)
  assert.equal(decideToolDenial(exec('session-b'), rootView).code, 'conversation-lock')
  assert.equal(decideToolDenial(exec('session-a'), rootView), null)
})

test('a stale focus binding disables the conversation lock', () => {
  const stale = view({ focusActive: true, focusSessionId: 'ghost-session', focusBindingStale: true })
  assert.equal(decideToolDenial(exec('session-b'), stale), null)
  assert.equal(decideToolDenial(exec('session-c'), stale), null)
})

test('the budget lock still applies to non-root and stale states', () => {
  const locked = view({
    budgetLocked: true,
    focusSessionId: 'ghost-session',
    focusBindingStale: true,
    isRootAgent: () => false,
  })
  assert.equal(decideToolDenial(exec('subagent-1'), locked).code, 'budget-lock')
})

test('a throwing ownership check does not crash the guard', () => {
  const throwing = view({
    focusActive: true,
    focusSessionId: 'session-a',
    isOwnedBy: () => { throw new Error('stale agent') },
    teamRootOf: () => { throw new Error('stale agent') },
  })
  assert.equal(decideToolDenial(exec('session-b'), throwing).code, 'conversation-lock')
})

test('denial reasons carry a stable code prefix', () => {
  const reason = denialReason('budget-lock', { sessionId: 'abcdefghijk' })
  assert.match(reason, /^\[dsh-deep-focus:budget-lock\]/)
  assert.match(reason, /abcdefgh/)
  assert.match(denialReason('conversation-lock'), /^\[dsh-deep-focus:conversation-lock\]/)
})

function makeGuardHarness({
  focusView = { phase: 'work', status: 'running', sessionId: 'root-1' },
  rootIds = ['root-1', 'root-2'],
  liveIds = null,
  teamService = null,
  settingsPatch = {},
  rootsThrows = false,
} = {}) {
  const statusMap = createStatusMap()
  const settingsValue = normalizeSettings(settingsPatch)
  const settings = { get: () => settingsValue }
  const live = new Set(liveIds ?? ['root-1', 'root-2', 'member-1'])
  const agents = {
    get: (id) => (live.has(id) ? { id } : undefined),
    roots: () => {
      if (rootsThrows) throw new Error('agents service unavailable')
      return rootIds.map((id) => ({ id }))
    },
    isOwnedBy: () => false,
  }
  const focus = { getView: () => focusView }
  const budget = { getView: () => ({ locked: false, reason: null }) }
  let availableTeamService = teamService
  const view = createGuardView({
    settings,
    statusMap,
    focus,
    budget,
    agents,
    getAgentTeams: () => availableTeamService,
    now: () => 0,
  })
  return {
    view,
    statusMap,
    setTeamService(service) { availableTeamService = service },
  }
}

test('guard view exempts a live non-root agent through agents.roots()', () => {
  const harness = makeGuardHarness()
  const current = harness.view()
  assert.equal(current.isRootAgent('child-9'), false)
  assert.equal(decideToolDenial({ name: 'bash', agent: { id: 'child-9' } }, current), null)
  assert.equal(decideToolDenial({ name: 'bash', agent: { id: 'root-2' } }, current).code, 'conversation-lock')
})

test('guard view resolves the Agent Teams service lazily', () => {
  const harness = makeGuardHarness({ rootIds: ['root-1', 'member-1'] })
  const before = harness.view()
  assert.equal(before.isTeamMember('member-1'), false)
  assert.equal(decideToolDenial({ name: 'bash', agent: { id: 'member-1' } }, before).code, 'conversation-lock')

  harness.setTeamService({
    tryMembership: (agent) => (agent.id === 'member-1' ? { role: 'teammate', root: { id: 'root-1' } } : undefined),
  })
  const after = harness.view()
  assert.equal(after.isTeamMember('member-1'), true)
  assert.equal(after.isTeamMember('root-2'), false)
  assert.equal(decideToolDenial({ name: 'bash', agent: { id: 'member-1' } }, after), null)
})

test('the team exemption respects exemptSubagents', () => {
  const harness = makeGuardHarness({
    rootIds: ['root-1', 'member-1'],
    settingsPatch: { lock: { exemptSubagents: false } },
    teamService: { tryMembership: () => ({ role: 'teammate', root: { id: 'root-1' } }) },
  })
  const current = harness.view()
  assert.equal(current.isTeamMember('member-1'), true)
  assert.equal(decideToolDenial({ name: 'bash', agent: { id: 'member-1' } }, current).code, 'conversation-lock')
})

test('guard view flags a focus binding whose session has no live agent', () => {
  const harness = makeGuardHarness({
    focusView: { phase: 'work', status: 'running', sessionId: 'ghost-session' },
    liveIds: ['root-1', 'root-2'],
  })
  const current = harness.view()
  assert.equal(current.focusBindingStale, true)
  assert.equal(decideToolDenial({ name: 'bash', agent: { id: 'root-2' } }, current), null)
})

test('a roots() failure does not widen the exemption', () => {
  const harness = makeGuardHarness({ rootsThrows: true })
  const current = harness.view()
  assert.equal(current.isRootAgent('child-9'), true)
  assert.equal(decideToolDenial({ name: 'bash', agent: { id: 'root-2' } }, current).code, 'conversation-lock')
})
