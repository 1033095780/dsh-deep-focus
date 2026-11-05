import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  createSampler,
  parseIdleLine,
  parseIoregIdle,
  parseXprintidle,
  restartDelayMs,
  samplerPlatform,
} from '../src/host/sampler.js'

test('idle stdout lines are parsed conservatively', () => {
  assert.equal(parseIdleLine('531'), 531)
  assert.equal(parseIdleLine(' 62\n'), 62)
  assert.equal(parseIdleLine('0'), 0)
  assert.equal(parseIdleLine(''), null)
  assert.equal(parseIdleLine('abc'), null)
  assert.equal(parseIdleLine('-1'), null)
  assert.equal(parseIdleLine('4294967295'), null)
  assert.equal(parseIdleLine('4294967296'), null)
  assert.equal(parseIdleLine(undefined), null)
})

test('platform probe output parsers', () => {
  const ioreg = '    | |   "HIDIdleTime" = 12345678901\n'
  assert.equal(parseIoregIdle(ioreg), 12_346)
  assert.equal(parseIoregIdle('nothing'), null)
  assert.equal(parseXprintidle('1234\n'), 1234)
  assert.equal(parseXprintidle('x'), null)
})

test('restart backoff grows and caps', () => {
  assert.equal(restartDelayMs(1), 1000)
  assert.equal(restartDelayMs(2), 2000)
  assert.equal(restartDelayMs(3), 4000)
  assert.equal(restartDelayMs(10), 30_000)
  assert.equal(restartDelayMs(99), 30_000)
  assert.equal(restartDelayMs(0), 1000)
})

test('platform mapping', () => {
  assert.equal(samplerPlatform('win32'), 'windows')
  assert.equal(samplerPlatform('darwin'), 'macos')
  assert.equal(samplerPlatform('linux'), 'linux')
  assert.equal(samplerPlatform('freebsd'), 'unsupported')
})

class FakeProcess extends EventEmitter {
  constructor() {
    super()
    this.stdout = Object.assign(new EventEmitter(), { setEncoding() {} })
    this.stderr = Object.assign(new EventEmitter(), { setEncoding() {} })
    this.killed = 0
  }

  kill() {
    this.killed += 1
    return true
  }
}

function makeFakeSpawn() {
  const calls = []
  const procs = []
  const spawn = (command, args, options) => {
    const proc = new FakeProcess()
    calls.push({ command, args, options })
    procs.push(proc)
    return proc
  }
  return { spawn, calls, procs }
}

test('the Windows sampler spawns craftsmanship-safe powershell and consumes samples', () => {
  const fake = makeFakeSpawn()
  const samples = []
  const states = []
  const sampler = createSampler({
    platform: 'win32',
    spawn: fake.spawn,
    scriptPath: 'C:/plugin/win32-idle.ps1',
    sampleSeconds: 5,
    onSample: (idleMs) => samples.push(idleMs),
    onStateChange: (state) => states.push(state),
  })
  assert.equal(sampler.state(), 'degraded')
  sampler.start()
  assert.equal(fake.calls.length, 1)
  assert.equal(fake.calls[0].command, 'powershell.exe')
  assert.deepEqual(fake.calls[0].args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'])
  assert.equal(fake.calls[0].args[5], 'C:/plugin/win32-idle.ps1')
  assert.equal(fake.calls[0].options.windowsHide, true)
  assert.equal(fake.calls[0].options.env.DSH_FOCUS_SAMPLE_MS, '5000')

  fake.procs[0].stdout.emit('data', '531\n62\n')
  assert.deepEqual(samples, [531, 62])
  assert.equal(sampler.state(), 'ok')
  assert.ok(states.includes('ok'))

  fake.procs[0].stdout.emit('data', '4294967295\n')
  assert.deepEqual(samples, [531, 62])

  fake.procs[0].stdout.emit('data', 'not-a-number\n42\n')
  assert.deepEqual(samples, [531, 62, 42])

  sampler.stop()
  assert.equal(fake.procs[0].killed, 1)
  assert.equal(sampler.state(), 'off')
  // An exit after stop must not restart anything.
  fake.procs[0].emit('exit', 0, null)
  assert.equal(fake.calls.length, 1)
})

test('a Windows child exit degrades the sampler and schedules a restart', () => {
  const fake = makeFakeSpawn()
  const sampler = createSampler({
    platform: 'win32',
    spawn: fake.spawn,
    scriptPath: 'x.ps1',
    onSample: () => {},
  })
  sampler.start()
  fake.procs[0].emit('exit', 1, null)
  assert.equal(sampler.state(), 'degraded')
  sampler.stop()
  assert.equal(sampler.state(), 'off')
})

test('changing the sample interval restarts the child with the new cadence', () => {
  const fake = makeFakeSpawn()
  const sampler = createSampler({ platform: 'win32', spawn: fake.spawn, scriptPath: 'x.ps1' })
  sampler.start()
  sampler.setSampleSeconds(10)
  assert.equal(fake.calls.length, 2)
  assert.equal(fake.calls[1].options.env.DSH_FOCUS_SAMPLE_MS, '10000')
  assert.equal(fake.procs[0].killed, 1)
  sampler.stop()
})

test('unsupported platforms report off instead of spawning', () => {
  const fake = makeFakeSpawn()
  const sampler = createSampler({ platform: 'freebsd', spawn: fake.spawn })
  assert.equal(sampler.state(), 'off')
  sampler.start()
  assert.equal(fake.calls.length, 0)
  assert.equal(sampler.state(), 'off')
})

test('a spawn error degrades instead of throwing', () => {
  const fake = makeFakeSpawn()
  const sampler = createSampler({ platform: 'win32', spawn: fake.spawn, scriptPath: 'x.ps1' })
  sampler.start()
  fake.procs[0].emit('error', new Error('ENOENT'))
  assert.equal(sampler.state(), 'degraded')
  sampler.stop()
})
