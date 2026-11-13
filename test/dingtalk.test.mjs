import assert from 'node:assert/strict'
import test from 'node:test'
import { createNotifier } from '../src/host/dingtalk.js'
import { DINGTALK_PREFIX, DINGTALK_WEBHOOK } from '../src/shared/contract.js'

function makeNotifier({
  enabled = true,
  token = 'secret-token-1234',
  fetchImpl = null,
  timeoutMs = 3000,
  retry = 2,
  now = () => 1_700_000_000_000,
} = {}) {
  const settings = { get: () => ({ notifications: { dingtalkEnabled: enabled, dingtalkToken: token } }) }
  const calls = []
  const fetcher = fetchImpl ?? (async (url, init) => {
    calls.push({ url, init })
    return { ok: true, text: async () => JSON.stringify({ errcode: 0 }) }
  })
  const notifier = createNotifier({ settings, fetchImpl: fetcher, timeoutMs, retry, now })
  return { notifier, calls, settings }
}

test('notifier is disabled without a token or when the switch is off', () => {
  assert.equal(makeNotifier({ enabled: false }).notifier.enabled(), false)
  assert.equal(makeNotifier({ token: '' }).notifier.enabled(), false)
  assert.equal(makeNotifier({ token: '   ' }).notifier.enabled(), false)
  assert.equal(makeNotifier().notifier.enabled(), true)
})

test('a disabled notifier rejects without touching the network', async () => {
  const { notifier, calls } = makeNotifier({ enabled: false })
  const result = await notifier.sendCompletion({ title: 't', startedAt: 0 })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'not-configured')
  assert.equal(calls.length, 0)
})

test('non-[+] messages are never sent to the network', async () => {
  const { notifier, calls } = makeNotifier()
  const result = await notifier.send('hello')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'prefix')
  assert.equal(calls.length, 0)
})

test('a [+] message posts the text payload to the webhook', async () => {
  const { notifier, calls } = makeNotifier()
  const result = await notifier.send(`${DINGTALK_PREFIX}测试消息`)
  assert.equal(result.ok, true)
  assert.equal(result.attempts, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${DINGTALK_WEBHOOK}secret-token-1234`)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].init.body), { msgtype: 'text', text: { content: '[+] 测试消息' } })
})

test('a successful response without a JSON body still counts as delivered', async () => {
  const { notifier } = makeNotifier({
    fetchImpl: async () => ({ ok: true, text: async () => '' }),
  })
  const result = await notifier.send(`${DINGTALK_PREFIX}ok`)
  assert.equal(result.ok, true)
})

test('a DingTalk errcode failure is retried twice then reported', async () => {
  let calls = 0
  const { notifier } = makeNotifier({
    fetchImpl: async () => {
      calls += 1
      return { ok: true, text: async () => JSON.stringify({ errcode: 310000, errmsg: 'invalid token' }) }
    },
  })
  const result = await notifier.send(`${DINGTALK_PREFIX}retry`)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'delivery')
  assert.equal(result.attempts, 3)
  assert.equal(calls, 3)
})

test('HTTP failures are retried and then surfaced as a delivery failure', async () => {
  let calls = 0
  const { notifier } = makeNotifier({
    fetchImpl: async () => {
      calls += 1
      return { ok: false, status: 500, text: async () => '' }
    },
  })
  const result = await notifier.send(`${DINGTALK_PREFIX}x`)
  assert.equal(result.ok, false)
  assert.equal(result.attempts, 3)
  assert.equal(calls, 3)
})

test('network exceptions are retried and never leak the token', async () => {
  let calls = 0
  const { notifier } = makeNotifier({
    fetchImpl: async (url) => {
      calls += 1
      throw new Error(`connect ECONNREFUSED ${url}`)
    },
  })
  const result = await notifier.send(`${DINGTALK_PREFIX}x`)
  assert.equal(result.ok, false)
  assert.equal(result.attempts, 3)
  assert.equal(calls, 3)
  assert.equal(JSON.stringify(result).includes('secret-token'), false)
})

test('the per-attempt timeout aborts a hanging request and retries', async () => {
  let calls = 0
  const { notifier } = makeNotifier({
    timeoutMs: 10,
    fetchImpl: async (url, init) => {
      calls += 1
      return await new Promise((resolve, reject) => {
        const signal = init.signal
        if (signal?.aborted) reject(new Error('aborted'))
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    },
  })
  const result = await notifier.send(`${DINGTALK_PREFIX}slow`)
  assert.equal(result.ok, false)
  assert.equal(result.attempts, 3)
  assert.equal(calls, 3)
})

test('results never contain the token in any field', async () => {
  const { notifier } = makeNotifier()
  await notifier.send(`${DINGTALK_PREFIX}a`)
  await notifier.send('bad')
  await notifier.sendTest()
  const serialized = JSON.stringify(notifier.lastResult())
  assert.equal(serialized.includes('secret-token-1234'), false)
})

test('the queue serializes concurrent sends', async () => {
  let active = 0
  let maxActive = 0
  const order = []
  const { notifier } = makeNotifier({
    fetchImpl: async (url, init) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      order.push(JSON.parse(init.body).text.content)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { ok: true, text: async () => '' }
    },
  })
  await Promise.all([
    notifier.send(`${DINGTALK_PREFIX}one`),
    notifier.send(`${DINGTALK_PREFIX}two`),
  ])
  assert.equal(maxActive, 1)
  assert.deepEqual(order, ['[+] one', '[+] two'])
})

test('sendTest builds the test message with the [+] prefix', async () => {
  const { notifier, calls } = makeNotifier()
  const result = await notifier.sendTest()
  assert.equal(result.ok, true)
  const content = JSON.parse(calls[0].init.body).text.content
  assert.ok(content.startsWith(DINGTALK_PREFIX))
  assert.ok(content.includes('钉钉通知测试成功'))
})

test('sendCompletion includes the title and elapsed minutes', async () => {
  const nowMs = new Date(2026, 10, 13, 9, 5).getTime()
  const { notifier, calls } = makeNotifier({ now: () => nowMs })
  const result = await notifier.sendCompletion({ title: '修复登录', startedAt: nowMs - 12 * 60_000 })
  assert.equal(result.ok, true)
  const content = JSON.parse(calls[0].init.body).text.content
  assert.equal(content, '[+] 会话已完成：修复登录，用时 12 分钟，完成时间 09:05')
})

test('a missing fetch implementation fails softly instead of throwing', async () => {
  const settings = { get: () => ({ notifications: { dingtalkEnabled: true, dingtalkToken: 'tok' } }) }
  const notifier = createNotifier({ settings, fetchImpl: null, timeoutMs: 10 })
  const result = await notifier.send(`${DINGTALK_PREFIX}x`)
  assert.equal(result.ok, false)
  assert.equal(result.attempts, 3)
})

test('lastResult is a sanitized copy that updates after each send', async () => {
  const { notifier } = makeNotifier()
  assert.equal(notifier.lastResult(), null)
  await notifier.send(`${DINGTALK_PREFIX}first`)
  const first = notifier.lastResult()
  assert.equal(first.ok, true)
  await notifier.send(`${DINGTALK_PREFIX}second`)
  assert.notEqual(notifier.lastResult(), first)
  assert.equal(JSON.stringify(notifier.lastResult()).includes('secret-token'), false)
})
