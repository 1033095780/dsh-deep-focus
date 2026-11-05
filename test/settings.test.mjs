import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettingsStore, normalizeSettings, publicSettings } from '../src/host/settings.js'
import { DEFAULT_SETTINGS } from '../src/shared/contract.js'

test('normalizeSettings fills every v2 default', () => {
  const settings = normalizeSettings(undefined)
  assert.deepEqual(settings.focus, DEFAULT_SETTINGS.focus)
  assert.deepEqual(settings.limits, DEFAULT_SETTINGS.limits)
  assert.deepEqual(settings.alerts, DEFAULT_SETTINGS.alerts)
  assert.deepEqual(settings.usage, DEFAULT_SETTINGS.usage)
})

test('v2 has no security or lock sections and limits default to off', () => {
  const settings = normalizeSettings({ security: { passwordHash: 'x' }, lock: { singleConversation: true } })
  assert.equal(settings.security, undefined)
  assert.equal(settings.lock, undefined)
  assert.equal(settings.limits.dailyActiveMinutes, 0)
  assert.equal(settings.limits.continuousWorkMinutes, 0)
  assert.equal(settings.limits.sessionMinutes, 0)
  assert.equal(settings.limits.unlockMinutes, 20)
  assert.equal(settings.usage.trackApps, true)
  assert.equal(settings.focus.grayOutOtherSessions, true)
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
    focus: { grayOutOtherSessions: 0 },
    usage: { trackApps: 'no' },
  })
  assert.equal(settings.alerts.turnDone, DEFAULT_SETTINGS.alerts.turnDone)
  assert.equal(settings.focus.grayOutOtherSessions, DEFAULT_SETTINGS.focus.grayOutOtherSessions)
  assert.equal(settings.usage.trackApps, DEFAULT_SETTINGS.usage.trackApps)
  assert.equal(normalizeSettings({ usage: { trackApps: false } }).usage.trackApps, false)
  assert.equal(settings.alerts.quietHoursStart, '22:00')
  assert.equal(settings.alerts.quietHoursEnd, null)
  assert.equal(normalizeSettings({ alerts: { quietHoursStart: '08:30' } }).alerts.quietHoursStart, '08:30')
  assert.equal(normalizeSettings({ alerts: { quietHoursStart: null } }).alerts.quietHoursStart, null)
})

test('publicSettings copies the merged settings', () => {
  const settings = normalizeSettings({ focus: { workMinutes: 30 } })
  const publicView = publicSettings(settings)
  assert.equal(publicView.focus.workMinutes, 30)
  assert.equal(publicView.limits.unlockMinutes, 20)
  publicView.focus.workMinutes = 1
  assert.equal(settings.focus.workMinutes, 30)
})

test('settings store persists and normalizes through the storage facade', async () => {
  const writes = []
  const storage = {
    readJson: async () => null,
    writeJson: async (path, value) => { writes.push({ path, value }) },
  }
  const store = createSettingsStore({ storage })
  await store.load()
  await store.update({ focus: { workMinutes: 50 }, limits: { dailyActiveMinutes: 60 } })
  assert.equal(store.get().focus.workMinutes, 50)
  assert.equal(store.get().limits.dailyActiveMinutes, 60)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].path, 'settings.json')
  assert.equal(writes[0].value.focus.workMinutes, 50)
})

test('settings updates cannot reintroduce removed sections', async () => {
  const store = createSettingsStore()
  await store.load()
  await store.update({ security: { passwordHash: 'AAAA' }, lock: { singleConversation: true }, usage: { trackApps: false } })
  assert.equal(store.get().security, undefined)
  assert.equal(store.get().lock, undefined)
  assert.equal(store.get().usage.trackApps, false)
})

test('settings store loads and clamps a v2 file', async () => {
  const storage = {
    readJson: async () => ({ version: 2, focus: { workMinutes: 999 }, alerts: { volume: -1 }, limits: { dailyActiveMinutes: -1 } }),
    writeJson: async () => {},
  }
  const store = createSettingsStore({ storage })
  await store.load()
  assert.equal(store.get().focus.workMinutes, 180)
  assert.equal(store.get().alerts.volume, 0)
  assert.equal(store.get().limits.dailyActiveMinutes, 0)
})

test('a v1 settings file is discarded and replaced by v2 defaults', async () => {
  const v1File = {
    version: 1,
    focus: { workMinutes: 50, autoStartBreak: false },
    limits: { dailyActiveMinutes: 480, continuousWorkMinutes: 90, sessionMinutes: 90, unlockMinutes: 15 },
    lock: { singleConversation: true, blockToolsOutsideFocus: true },
    alerts: { taskDone: false, volume: 0.2 },
    usage: { sampleSeconds: 10, retentionDays: 7, trackApps: false },
    security: { passwordHash: 'aGVsbG8=', passwordSalt: 'd29ybGQ=' },
  }
  let wrote = null
  const storage = {
    readJson: async () => v1File,
    writeJson: async (path, value) => { wrote = { path, value } },
  }
  const store = createSettingsStore({ storage })
  await store.load()
  const settings = store.get()
  assert.equal(settings.version, 2)
  // Every v1 value is dropped, not carried over into v2.
  assert.deepEqual(settings.limits, DEFAULT_SETTINGS.limits)
  assert.equal(settings.limits.dailyActiveMinutes, 0)
  assert.equal(settings.focus.workMinutes, 25)
  assert.equal(settings.focus.autoStartBreak, true)
  assert.equal(settings.alerts.taskDone, true)
  assert.equal(settings.usage.sampleSeconds, 5)
  assert.equal(settings.usage.retentionDays, 30)
  assert.equal(settings.usage.trackApps, true)
  assert.equal(settings.security, undefined)
  assert.equal(settings.lock, undefined)
  assert.equal(wrote, null)

  // The next write persists the v2 shape.
  await store.update({ focus: { workMinutes: 30 } })
  assert.ok(wrote !== null)
  assert.equal(wrote.path, 'settings.json')
  assert.equal(wrote.value.version, 2)
  assert.equal(wrote.value.focus.workMinutes, 30)
  assert.equal(wrote.value.security, undefined)
})

test('a settings file without a version is treated as v1', async () => {
  const storage = {
    readJson: async () => ({ focus: { workMinutes: 50 }, limits: { dailyActiveMinutes: 480 } }),
    writeJson: async () => {},
  }
  const store = createSettingsStore({ storage })
  await store.load()
  assert.equal(store.get().version, 2)
  assert.equal(store.get().focus.workMinutes, 25)
  assert.equal(store.get().limits.dailyActiveMinutes, 0)
})
