import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettingsStore, normalizeSettings, publicSettings } from '../src/host/settings.js'
import { DEFAULT_SETTINGS } from '../src/shared/contract.js'

test('normalizeSettings fills every v4 default', () => {
  const settings = normalizeSettings(undefined)
  assert.equal(settings.version, 4)
  assert.deepEqual(settings.limits, DEFAULT_SETTINGS.limits)
  assert.deepEqual(settings.assistant, DEFAULT_SETTINGS.assistant)
  assert.deepEqual(settings.alerts, DEFAULT_SETTINGS.alerts)
  assert.deepEqual(settings.usage, DEFAULT_SETTINGS.usage)
  assert.equal(settings.assistant.showRings, true)
  assert.equal(settings.assistant.trackingOnly, false)
  assert.equal(settings.alerts.repeatUntilActive, true)
  assert.equal(settings.alerts.repeatIntervalMs, 1000)
  assert.equal(settings.alerts.awayIdleSeconds, 30)
  // 0 = unlimited extensions per day (the v0.4.1 default).
  assert.equal(settings.limits.dailyExtendLimit, 0)
  // Auto-pause defaults to one minute of idle.
  assert.equal(settings.usage.autoPauseSeconds, 60)
})

test('v4 has no focus, lock or security sections and drops showCountdown', () => {
  const settings = normalizeSettings({
    focus: { workMinutes: 25 },
    lock: { singleConversation: true },
    security: { passwordHash: 'x' },
    assistant: { showCountdown: false, showRings: false },
  })
  assert.equal(settings.focus, undefined)
  assert.equal(settings.lock, undefined)
  assert.equal(settings.security, undefined)
  assert.equal(settings.assistant.showCountdown, undefined)
  assert.equal(settings.assistant.showRings, false)
})

test('normalizeSettings clamps numbers and drops unknown keys', () => {
  const settings = normalizeSettings({
    limits: { dailyMinutes: -5, continuousMinutes: 9_999, restMinutes: 0, extendMinutes: 0, dailyExtendLimit: 99 },
    alerts: { repeatIntervalMs: 100, awayIdleSeconds: 1, volume: 2, nope: 1 },
    usage: { sampleSeconds: 1, retentionDays: 10_000, autoPauseSeconds: 99_999 },
    unknownSection: { a: 1 },
  })
  assert.equal(settings.limits.dailyMinutes, 0)
  assert.equal(settings.limits.continuousMinutes, 600)
  assert.equal(settings.limits.restMinutes, 1)
  assert.equal(settings.limits.extendMinutes, 1)
  assert.equal(settings.limits.dailyExtendLimit, 99)
  assert.equal(settings.alerts.repeatIntervalMs, 500)
  assert.equal(settings.alerts.awayIdleSeconds, 10)
  assert.equal(settings.alerts.nope, undefined)
  assert.equal(settings.alerts.volume, 1)
  assert.equal(settings.usage.sampleSeconds, 3)
  assert.equal(settings.usage.retentionDays, 365)
  assert.equal(settings.usage.autoPauseSeconds, 3_600)
  assert.equal(normalizeSettings({ usage: { autoPauseSeconds: -5 } }).usage.autoPauseSeconds, 0)
  assert.equal(normalizeSettings({ usage: { autoPauseSeconds: 0 } }).usage.autoPauseSeconds, 0)
  assert.equal(settings.unknownSection, undefined)
  assert.equal(normalizeSettings({ alerts: { repeatIntervalMs: 999_999 } }).alerts.repeatIntervalMs, 10_000)
  assert.equal(normalizeSettings({ alerts: { awayIdleSeconds: 99_999 } }).alerts.awayIdleSeconds, 3_600)
})

test('normalizeSettings coerces booleans and quiet hours', () => {
  const settings = normalizeSettings({
    assistant: { enabled: 'yes', soloSession: 0, showRings: 'no' },
    alerts: { repeatUntilActive: 'yes', quietHoursStart: '22:00', quietHoursEnd: '7:00' },
    usage: { trackApps: 'no' },
  })
  assert.equal(settings.assistant.enabled, DEFAULT_SETTINGS.assistant.enabled)
  assert.equal(settings.assistant.soloSession, DEFAULT_SETTINGS.assistant.soloSession)
  assert.equal(settings.assistant.showRings, DEFAULT_SETTINGS.assistant.showRings)
  assert.equal(settings.alerts.repeatUntilActive, DEFAULT_SETTINGS.alerts.repeatUntilActive)
  assert.equal(settings.usage.trackApps, DEFAULT_SETTINGS.usage.trackApps)
  assert.equal(normalizeSettings({ alerts: { repeatUntilActive: false } }).alerts.repeatUntilActive, false)
  assert.equal(settings.alerts.quietHoursStart, '22:00')
  assert.equal(settings.alerts.quietHoursEnd, null)
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
  await store.update({ limits: { dailyMinutes: 60 }, assistant: { showRings: false } })
  assert.equal(store.get().limits.dailyMinutes, 60)
  assert.equal(store.get().assistant.showRings, false)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].path, 'settings.json')
  assert.equal(writes[0].value.version, 4)
})

test('settings updates cannot reintroduce removed sections', async () => {
  const store = createSettingsStore()
  await store.load()
  await store.update({ focus: { workMinutes: 25 }, security: { passwordHash: 'AAAA' }, lock: { single: true } })
  assert.equal(store.get().focus, undefined)
  assert.equal(store.get().security, undefined)
  assert.equal(store.get().lock, undefined)
})

test('a v4 settings file keeps and clamps its values', async () => {
  const storage = {
    readJson: async () => ({
      version: 4,
      limits: { dailyMinutes: 60, continuousMinutes: 45 },
      assistant: { enabled: false, showRings: false, trackingOnly: true },
      alerts: { volume: -1, repeatIntervalMs: 7_500, awayIdleSeconds: 120 },
    }),
    writeJson: async () => {},
  }
  const store = createSettingsStore({ storage })
  await store.load()
  assert.equal(store.get().limits.dailyMinutes, 60)
  assert.equal(store.get().limits.continuousMinutes, 45)
  assert.equal(store.get().assistant.enabled, false)
  assert.equal(store.get().assistant.showRings, false)
  assert.equal(store.get().assistant.trackingOnly, true)
  assert.equal(store.get().alerts.volume, 0)
  assert.equal(store.get().alerts.repeatIntervalMs, 7_500)
  assert.equal(store.get().alerts.awayIdleSeconds, 120)
  assert.equal(store.get().limits.restMinutes, 10)
})

test('v1/v2/v3 settings files are discarded for v4 defaults', async () => {
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
    {
      version: 3,
      limits: { dailyMinutes: 90, continuousMinutes: 20 },
      assistant: { enabled: false, showCountdown: false },
      alerts: { taskDone: false, volume: 0.2 },
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
    assert.equal(settings.version, 4)
    assert.deepEqual(settings.limits, DEFAULT_SETTINGS.limits)
    assert.deepEqual(settings.assistant, DEFAULT_SETTINGS.assistant)
    assert.deepEqual(settings.alerts, DEFAULT_SETTINGS.alerts)
    assert.equal(settings.usage.trackApps, true)
    assert.equal(settings.focus, undefined)
    assert.equal(settings.security, undefined)
    assert.equal(wrote, null)
    // The next write persists the v4 shape.
    await store.update({ limits: { dailyMinutes: 90 } })
    assert.equal(wrote.value.version, 4)
    assert.equal(wrote.value.limits.dailyMinutes, 90)
    assert.equal(wrote.value.assistant.showRings, true)
  }
})

test('a settings file without a version is treated as pre-v4', async () => {
  const store = createSettingsStore({
    storage: {
      readJson: async () => ({ limits: { dailyMinutes: 480 }, usage: { trackApps: false } }),
      writeJson: async () => {},
    },
  })
  await store.load()
  assert.equal(store.get().version, 4)
  assert.equal(store.get().limits.dailyMinutes, 180)
  assert.equal(store.get().usage.trackApps, true)
})
