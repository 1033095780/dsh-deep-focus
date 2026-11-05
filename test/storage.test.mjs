import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import {
  createStorage,
  dayKeyAt,
  localDayKey,
  pluginDataDir,
  resolveDshHome,
  shiftDayKey,
} from '../src/host/storage.js'

test('dayKeyAt honors the timezone offset', () => {
  assert.equal(dayKeyAt(0, 0), '1970-01-01')
  const instant = Date.UTC(2026, 10, 4, 20, 0, 0)
  assert.equal(dayKeyAt(instant, 0), '2026-11-04')
  // UTC+8 (offset -480): local time is 2026-11-05 04:00.
  assert.equal(dayKeyAt(instant, -480), '2026-11-05')
  // UTC-10 (offset 600): local time is 2026-11-04 10:00.
  assert.equal(dayKeyAt(instant, 600), '2026-11-04')
})

test('localDayKey matches the local calendar date', () => {
  const now = Date.now()
  const date = new Date(now)
  const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  assert.equal(localDayKey(now), expected)
})

test('shiftDayKey crosses month and year boundaries', () => {
  assert.equal(shiftDayKey('2026-11-01', -1), '2026-10-31')
  assert.equal(shiftDayKey('2026-01-01', -1), '2025-12-31')
  assert.equal(shiftDayKey('2026-02-28', 1), '2026-03-01')
  assert.equal(shiftDayKey('2026-11-05', 0), '2026-11-05')
  assert.equal(shiftDayKey('not-a-day', -1), 'not-a-day')
})

test('resolveDshHome prefers DSH_HOME and falls back to the home directory', () => {
  assert.equal(resolveDshHome({ DSH_HOME: 'dsh-home' }, '/home/x'), resolve('dsh-home'))
  assert.equal(resolveDshHome({ DSH_HOME: '' }, '/home/x'), resolve(join('/home/x', '.dsh')))
  assert.equal(resolveDshHome({}, '/home/x'), resolve(join('/home/x', '.dsh')))
})

test('pluginDataDir appends the plugin data path', () => {
  const dir = pluginDataDir({ env: { DSH_HOME: '/tmp/dsh' }, home: '/home/x' })
  assert.equal(dir, join(resolveDshHome({ DSH_HOME: '/tmp/dsh' }, '/home/x'), 'plugin-data', 'dsh-deep-focus'))
  const fallback = pluginDataDir({ env: {}, home: '/home/x' })
  assert.equal(fallback, join(resolveDshHome({}, '/home/x'), 'plugin-data', 'dsh-deep-focus'))
})

test('storage round-trips JSON atomically and lists day files', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-focus-'))
  try {
    const storage = createStorage({ dir })
    assert.equal(await storage.readJson('missing.json', 'fallback'), 'fallback')
    await storage.writeJson('settings.json', { hello: 'world' })
    assert.deepEqual(await storage.readJson('settings.json'), { hello: 'world' })
    assert.deepEqual(await fs.readdir(dir), ['settings.json'])

    await storage.appendJsonl('usage/2026-11-05.jsonl', { t: 1, ms: 5000 })
    await storage.appendJsonl('usage/2026-11-05.jsonl', { t: 2, ms: 7000 })
    await storage.appendJsonl('stats/2026-11-05.jsonl', { t: 1, kind: 'focus', ms: 1000 })
    assert.equal(await storage.readUsageMs('2026-11-05'), 12_000)
    assert.equal((await storage.readJsonl('usage/2026-11-05.jsonl', { limit: 1 })).length, 1)
    assert.deepEqual(await storage.listDayKeys('usage'), ['2026-11-05'])
    assert.deepEqual(await storage.listDayKeys('nope'), [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('storage serializes concurrent writes to one file', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-focus-'))
  try {
    const storage = createStorage({ dir })
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => storage.appendJsonl('usage/2026-11-05.jsonl', { t: index, ms: 1 })),
    )
    const records = await storage.readJsonl('usage/2026-11-05.jsonl')
    assert.equal(records.length, 20)
    assert.equal(await storage.readUsageMs('2026-11-05'), 20)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('storage prunes day files outside the retention window', async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), 'dsh-focus-'))
  try {
    const storage = createStorage({ dir })
    await storage.appendJsonl('usage/2026-10-01.jsonl', { ms: 1 })
    await storage.appendJsonl('usage/2026-11-01.jsonl', { ms: 1 })
    await storage.appendJsonl('usage/2026-11-05.jsonl', { ms: 1 })
    await storage.appendJsonl('stats/2026-10-01.jsonl', { kind: 'focus', ms: 1 })
    const removed = await storage.prune({ retentionDays: 7, dayKey: '2026-11-05' })
    assert.equal(removed, 2)
    assert.deepEqual(await storage.listDayKeys('usage'), ['2026-11-01', '2026-11-05'])
    assert.deepEqual(await storage.listDayKeys('stats'), [])
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
