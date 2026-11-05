import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import {
  createSampler,
  parseIoregIdle,
  parseSampleLine,
  parseXdotoolPid,
  parseXprintidle,
  restartDelayMs,
  samplerPlatform,
} from '../src/host/sampler.js'

test('sampler lines carry idle, pid and executable name', () => {
  assert.deepEqual(parseSampleLine('531|1234|chrome'), { idleMs: 531, pid: 1234, app: 'chrome' })
  assert.deepEqual(parseSampleLine('531|1234|chrome\r'), { idleMs: 531, pid: 1234, app: 'chrome' })
  assert.deepEqual(parseSampleLine('62|0|'), { idleMs: 62, pid: null, app: null })
  assert.deepEqual(parseSampleLine('62||'), { idleMs: 62, pid: null, app: null })
  // A v1 idle-only line still feeds idle tracking after an upgrade.
  assert.deepEqual(parseSampleLine('62'), { idleMs: 62, pid: null, app: null })
  assert.equal(parseSampleLine('4294967295|1|chrome'), null)
  assert.equal(parseSampleLine('abc|1|chrome'), null)
  assert.equal(parseSampleLine(''), null)
  assert.equal(parseSampleLine(undefined), null)
})

test('platform probe output parsers', () => {
  const ioreg = '    | |   "HIDIdleTime" = 12345678901\n'
  assert.equal(parseIoregIdle(ioreg), 12_346)
  assert.equal(parseIoregIdle('nothing'), null)
  assert.equal(parseXprintidle('1234\n'), 1234)
  assert.equal(parseXprintidle('x'), null)
  assert.equal(parseXdotoolPid('5678\n'), 5678)
  assert.equal(parseXdotoolPid('0'), null)
  assert.equal(parseXdotoolPid('id'), null)
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

test('the Windows sampler streams foreground samples from one powershell child', () => {
  const fake = makeFakeSpawn()
  const samples = []
  const states = []
  let clock = 1000
  const sampler = createSampler({
    platform: 'win32',
    spawn: fake.spawn,
    scriptPath: 'C:/plugin/win32-idle.ps1',
    sampleSeconds: 5,
    now: () => clock,
    onSample: (sample) => samples.push(sample),
    onStateChange: (state) => states.push(state),
  })
  assert.equal(sampler.state(), 'degraded')
  assert.equal(sampler.appsState(), 'off')
  assert.equal(sampler.lastSampleAt(), null)
  sampler.start()
  assert.equal(fake.calls.length, 1)
  assert.equal(fake.calls[0].command, 'powershell.exe')
  assert.deepEqual(fake.calls[0].args.slice(0, 5), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'])
  assert.equal(fake.calls[0].args[5], 'C:/plugin/win32-idle.ps1')
  assert.equal(fake.calls[0].options.env.DSH_FOCUS_SAMPLE_MS, '5000')

  fake.procs[0].stdout.emit('data', '531|1234|msedge\n62|1234|\n')
  assert.deepEqual(samples, [
    { idleMs: 531, pid: 1234, app: 'msedge' },
    { idleMs: 62, pid: 1234, app: null },
  ])
  assert.equal(sampler.state(), 'ok')
  assert.equal(sampler.appsState(), 'ok')
  assert.equal(sampler.lastApp(), 'msedge')
  // Exposes when the latest accepted sample arrived (used by the auto-pause gate).
  assert.equal(sampler.lastSampleAt(), 1000)

  // Foreground names expire from the app window but idle tracking continues.
  clock += 60_000
  fake.procs[0].stdout.emit('data', '100|1234|\n')
  assert.equal(sampler.appsState(), 'off')
  assert.equal(sampler.state(), 'ok')

  fake.procs[0].stdout.emit('data', 'not-a-sample\n')
  assert.equal(samples.length, 3)

  sampler.stop()
  assert.equal(fake.procs[0].killed, 1)
  assert.equal(sampler.state(), 'off')
  assert.equal(sampler.appsState(), 'off')
  // An exit after stop must not restart anything.
  fake.procs[0].emit('exit', 0, null)
  assert.equal(fake.calls.length, 1)
  assert.ok(states.includes('ok'))
})

test('a Windows child exit degrades the sampler and schedules a restart', () => {
  const fake = makeFakeSpawn()
  const sampler = createSampler({ platform: 'win32', spawn: fake.spawn, scriptPath: 'x.ps1', onSample: () => {} })
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
  assert.equal(sampler.appsState(), 'off')
})

test('a spawn error degrades instead of throwing', () => {
  const fake = makeFakeSpawn()
  const sampler = createSampler({ platform: 'win32', spawn: fake.spawn, scriptPath: 'x.ps1' })
  sampler.start()
  fake.procs[0].emit('error', new Error('ENOENT'))
  assert.equal(sampler.state(), 'degraded')
  sampler.stop()
})

function makeExecFile(responses) {
  const calls = []
  const execFileFn = (command, args, options, callback) => {
    calls.push({ command, args })
    const output = responses[command]
    if (output === undefined) callback(new Error(`missing ${command}`), '')
    else callback(null, output)
  }
  return { execFileFn, calls }
}

test('macOS probes combine ioreg idle time with the frontmost app', async () => {
  const fake = makeExecFile({
    ioreg: '    | |   "HIDIdleTime" = 5000000000\n',
    osascript: 'Google Chrome\n',
  })
  const samples = []
  const sampler = createSampler({
    platform: 'darwin',
    execFileFn: fake.execFileFn,
    sampleSeconds: 5,
    onSample: (sample) => samples.push(sample),
  })
  sampler.start()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.ok(samples.length >= 1)
  assert.equal(samples[0].idleMs, 5000)
  assert.equal(samples[0].app, 'Google Chrome')
  assert.equal(sampler.state(), 'ok')
  assert.equal(sampler.appsState(), 'ok')
  sampler.stop()
  assert.equal(sampler.state(), 'off')
})

test('linux probes keep idle tracking when the foreground app is unavailable', async () => {
  const fake = makeExecFile({ xprintidle: '1234\n', xdotool: '999999\n' })
  const samples = []
  const sampler = createSampler({
    platform: 'linux',
    execFileFn: fake.execFileFn,
    sampleSeconds: 5,
    onSample: (sample) => samples.push(sample),
  })
  sampler.start()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.ok(samples.length >= 1)
  assert.equal(samples[0].idleMs, 1234)
  assert.ok(samples[0].app === null || typeof samples[0].app === 'string')
  assert.equal(sampler.state(), 'ok')
  sampler.stop()
})
