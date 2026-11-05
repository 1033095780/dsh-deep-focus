/**
 * Whole-machine foreground sampler: idle milliseconds plus the foreground application.
 * Windows streams lines from one long-lived PowerShell child; macOS/Linux probe
 * per interval (best effort). A missing foreground name never stops idle tracking.
 */
import { execFile, spawn as spawnChild } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SAMPLING = { ok: 'ok', degraded: 'degraded', off: 'off' }
const APPS_SAMPLING = { ok: 'ok', off: 'off' }
const WIN32_SCRIPT = fileURLToPath(new URL('./win32-idle.ps1', import.meta.url))

const UNAVAILABLE_IDLE = 0xff_ff_ff_ff
const MAX_BACKOFF_MS = 30_000
const MAX_START_FAILURES = 4
const STALE_INTERVALS = 3

function parseIdleToken(token) {
  if (typeof token !== 'string') return null
  const text = token.trim()
  if (text.length === 0 || !/^\d+$/.test(text)) return null
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 0 || value > UNAVAILABLE_IDLE) return null
  return value === UNAVAILABLE_IDLE ? null : value
}

/**
 * One stdout line from the Windows sampler -> `{idleMs, pid, app}`.
 * Format is `idleMs|pid|exeName`; older idle-only lines are still accepted so a
 * stale script cannot break usage tracking after an upgrade.
 */
export function parseSampleLine(line) {
  if (typeof line !== 'string') return null
  const text = line.trim()
  if (text.length === 0) return null
  const parts = text.split('|')
  const idleMs = parseIdleToken(parts[0])
  if (idleMs === null) return null
  const pidToken = parts.length > 1 ? parts[1].trim() : ''
  const parsedPid = /^\d+$/.test(pidToken) ? Number(pidToken) : 0
  const pid = Number.isSafeInteger(parsedPid) && parsedPid > 0 ? parsedPid : null
  const app = parts.length > 2 ? parts.slice(2).join('|').trim() : ''
  return { idleMs, pid, app: app.length > 0 ? app : null }
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
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** `xdotool getactivewindow getwindowpid` output -> pid, or null. */
export function parseXdotoolPid(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value > 0 ? value : null
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
 * Create the sampler. `start()`/`stop()` are idempotent; failures degrade and
 * never throw. `onSample` receives `{idleMs, pid, app}` where `app` may be null.
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
  let lastPid = null
  let lastApp = null
  let lastAppAt = null
  let attempts = 0
  let probeBusy = false
  let probeTimer = null
  let watchdogTimer = null
  let restartTimer = null
  let forceKillTimer = null

  function appWindowMs() {
    return Math.max(seconds * 3000, 20_000)
  }

  function setState(next, nextDetail) {
    const changed = state !== next || detail !== nextDetail
    state = next
    detail = nextDetail
    if (changed) onStateChange(state, detail)
  }

  function sampleAccepted(sample) {
    lastIdleMs = sample.idleMs
    lastPid = sample.pid ?? null
    lastSampleAt = now()
    if (typeof sample.app === 'string' && sample.app.length > 0) {
      lastApp = sample.app
      lastAppAt = now()
    }
    attempts = 0
    if (state !== SAMPLING.ok) setState(SAMPLING.ok, '')
    try {
      onSample({ idleMs: sample.idleMs, pid: lastPid, app: typeof sample.app === 'string' ? sample.app : null })
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
      const sample = parseSampleLine(line)
      if (sample !== null) sampleAccepted(sample)
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

  function execOnce(command, args) {
    return new Promise((resolvePromise) => {
      execFileFn(command, args, { timeout: seconds * 2000 }, (error, stdout) => {
        resolvePromise(error ? null : String(stdout))
      })
    })
  }

  async function readIdleOnce() {
    if (kind === 'macos') {
      const output = await execOnce('ioreg', ['-c', 'IOHIDSystem'])
      return output === null ? null : parseIoregIdle(output)
    }
    const output = await execOnce('xprintidle', [])
    return output === null ? null : parseXprintidle(output)
  }

  /** Foreground application name, best effort; null means "not available". */
  async function readForegroundOnce() {
    if (kind === 'macos') {
      const output = await execOnce('osascript', [
        '-e',
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ])
      const name = output === null ? '' : output.trim()
      return name.length > 0 ? name : null
    }
    const output = await execOnce('xdotool', ['getactivewindow', 'getwindowpid'])
    const pid = output === null ? null : parseXdotoolPid(output)
    if (pid === null) return null
    try {
      const comm = await fs.readFile(`/proc/${pid}/comm`, 'utf8')
      const name = comm.trim()
      return name.length > 0 ? name : null
    } catch {
      return null
    }
  }

  async function probeTick() {
    if (!active || probeBusy) return
    probeBusy = true
    try {
      const idleMs = await readIdleOnce()
      if (!active) return
      if (idleMs === null) {
        scheduleProbeFailure('idle probe returned no usable value')
        return
      }
      const app = await readForegroundOnce().catch(() => null)
      sampleAccepted({ idleMs, pid: null, app })
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
    appsState() {
      if (!active || state === SAMPLING.off || lastAppAt === null) return APPS_SAMPLING.off
      return now() - lastAppAt <= appWindowMs() ? APPS_SAMPLING.ok : APPS_SAMPLING.off
    },
    lastIdleMs: () => lastIdleMs,
    /** Host time of the latest accepted sample (`null` before the first one). */
    lastSampleAt: () => lastSampleAt,
    lastApp: () => lastApp,
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
