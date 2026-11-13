import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createStorage, pluginDataDir, resolveDshHome } from '../src/host/storage.js'

async function makeTempDir() {
  return await fs.mkdtemp(join(tmpdir(), 'dsh-focus-test-'))
}

test('resolveDshHome prefers an explicit DSH_HOME', () => {
  assert.equal(resolveDshHome({ DSH_HOME: 'C:/custom/home' }, 'C:/users/x'), 'C:\\custom\\home')
  assert.equal(resolveDshHome({ DSH_HOME: '   ' }, 'C:/users/x'), 'C:\\users\\x\\.dsh')
})

test('pluginDataDir lives under plugin-data/dsh-deep-focus', () => {
  const dir = pluginDataDir({ env: { DSH_HOME: 'C:/dsh-home' }, home: 'C:/users/x' })
  assert.equal(dir, join('C:\\dsh-home', 'plugin-data', 'dsh-deep-focus'))
})

test('JSON files round-trip and readJson falls back for missing files', async () => {
  const dir = await makeTempDir()
  try {
    const storage = createStorage({ dir })
    assert.equal(await storage.readJson('missing.json', 'fallback'), 'fallback')
    await storage.writeJson('nested/file.json', { hello: 'world' })
    assert.deepEqual(await storage.readJson('nested/file.json'), { hello: 'world' })
    await fs.writeFile(join(dir, 'broken.json'), '{not json', 'utf8')
    assert.equal(await storage.readJson('broken.json', null), null)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('remove and listDir are safe for absent paths', async () => {
  const dir = await makeTempDir()
  try {
    const storage = createStorage({ dir })
    assert.equal(await storage.remove('nothing.json'), true)
    assert.deepEqual(await storage.listDir('nothing-here'), [])
    await storage.writeJson('settings.json', { version: 5 })
    const names = (await storage.listDir()).map((entry) => entry.name)
    assert.deepEqual(names, ['settings.json'])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('cleanupLegacyData deletes day files and limits.json but keeps live files', async () => {
  const dir = await makeTempDir()
  try {
    const storage = createStorage({ dir })
    await fs.mkdir(join(dir, 'usage'), { recursive: true })
    await fs.writeFile(join(dir, 'usage', '2026-11-05.jsonl'), '{}\n', 'utf8')
    await fs.writeFile(join(dir, 'usage', '2026-11-06.jsonl'), '{}\n', 'utf8')
    await fs.writeFile(join(dir, '2026-11-07.jsonl'), '{}\n', 'utf8')
    await fs.writeFile(join(dir, 'limits.json'), '{}', 'utf8')
    await storage.writeJson('settings.json', { version: 5 })
    await storage.writeJson('lock.json', { version: 1, lock: null })

    const removed = await storage.cleanupLegacyData()
    assert.ok(removed.includes('2026-11-07.jsonl'))
    assert.ok(removed.includes('limits.json'))
    assert.ok(removed.includes('usage/2026-11-05.jsonl'))
    const rootNames = (await storage.listDir()).map((entry) => entry.name).sort()
    assert.deepEqual(rootNames, ['lock.json', 'settings.json'])
    assert.deepEqual(await storage.listDir('usage'), [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('cleanupLegacyData is idempotent and never throws on an empty directory', async () => {
  const dir = await makeTempDir()
  try {
    const storage = createStorage({ dir })
    assert.deepEqual(await storage.cleanupLegacyData(), [])
    assert.deepEqual(await storage.cleanupLegacyData(), [])
    assert.equal(await storage.readJson('limits.json', 'missing'), 'missing')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('flush waits for queued writes', async () => {
  const dir = await makeTempDir()
  try {
    const storage = createStorage({ dir })
    void storage.writeJson('a.json', { a: 1 })
    void storage.writeJson('a.json', { a: 2 })
    await storage.flush()
    assert.deepEqual(await storage.readJson('a.json'), { a: 2 })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
