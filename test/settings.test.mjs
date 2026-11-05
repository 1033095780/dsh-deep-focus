import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSettingsStore,
  hashPassword,
  normalizeSettings,
  passwordProblem,
  publicSettings,
  verifyPasswordHash,
} from '../src/host/settings.js'
import { DEFAULT_SETTINGS } from '../src/shared/contract.js'

test('normalizeSettings fills every default', () => {
  const settings = normalizeSettings(undefined)
  assert.deepEqual(settings.focus, DEFAULT_SETTINGS.focus)
  assert.deepEqual(settings.limits, DEFAULT_SETTINGS.limits)
  assert.deepEqual(settings.lock, DEFAULT_SETTINGS.lock)
  assert.deepEqual(settings.alerts, DEFAULT_SETTINGS.alerts)
  assert.deepEqual(settings.usage, DEFAULT_SETTINGS.usage)
  assert.deepEqual(settings.security, { passwordHash: null, passwordSalt: null })
})

test('normalizeSettings clamps numbers and drops unknown keys', () => {
  const settings = normalizeSettings({
    focus: { workMinutes: 999, breakMinutes: 0, idlePauseSeconds: -5, nope: 1 },
    limits: { dailyActiveMinutes: -10, unlockMinutes: 999 },
    usage: { sampleSeconds: 1, retentionDays: 10_000 },
    alerts: { volume: 2 },
    unknownSection: { a: 1 },
  })
  assert.equal(settings.focus.workMinutes, 180)
  assert.equal(settings.focus.breakMinutes, 1)
  assert.equal(settings.focus.idlePauseSeconds, 0)
  assert.equal(settings.focus.nope, undefined)
  assert.equal(settings.limits.dailyActiveMinutes, 0)
  assert.equal(settings.limits.unlockMinutes, 120)
  assert.equal(settings.usage.sampleSeconds, 3)
  assert.equal(settings.usage.retentionDays, 365)
  assert.equal(settings.alerts.volume, 1)
  assert.equal(settings.unknownSection, undefined)
})

test('normalizeSettings coerces booleans and quiet hours', () => {
  const settings = normalizeSettings({
    alerts: { turnDone: 'yes', quietHoursStart: '22:00', quietHoursEnd: '7:00' },
    lock: { singleConversation: 0 },
  })
  assert.equal(settings.alerts.turnDone, DEFAULT_SETTINGS.alerts.turnDone)
  assert.equal(settings.lock.singleConversation, DEFAULT_SETTINGS.lock.singleConversation)
  assert.equal(settings.alerts.quietHoursStart, '22:00')
  assert.equal(settings.alerts.quietHoursEnd, null)
  assert.equal(normalizeSettings({ alerts: { quietHoursStart: '08:30' } }).alerts.quietHoursStart, '08:30')
  assert.equal(normalizeSettings({ alerts: { quietHoursStart: null } }).alerts.quietHoursStart, null)
})

test('normalizeSettings keeps only well-formed password material', () => {
  const good = normalizeSettings({ security: { passwordHash: 'aGVsbG8=', passwordSalt: 'd29ybGQ=' } })
  assert.equal(good.security.passwordHash, 'aGVsbG8=')
  const half = normalizeSettings({ security: { passwordHash: 'aGVsbG8=', passwordSalt: null } })
  assert.deepEqual(half.security, { passwordHash: null, passwordSalt: null })
  const junk = normalizeSettings({ security: { passwordHash: 'not base64!', passwordSalt: 'x' } })
  assert.deepEqual(junk.security, { passwordHash: null, passwordSalt: null })
})

test('publicSettings never exposes the password hash or salt', () => {
  const settings = normalizeSettings({ security: { passwordHash: 'aGVsbG8=', passwordSalt: 'd29ybGQ=' } })
  const publicView = publicSettings(settings)
  assert.equal(publicView.security, undefined)
  assert.equal(JSON.stringify(publicView).includes('aGVsbG8='), false)
  assert.equal(publicView.focus.workMinutes, 25)
})

test('password hashing round-trips and rejects wrong input', async () => {
  const { salt, hash } = await hashPassword('correct horse')
  assert.equal(await verifyPasswordHash('correct horse', salt, hash), true)
  assert.equal(await verifyPasswordHash('wrong horse', salt, hash), false)
  assert.equal(await verifyPasswordHash('correct horse', salt, 'AAAA'), false)
  assert.equal(await verifyPasswordHash('correct horse', 'AAAA', hash), false)
  const second = await hashPassword('correct horse')
  assert.notEqual(second.salt, salt)
  assert.notEqual(second.hash, hash)
})

test('password length validation', () => {
  assert.equal(passwordProblem('abc'), 'password-too-short')
  assert.equal(passwordProblem(''), 'password-missing')
  assert.equal(passwordProblem(42), 'password-missing')
  assert.equal(passwordProblem('x'.repeat(300)), 'password-too-long')
  assert.equal(passwordProblem('longenough'), null)
})

test('settings store persists through the storage facade', async () => {
  const writes = []
  const storage = {
    readJson: async () => null,
    writeJson: async (path, value) => { writes.push({ path, value }) },
  }
  const store = createSettingsStore({ storage })
  await store.load()
  await store.update({ focus: { workMinutes: 50 } })
  assert.equal(store.get().focus.workMinutes, 50)
  assert.equal(store.getPublic().security, undefined)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].path, 'settings.json')
  assert.equal(writes[0].value.focus.workMinutes, 50)

  await store.setPassword('secret123')
  assert.equal(store.hasPassword(), true)
  assert.equal(await store.verifyPassword('secret123'), true)
  assert.equal(await store.verifyPassword('secret124'), false)
  assert.equal(store.getPublic().security, undefined)
  await store.clearPassword()
  assert.equal(store.hasPassword(), false)
})

test('settings store loads and normalizes an existing file', async () => {
  const storage = {
    readJson: async () => ({ focus: { workMinutes: 999 }, alerts: { volume: -1 } }),
    writeJson: async () => {},
  }
  const store = createSettingsStore({ storage })
  await store.load()
  assert.equal(store.get().focus.workMinutes, 180)
  assert.equal(store.get().alerts.volume, 0)
})

test('a settings patch cannot overwrite the stored password', async () => {
  const store = createSettingsStore()
  await store.setPassword('secret123')
  await store.update({ security: { passwordHash: 'AAAA', passwordSalt: 'BBBB' }, focus: { workMinutes: 30 } })
  assert.equal(await store.verifyPassword('secret123'), true)
  assert.equal(store.get().focus.workMinutes, 30)
  assert.notEqual(store.get().security.passwordHash, 'AAAA')
})
