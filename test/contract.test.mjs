import assert from 'node:assert/strict'
import test from 'node:test'
import {
  API_BASE,
  CONTRACT_VERSION,
  DEFAULT_SETTINGS,
  DINGTALK_PREFIX,
  DINGTALK_TIMEOUT_MS,
  DINGTALK_WEBHOOK,
  LOCK_RECONCILE_MS,
  LOCK_SETTLE_MS,
  ROUTES,
  SETTINGS_VERSION,
  applySettingsPatch,
  buildCompletionMessage,
  buildTestMessage,
  mergeSettings,
  publicSettings,
} from '../src/shared/contract.js'

test('contract is v5 with a minimal notifications settings shape', () => {
  assert.equal(CONTRACT_VERSION, 5)
  assert.equal(SETTINGS_VERSION, 5)
  assert.deepEqual(DEFAULT_SETTINGS, {
    version: 5,
    notifications: { dingtalkEnabled: false, dingtalkToken: '' },
  })
})

test('routes and transport constants stay stable', () => {
  assert.equal(API_BASE, '/plugins/dsh-deep-focus/api')
  assert.deepEqual(Object.keys(ROUTES).sort(), ['settings', 'skip', 'state', 'testNotify'])
  assert.equal(ROUTES.state, '/state')
  assert.equal(DINGTALK_PREFIX, '[+] ')
  assert.equal(DINGTALK_WEBHOOK, 'https://oapi.dingtalk.com/robot/send?access_token=')
  assert.equal(DINGTALK_TIMEOUT_MS, 3000)
  assert.ok(LOCK_RECONCILE_MS > 0)
  assert.ok(LOCK_SETTLE_MS > 0)
})

test('mergeSettings fills defaults and ignores junk', () => {
  assert.deepEqual(mergeSettings(null).notifications, { dingtalkEnabled: false, dingtalkToken: '' })
  const merged = mergeSettings({ notifications: { dingtalkEnabled: 'yes', dingtalkToken: 42 }, version: 99 })
  assert.equal(merged.version, 5)
  assert.equal(merged.notifications.dingtalkEnabled, false)
  assert.equal(merged.notifications.dingtalkToken, '')
})

test('mergeSettings trims and clamps the token', () => {
  const padded = mergeSettings({ notifications: { dingtalkToken: '  padded-token  ' } })
  assert.equal(padded.notifications.dingtalkToken, 'padded-token')
  const merged = mergeSettings({ notifications: { dingtalkEnabled: true, dingtalkToken: 'a'.repeat(300) } })
  assert.equal(merged.notifications.dingtalkEnabled, true)
  assert.equal(merged.notifications.dingtalkToken.length, 256)
  assert.equal(merged.notifications.dingtalkToken, 'a'.repeat(256))
})

test('publicSettings never exposes the token', () => {
  const pub = publicSettings({ notifications: { dingtalkEnabled: true, dingtalkToken: 'super-secret-token' } })
  assert.deepEqual(pub.notifications, { dingtalkEnabled: true, dingtalkTokenSet: true, dingtalkTokenHint: 'oken' })
  assert.equal(JSON.stringify(pub).includes('super-secret-token'), false)
})

test('short tokens expose no hint snippet', () => {
  const pub = publicSettings({ notifications: { dingtalkToken: 'abc' } })
  assert.equal(pub.notifications.dingtalkTokenSet, true)
  assert.equal(pub.notifications.dingtalkTokenHint, '')
})

test('applySettingsPatch keeps the stored token when omitted or empty', () => {
  const current = { notifications: { dingtalkEnabled: true, dingtalkToken: 'keep-me' } }
  assert.equal(applySettingsPatch(current, { notifications: { dingtalkEnabled: false } }).notifications.dingtalkToken, 'keep-me')
  assert.equal(applySettingsPatch(current, { notifications: { dingtalkToken: '' } }).notifications.dingtalkToken, 'keep-me')
  assert.equal(applySettingsPatch(current, {}).notifications.dingtalkToken, 'keep-me')
})

test('applySettingsPatch sets a trimmed token and null clears it', () => {
  const current = { notifications: { dingtalkEnabled: true, dingtalkToken: 'old' } }
  const set = applySettingsPatch(current, { notifications: { dingtalkToken: '  new-token  ' } })
  assert.equal(set.notifications.dingtalkToken, 'new-token')
  assert.equal(set.notifications.dingtalkEnabled, true)
  const cleared = applySettingsPatch(current, { notifications: { dingtalkToken: null } })
  assert.equal(cleared.notifications.dingtalkToken, '')
})

test('completion message is a [+] text with title, minutes and time', () => {
  const message = buildCompletionMessage({
    title: '修复登录',
    minutes: 12,
    finishedAt: new Date(2026, 10, 13, 9, 5),
  })
  assert.equal(message, '[+] 会话已完成：修复登录，用时 12 分钟，完成时间 09:05')
})

test('completion message falls back for empty title and zero minutes', () => {
  const message = buildCompletionMessage({ title: '   ', minutes: 0, finishedAt: new Date(2026, 10, 13, 9, 5) })
  assert.equal(message, '[+] 会话已完成：对话，完成时间 09:05')
})

test('test message is a [+] text with the local time', () => {
  assert.equal(buildTestMessage(new Date(2026, 10, 13, 8, 7)), '[+] 钉钉通知测试成功（08:07）')
})
