import assert from 'node:assert/strict'
import test from 'node:test'
import { createSettingsStore } from '../src/host/settings.js'

function memoryStorage(initial = null) {
  const files = new Map()
  if (initial !== null) files.set('settings.json', initial)
  const writes = []
  return {
    files,
    writes,
    async readJson(name, fallback = null) {
      return files.has(name) ? files.get(name) : fallback
    },
    async writeJson(name, value) {
      writes.push({ name, value: structuredClone(value) })
      files.set(name, structuredClone(value))
    },
  }
}

test('empty storage loads v5 defaults and persists a v5 document', async () => {
  const storage = memoryStorage()
  const store = createSettingsStore({ storage })
  const settings = await store.load()
  assert.equal(settings.version, 5)
  assert.deepEqual(settings.notifications, { dingtalkEnabled: false, dingtalkToken: '' })
  assert.equal(storage.writes.length, 1)
  assert.equal(storage.writes[0].value.version, 5)
})

test('a legacy v4 settings file is normalized and rewritten', async () => {
  const storage = memoryStorage({ version: 4, notifications: { dingtalkEnabled: true, dingtalkToken: '  legacy-token  ' } })
  const store = createSettingsStore({ storage })
  const settings = await store.load()
  assert.equal(settings.version, 5)
  assert.equal(settings.notifications.dingtalkEnabled, true)
  assert.equal(settings.notifications.dingtalkToken, 'legacy-token')
  assert.equal(storage.writes.at(-1).value.version, 5)
})

test('update applies the patch and persists it', async () => {
  const storage = memoryStorage()
  const store = createSettingsStore({ storage })
  await store.load()
  const next = await store.update({ notifications: { dingtalkEnabled: true, dingtalkToken: 'token-1' } })
  assert.equal(next.notifications.dingtalkEnabled, true)
  assert.equal(next.notifications.dingtalkToken, 'token-1')
  assert.deepEqual(storage.files.get('settings.json').notifications, { dingtalkEnabled: true, dingtalkToken: 'token-1' })
})

test('getPublic hides the token while reporting it is set', async () => {
  const storage = memoryStorage()
  const store = createSettingsStore({ storage })
  await store.load()
  await store.update({ notifications: { dingtalkToken: 'top-secret' } })
  const pub = store.getPublic()
  assert.equal(pub.notifications.dingtalkTokenSet, true)
  assert.equal(pub.notifications.dingtalkTokenHint, 'cret')
  assert.equal(JSON.stringify(pub).includes('top-secret'), false)
})

test('update with an omitted token keeps it; null clears it', async () => {
  const storage = memoryStorage()
  const store = createSettingsStore({ storage })
  await store.load()
  await store.update({ notifications: { dingtalkToken: 'kept-token' } })
  await store.update({ notifications: { dingtalkEnabled: false } })
  assert.equal(store.getPublic().notifications.dingtalkTokenSet, true)
  await store.update({ notifications: { dingtalkToken: null } })
  assert.equal(store.getPublic().notifications.dingtalkTokenSet, false)
})

test('corrupted storage falls back to defaults without throwing', async () => {
  const storage = memoryStorage('not-an-object')
  const store = createSettingsStore({ storage })
  const settings = await store.load()
  assert.equal(settings.version, 5)
  assert.equal(settings.notifications.dingtalkEnabled, false)
})

test('a store without storage still works in memory', async () => {
  const store = createSettingsStore()
  await store.load()
  await store.update({ notifications: { dingtalkToken: 'memory-token' } })
  assert.equal(store.getPublic().notifications.dingtalkTokenSet, true)
  assert.equal(JSON.stringify(store.getPublic()).includes('memory-token'), false)
})
