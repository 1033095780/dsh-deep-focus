/**
 * Whole-machine idle sampler: one long-lived PowerShell child on Windows, one-shot probes elsewhere.
 * Samples are idle milliseconds; the value is never trusted when it is unavailable or malformed.
 */
import { execFile, spawn as spawnChild } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SAMPLING = { ok: 'ok', degraded: 'degraded', off: 'off' }
export const WIN32_SCRIPT = fileURLToPath(new URL('./win32-idle.ps1', import.meta.url))

const UNAVAILABLE_IDLE = 0xff_ff_ff_ff
const MAX_BACKOFF_MS = 30_000
const MAX_START_FAILURES = 4
const STALE_INTERVALS = 3

/** One stdout line from the Windows sampler -> idle ms, or null for anything unusable. */
export function parseIdleLine(line) {
  if (typeof line !== 'string') return null
  const text = line.trim()
  if (text.length === 0 || !/^\d+$/.test(text)) return null
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 0 || value > UNAVAILABLE_IDLE) return null
  return value === UNAVAILABLE_IDLE ? null : value
}

/** `ioreg -c IOHIDSystem` output -> idle ms (HIDIdleTime is nanoseconds). */
export function parseIoregIdle(text) {
  if (typeof text !== 'string') return null
  const match = /"HIDIdleTime"\s*=\s*(\d+)/.exec(text)
  if (match === null) return null
  const nanoseconds = Number(match[1])
  if (!Number.isFinite(nanoseconds) || nanoseconds < 0) return null
  return Math.round(nanoseconds / 1e6)
}

/** `xprintidle` output (already milliseconds). */
export function parseXprintidle(text) {
  if (typeof text !== 'string') return null
  const text2 = text.trim()
  if (!/^\d+$/.test(text2)) return null
  const value = Number(text2)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Exponential restart backoff: 1s, 2s, 4s ... capped at 30s. */
export function restartDelayMs(attempt) {
  const normalized = Math.max(1, Math.min(Math.round(attempt), 10))
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** (normalized - 1))
}

export function samplerPlatform(platform = process.platform) {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (platform === 'linux') return 'linux'
  return 'unsupported'
}

const noop = () => {}

/**
 * Create the sampler. `start()`/`stop()` are idempotent; a failed start keeps the
 * plugin usable by reporting `degraded` and, after repeated failures, `off`.
 */
export function createSampler({
  sampleSeconds = 5,
  platform = process.platform,
  scriptPath = WIN32_SCRIPT,
  now = Date.now,
  onSample = noop,
  onStateChange = noop,
  spawn = spawnChild,
  execFileFn = execFile,
} = {}) {
  const kind = samplerPlatform(platform)
  let seconds = Math.min(30, Math.max(3, Math.round(sampleSeconds)))
  let state = kind === 'unsupported' ? SAMPLING.off : SAMPLING.degraded
  let detail = kind === 'unsupported' ? `unsupported platform: ${platform}` : 'not started'
  let active = false
  let child = null
  let stdoutBuffer = ''
  let lastStderr = ''
  let lastSampleAt = null
  let lastIdleMs = null
  let attempts = 0
  let probeBusy = false
  let probeTimer = null
  let watchdogTimer = null
  let restartTimer = null
  let forceKillTimer = null

  function setState(next, nextDetail) {
    const changed = state !== next || detail !== nextDetail
    state = next
    detail = nextDetail
    if (changed) onStateChange(state, detail)
  }

  function sampleAccepted(idleMs) {
    lastIdleMs = idleMs
    lastSampleAt = now()
    attempts = 0
    if (state !== SAMPLING.ok) setState(SAMPLING.ok, '')
    try {
      onSample(idleMs, now())
    } catch {
      // A consumer failure must not kill the sampler.
    }
  }

  function parseStdout(chunk) {
    stdoutBuffer += chunk
    let index = stdoutBuffer.indexOf('\n')
    while (index !== -1) {
      const line = stdoutBuffer.slice(0, index)
      stdoutBuffer = stdoutBuffer.slice(index + 1)
      const idleMs = parseIdleLine(line)
      if (idleMs !== null) sampleAccepted(idleMs)
      index = stdoutBuffer.indexOf('\n')
    }
    if (stdoutBuffer.length > 4096) stdoutBuffer = ''
  }

  function clearTimers() {
    if (probeTimer !== null) clearInterval(probeTimer)
    if (watchdogTimer !== null) clearInterval(watchdogTimer)
    if (restartTimer !== null) clearTimeout(restartTimer)
    if (forceKillTimer !== null) clearTimeout(forceKillTimer)
    probeTimer = null
    watchdogTimer = null
    restartTimer = null
    forceKillTimer = null
  }

  /** Detach and terminate the Windows child without letting its exit handler restart it. */
  function killChild(reason) {
    const current = child
    child = null
    if (current === null) return
    try {
      current.kill()
    } catch {
      // Already gone.
    }
    if (forceKillTimer !== null) clearTimeout(forceKillTimer)
    forceKillTimer = setTimeout(() => {
      forceKillTimer = null
      try {
        current.kill('SIGKILL')
      } catch {
        // Already gone.
      }
    }, 2000)
    forceKillTimer.unref?.()
    if (reason !== undefined) lastStderr = reason
  }

  function scheduleRestart(reason) {
    if (!active) return
    if (attempts >= MAX_START_FAILURES) {
      setState(SAMPLING.off, `stopped after ${attempts} failed starts: ${reason}`)
      return
    }
    setState(SAMPLING.degraded, reason)
    if (restartTimer !== null) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      restartTimer = null
      if (active && child === null) startWindowsChild()
    }, restartDelayMs(attempts))
    restartTimer.unref?.()
  }

  function startWatchdog() {
    if (watchdogTimer !== null) clearInterval(watchdogTimer)
    const interval = Math.max(2000, seconds * 1000)
    watchdogTimer = setInterval(() => {
      if (!active || child === null) return
      const since = lastSampleAt ?? now()
      if (now() - since > interval * STALE_INTERVALS) {
        killChild('no samples received')
        scheduleRestart('powershell produced no samples')
      }
    }, interval)
    watchdogTimer.unref?.()
  }

  function startWindowsChild() {
    if (!active) return
    attempts += 1
    stdoutBuffer = ''
    lastStderr = ''
    let proc
    try {
      proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DSH_FOCUS_SAMPLE_MS: String(seconds * 1000) },
      })
    } catch (error) {
      scheduleRestart(`spawn failed: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    child = proc
    proc.stdout?.setEncoding('utf8')
    proc.stderr?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk) => {
      if (child === proc) parseStdout(chunk)
    })
    proc.stderr?.on('data', (chunk) => {
      lastStderr = (lastStderr + String(chunk)).slice(-400)
    })
    proc.on('error', (error) => {
      if (child !== proc) return
      child = null
      scheduleRestart(`powershell error: ${error instanceof Error ? error.message : String(error)}`)
    })
    proc.on('exit', (code, signal) => {
      if (child !== proc) return
      child = null
      const suffix = signal === null ? `code ${String(code)}` : `signal ${String(signal)}`
      const stderr = lastStderr.trim()
      scheduleRestart(`powershell exited (${suffix})${stderr.length > 0 ? `: ${stderr}` : ''}`)
    })
    if (state === SAMPLING.off) setState(SAMPLING.degraded, 'starting powershell sampler')
    startWatchdog()
  }

  function runProbe() {
    return new Promise((resolvePromise) => {
      const finish = (exitError, stdout) => {
        if (exitError) {
          resolvePromise(null)
          return
        }
        resolvePromise(kind === 'macos' ? parseIoregIdle(stdout) : parseXprintidle(stdout))
      }
      if (kind === 'macos') {
        execFileFn('ioreg', ['-c', 'IOHIDSystem'], { timeout: seconds * 2000 }, finish)
      } else {
        execFileFn('xprintidle', [], { timeout: seconds * 2000 }, finish)
      }
    })
  }

  async function probeTick() {
    if (!active || probeBusy) return
    probeBusy = true
    try {
      const idleMs = await runProbe()
      if (!active) return
      if (idleMs !== null) sampleAccepted(idleMs)
      else scheduleProbeFailure('idle probe returned no usable value')
    } catch (error) {
      scheduleProbeFailure(error instanceof Error ? error.message : String(error))
    } finally {
      probeBusy = false
    }
  }

  function scheduleProbeFailure(reason) {
    attempts += 1
    if (attempts >= MAX_START_FAILURES) {
      setState(SAMPLING.off, `idle probe failed ${attempts} times: ${reason}`)
      if (probeTimer !== null) clearInterval(probeTimer)
      probeTimer = null
      return
    }
    setState(SAMPLING.degraded, reason)
  }

  function startProbes() {
    if (probeTimer !== null) clearInterval(probeTimer)
    void probeTick()
    probeTimer = setInterval(() => { void probeTick() }, seconds * 1000)
    probeTimer.unref?.()
  }

  return {
    state: () => state,
    detail: () => detail,
    lastIdleMs: () => lastIdleMs,
    sampleSeconds: () => seconds,
    start() {
      if (active) return
      active = true
      attempts = 0
      if (kind === 'unsupported') {
        setState(SAMPLING.off, `unsupported platform: ${platform}`)
        return
      }
      if (kind === 'windows') startWindowsChild()
      else startProbes()
    },
    stop() {
      active = false
      clearTimers()
      killChild('sampler stopped')
      // Teardown is expected, so it stays silent (no state-change callback).
      state = SAMPLING.off
      detail = 'sampler stopped'
    },
    /** Reconfigure the sample interval; a running sampler is restarted with the new cadence. */
    setSampleSeconds(next) {
      const normalized = Math.min(30, Math.max(3, Math.round(next)))
      if (normalized === seconds) return
      seconds = normalized
      if (!active) return
      clearTimers()
      killChild('sampler reconfigured')
      attempts = 0
      if (kind === 'windows') startWindowsChild()
      else startProbes()
    },
  }
}
