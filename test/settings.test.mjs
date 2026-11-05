import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettingsStore, normalizeSettings, publicSettings } from '../src/host/settings.js'
import { DEFAULT_SETTINGS } from '../src/shared/contract.js'

test('normalizeSettings fills every v3 default', () => {
  const settings = normalizeSettings(undefined)
  assert.equal(settings.version, 3)
  assert.deepEqual(settings.limits, DEFAULT_SETTINGS.limits)
  assert.deepEqual(settings.assistant, DEFAULT_SETTINGS.assistant)
  assert.deepEqual(settings.alerts, DEFAULT_SETTINGS.alerts)
  assert.deepEqual(settings.usage, DEFAULT_SETTINGS.usage)
  assert.deepEqual(settings.limits, {
    dailyMinutes: 180,
    continuousMinutes: 30,
    restMinutes: 10,
    extendMinutes: 20,
    dailyExtendLimit: 2,
  })
})

test('v3 has no focus, lock or security sections', () => {
  const settings = normalizeSettings({ focus: { workMinutes: 25 }, lock: { singleConversation: true }, security: { passwordHash: 'x' } })
  assert.equal(settings.focus, undefined)
  assert.equal(settings.lock, undefined)
  assert.equal(settings.security, undefined)
})

test('normalizeSettings clamps numbers and drops unknown keys', () => {
  const settings = normalizeSettings({
    limits: { dailyMinutes: -5, continuousMinutes: 9_999, restMinutes: 0, extendMinutes: 0, dailyExtendLimit: 99, nope: 1 },
    usage: { sampleSeconds: 1, retentionDays: 10_000 },
    alerts: { volume: 2 },
    unknownSection: { a: 1 },
  })
  assert.equal(settings.limits.dailyMinutes, 0)
  assert.equal(settings.limits.continuousMinutes, 600)
  assert.equal(settings.limits.restMinutes, 1)
  assert.equal(settings.limits.extendMinutes, 1)
  assert.equal(settings.limits.dailyExtendLimit, 20)
  assert.equal(settings.limits.nope, undefined)
  assert.equal(settings.usage.sampleSeconds, 3)
  assert.equal(settings.usage.retentionDays, 365)
  assert.equal(settings.alerts.volume, 1)
  assert.equal(settings.unknownSection, undefined)
  assert.equal(normalizeSettings({ limits: { dailyMinutes: 999_999 } }).limits.dailyMinutes, 1_440)
})

test('normalizeSettings coerces booleans and quiet hours', () => {
  const settings = normalizeSettings({
    assistant: { enabled: 'yes', soloSession: 0 },
    usage: { trackApps: 'no' },
    alerts: { quietHoursStart: '22:00', quietHoursEnd: '7:00' },
  })
  assert.equal(settings.assistant.enabled, DEFAULT_SETTINGS.assistant.enabled)
  assert.equal(settings.assistant.soloSession, DEFAULT_SETTINGS.assistant.soloSession)
  assert.equal(settings.usage.trackApps, DEFAULT_SETTINGS.usage.trackApps)
  assert.equal(normalizeSettings({ assistant: { enabled: false } }).assistant.enabled, false)
  assert.equal(normalizeSettings({ usage: { trackApps: false } }).usage.trackApps, false)
  assert.equal(settings.alerts.quietHoursStart, '22:00')
  assert.equal(settings.alerts.quietHoursEnd, null)
  assert.equal(normalizeSettings({ alerts: { quietHoursStart: '08:30' } }).alerts.quietHoursStart, '08:30')
})

test('publicSettings copies the merged settings', () => {
  const settings = normalizeSettings({ limits: { dailyMinutes: 60 } })
  const publicView = publicSettings(settings)
  assert.equal(publicView.limits.dailyMinutes, 60)
  assert.equal(publicView.assistant.enabled, true)
  publicView.limits.dailyMinutes = 1
  assert.equal(settings.limits.dailyMinutes, 60)
})

test('settings store persists and normalizes through the storage facade', async () => {
  const writes = []
  const storage = {
    readJson: async () => null,
    writeJson: async (path, value) => { writes.push({ path, value }) },
  }
  const store = createSettingsStore({ storage })
  await store.load()
  await store.update({ limits: { dailyMinutes: 60 }, assistant: { enabled: false } })
  assert.equal(store.get().limits.dailyMinutes, 60)
  assert.equal(store.get().assistant.enabled, false)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].path, 'settings.json')
  assert.equal(writes[0].value.version, 3)
})

test('settings updates cannot reintroduce removed sections', async () => {
  const store = createSettingsStore()
  await store.load()
  await store.update({ focus: { workMinutes: 25 }, security: { passwordHash: 'AAAA' }, lock: { single: true } })
  assert.equal(store.get().focus, undefined)
  assert.equal(store.get().security, undefined)
  assert.equal(store.get().lock, undefined)
})

test('a v3 settings file keeps and clamps its values', async () => {
  const storage = {
    readJson: async () => ({
      version: 3,
      limits: { dailyMinutes: 60, continuousMinutes: 45 },
      assistant: { enabled: false },
      alerts: { volume: -1 },
    }),
    writeJson: async () => {},
  }
  const store = createSettingsStore({ storage })
  await store.load()
  assert.equal(store.get().limits.dailyMinutes, 60)
  assert.equal(store.get().limits.continuousMinutes, 45)
  assert.equal(store.get().assistant.enabled, false)
  assert.equal(store.get().alerts.volume, 0)
  assert.equal(store.get().limits.restMinutes, 10)
})

test('v1 and v2 settings files are discarded for v3 defaults', async () => {
  const files = [
    {
      version: 1,
      focus: { workMinutes: 50 },
      limits: { dailyActiveMinutes: 480, unlockMinutes: 15 },
      security: { passwordHash: 'aGVsbG8=', passwordSalt: 'd29ybGQ=' },
    },
    {
      version: 2,
      focus: { workMinutes: 50, grayOutOtherSessions: false },
      limits: { dailyActiveMinutes: 480, continuousWorkMinutes: 90, sessionMinutes: 90, unlockMinutes: 20 },
      usage: { trackApps: false },
    },
  ]
  for (const file of files) {
    let wrote = null
    const store = createSettingsStore({
      storage: {
        readJson: async () => file,
        writeJson: async (path, value) => { wrote = { path, value } },
      },
    })
    await store.load()
    const settings = store.get()
    assert.equal(settings.version, 3)
    assert.deepEqual(settings.limits, DEFAULT_SETTINGS.limits)
    assert.deepEqual(settings.assistant, DEFAULT_SETTINGS.assistant)
    assert.equal(settings.usage.trackApps, true)
    assert.equal(settings.focus, undefined)
    assert.equal(settings.security, undefined)
    assert.equal(wrote, null)
    // The next write persists the v3 shape.
    await store.update({ limits: { dailyMinutes: 90 } })
    assert.equal(wrote.value.version, 3)
    assert.equal(wrote.value.limits.dailyMinutes, 90)
    assert.equal(wrote.value.focus, undefined)
  }
})

test('a settings file without a version is treated as pre-v3', async () => {
  const store = createSettingsStore({
    storage: {
      readJson: async () => ({ limits: { dailyMinutes: 480 }, usage: { trackApps: false } }),
      writeJson: async () => {},
    },
  })
  await store.load()
  assert.equal(store.get().version, 3)
  assert.equal(store.get().limits.dailyMinutes, 180)
  assert.equal(store.get().usage.trackApps, true)
})
