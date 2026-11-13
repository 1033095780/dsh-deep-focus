import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../src/index.js'
import { API_BASE, ROUTES } from '../src/shared/contract.js'

function makeServices() {
  const state = { closed: false, descendants: [], agents: new Set(['root-1']) }
  const agents = {
    roots: () => [...state.agents].map((id) => ({ id })),
    get: (id) => (state.agents.has(id) ? { id } : undefined),
    turnBoundaryOf: () => ({ openTurnStartSeq: state.closed ? null : 3 }),
  }
  const sessions = {
    get: (id) => (state.agents.has(id) ? { id, header: {} } : undefined),
  }
  const subagents = { listDescendants: async () => state.descendants }
  return { state, agents, sessions, subagents }
}

function makeCtx(services) {
  const handlers = new Map()
  const routes = []
  const disposers = []
  const ctx = {
    agents: services.agents,
    logger: { warn() {} },
    get(name) {
      if (name === 'sessions') return services.sessions
      if (name === 'subagents') return services.subagents
      if (name === 'sessionTitle') return null
      return null
    },
    on(event, handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => {
        const current = handlers.get(event) ?? []
        handlers.set(event, current.filter((entry) => entry !== handler))
      }
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
    effect(fn) {
      disposers.push(fn())
    },
  }
  return {
    ctx,
    handlers,
    routes,
    async dispose() {
      for (const disposer of disposers.splice(0)) {
        try {
          await disposer?.()
        } catch {
          // Ignore cleanup noise in tests.
        }
      }
    },
  }
}

function makeRequest({ method = 'GET', path = ROUTES.state, headers = {}, body = null } = {}) {
  const chunks = body === null ? [] : [Buffer.from(body)]
  return {
    method,
    url: `${API_BASE}${path}`,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function callRoute(route, options) {
  return new Promise((resolve, reject) => {
    const request = makeRequest(options)
    const response = {
      headersSent: false,
      writableEnded: false,
      writeHead(status, headers) {
        this.status = status
        this.headers = headers
      },
      end(body) {
        this.writableEnded = true
        try {
          resolve({ status: this.status, json: JSON.parse(body) })
        } catch (error) {
          reject(error)
        }
      },
    }
    try {
      route.handler(request, response)
    } catch (error) {
      reject(error)
    }
    const timer = setTimeout(() => reject(new Error('response timeout')), 3000)
    timer.unref?.()
  })
}

async function waitFor(condition, { timeout = 5000, interval = 25 } = {}) {
  const started = Date.now()
  for (;;) {
    if (await condition()) return true
    if (Date.now() - started > timeout) return false
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

async function makeApp() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-focus-index-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const services = makeServices()
  const stub = makeCtx(services)
  apply(stub.ctx)
  const route = await waitFor(() => stub.routes.length > 0).then(() => stub.routes[0])
  assert.ok(route, 'HTTP route should be registered')
  // Let the async boot finish loading settings before tests mutate them.
  await waitFor(async () => {
    try {
      await fs.access(join(dir, 'plugin-data', 'dsh-deep-focus', 'settings.json'))
      return true
    } catch {
      return false
    }
  })
  return {
    dir,
    services,
    stub,
    route,
    async cleanup() {
      await stub.dispose()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}

function emit(app, event, ...args) {
  const list = app.stub.handlers.get(event) ?? []
  for (const handler of list) handler(...args)
}

test('apply registers the prefix route and serves an inactive state', async () => {
  const app = await makeApp()
  try {
    const result = await callRoute(app.route)
    assert.equal(result.status, 200)
    assert.equal(result.json.version, 5)
    assert.equal(result.json.lock.active, false)
    assert.equal(app.route.path, API_BASE)
    assert.equal(app.route.kind, 'prefix')
  } finally {
    await app.cleanup()
  }
})

test('a user message in a root conversation takes the lock', async () => {
  const app = await makeApp()
  try {
    emit(app, 'api-session/activity', 'root-1', Date.now())
    const result = await callRoute(app.route)
    assert.equal(result.json.lock.active, true)
    assert.equal(result.json.lock.sessionId, 'root-1')
  } finally {
    await app.cleanup()
  }
})

test('activity in a non-root session never takes the lock', async () => {
  const app = await makeApp()
  try {
    emit(app, 'api-session/activity', 'subagent-1', Date.now())
    const result = await callRoute(app.route)
    assert.equal(result.json.lock.active, false)
  } finally {
    await app.cleanup()
  }
})

test('skip clears the lock through the HTTP route', async () => {
  const app = await makeApp()
  try {
    emit(app, 'api-session/activity', 'root-1', Date.now())
    assert.equal((await callRoute(app.route)).json.lock.active, true)
    const skipped = await callRoute(app.route, { method: 'POST', path: ROUTES.skip, body: '{}' })
    assert.equal(skipped.status, 200)
    assert.equal(skipped.json.state.lock.active, false)
    const again = await callRoute(app.route, { method: 'POST', path: ROUTES.skip, body: '{}' })
    assert.equal(again.status, 409)
  } finally {
    await app.cleanup()
  }
})

test('the lock auto-releases after the turn closes', async () => {
  const app = await makeApp()
  try {
    emit(app, 'api-session/activity', 'root-1', Date.now())
    assert.equal((await callRoute(app.route)).json.lock.active, true)
    app.services.state.closed = true
    emit(app, 'session/event', { id: 'root-1' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    const released = await waitFor(async () => (await callRoute(app.route)).json.lock.active === false, { timeout: 5000 })
    assert.equal(released, true, 'lock should release once the root turn is closed')
  } finally {
    await app.cleanup()
  }
})

test('a vanished session releases the lock without notifying', async () => {
  const app = await makeApp()
  try {
    emit(app, 'api-session/activity', 'root-1', Date.now())
    emit(app, 'api-session/removed', 'root-1')
    assert.equal((await callRoute(app.route)).json.lock.active, false)
  } finally {
    await app.cleanup()
  }
})

test('settings can be written through the API and the token stays hidden', async () => {
  const app = await makeApp()
  try {
    const body = JSON.stringify({ settings: { notifications: { dingtalkEnabled: true, dingtalkToken: 'token-abc-123' } } })
    const result = await callRoute(app.route, { method: 'POST', path: ROUTES.settings, body })
    assert.equal(result.status, 200)
    assert.equal(result.json.settings.notifications.dingtalkEnabled, true)
    assert.equal(result.json.settings.notifications.dingtalkTokenSet, true)
    assert.equal(JSON.stringify(result.json).includes('token-abc-123'), false)
  } finally {
    await app.cleanup()
  }
})

test('a restored lock.json is exposed at startup', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-focus-index-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    await fs.mkdir(join(dir, 'plugin-data', 'dsh-deep-focus'), { recursive: true })
    await fs.writeFile(
      join(dir, 'plugin-data', 'dsh-deep-focus', 'lock.json'),
      JSON.stringify({ version: 1, lock: { sessionId: 'root-1', title: '恢复的会话', startedAt: Date.now() } }),
      'utf8',
    )
    const services = makeServices()
    const stub = makeCtx(services)
    apply(stub.ctx)
    const route = await waitFor(() => stub.routes.length > 0).then(() => stub.routes[0])
    const active = await waitFor(async () => (await callRoute(route)).json.lock.active === true)
    assert.equal(active, true)
    const state = (await callRoute(route)).json
    assert.equal(state.lock.sessionId, 'root-1')
    assert.equal(state.lock.title, '恢复的会话')
    await stub.dispose()
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('legacy usage files are deleted at startup while active files survive', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-focus-index-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const dataDir = join(dir, 'plugin-data', 'dsh-deep-focus')
    await fs.mkdir(join(dataDir, 'usage'), { recursive: true })
    await fs.writeFile(join(dataDir, 'usage', '2026-11-05.jsonl'), '{}\n', 'utf8')
    await fs.writeFile(join(dataDir, '2026-11-06.jsonl'), '{}\n', 'utf8')
    await fs.writeFile(join(dataDir, 'limits.json'), '{}', 'utf8')
    const services = makeServices()
    const stub = makeCtx(services)
    apply(stub.ctx)
    const gone = await waitFor(async () => {
      try {
        await fs.access(join(dataDir, 'limits.json'))
        return false
      } catch {
        return true
      }
    })
    assert.equal(gone, true)
    const root = (await fs.readdir(dataDir)).filter((name) => name !== 'usage').sort()
    assert.deepEqual(root, ['settings.json'])
    await stub.dispose()
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('unload removes listeners so later events are ignored', async () => {
  const app = await makeApp()
  try {
    await app.stub.dispose()
    assert.equal(app.stub.handlers.get('api-session/activity')?.length ?? 0, 0)
    emit(app, 'api-session/activity', 'root-1', Date.now())
    assert.equal(app.services.state.closed, false)
  } finally {
    await app.cleanup()
  }
})
