/**
 * dsh-deep-focus Host entry (v3): foreground-app usage sampler, tracker, limits/rest
 * state machine and HTTP API. No pomodoro blocks and no tool interception anywhere.
 */
import { createStorage, localDayKey, pluginDataDir } from './host/storage.js'
import { createSettingsStore } from './host/settings.js'
import { createSampler } from './host/sampler.js'
import { createTracker } from './host/tracker.js'
import { createLimits } from './host/limits.js'
import { createEventRing, createStatusMap, installHostEventListeners } from './host/events.js'
import { createApi, registerApi } from './host/api.js'

export const name = 'dsh-deep-focus'
export const inject = ['agents', 'webServer']

const LIMITS_INTERVAL_MS = 1000
const FLUSH_INTERVAL_MS = 10_000

export function apply(ctx) {
  let runtime
  try {
    runtime = createRuntime(ctx)
  } catch (error) {
    warn(ctx, 'failed to initialise; the plugin stays inactive', error)
    return
  }
  ctx.effect(() => runtime.start(), 'dsh-deep-focus: host runtime')
}

function warn(ctx, message, error) {
  try {
    const suffix = error === undefined ? '' : `: ${error instanceof Error ? error.message : String(error)}`
    ctx.logger?.warn?.(`[dsh-deep-focus] ${message}${suffix}`)
  } catch {
    // Logging must never break activation or cleanup.
  }
}

function createRuntime(ctx) {
  const now = () => Date.now()
  const storage = createStorage({ dir: pluginDataDir() })
  const settings = createSettingsStore({ storage })
  const ring = createEventRing({ now })
  const statusMap = createStatusMap()
  const tracker = createTracker({ storage, settings, now })
  const limits = createLimits({ storage, settings, tracker, ring, now })

  function onSample(sample, sampledAt) {
    // Resolve pause/rest state first, then decide whether this sample is counted:
    // paused and resting periods must never add active, app or continuous time.
    limits.evaluate(sampledAt)
    limits.applySample(sample, sampledAt)
    const counted = limits.isResting() === false && limits.isPaused() === false
    tracker.sample(sample, sampledAt, { counted })
    // The sample may have reached the continuous cap; enforce immediately.
    limits.evaluate(sampledAt)
  }

  let degradedLogged = false
  function onSamplerState(state, detail) {
    const suffix = detail ? ` (${detail})` : ''
    if (state === 'ok') {
      degradedLogged = false
      return
    }
    if (state === 'off') {
      warn(ctx, `foreground sampling is off; usage statistics will not advance${suffix}`)
      return
    }
    if (!degradedLogged) {
      degradedLogged = true
      warn(ctx, `foreground sampling is degraded${suffix}`)
    }
  }

  const sampler = createSampler({
    sampleSeconds: settings.get().usage.sampleSeconds,
    now,
    onSample,
    onStateChange: onSamplerState,
  })

  return {
    start() {
      let stopped = false
      const disposers = []
      const timers = []
      const api = createApi({
        settings,
        tracker,
        limits,
        sampler,
        ring,
        statusMap,
        agents: ctx.agents,
        storage,
        now,
        // Optional: lets /state recover a running session missed during a reload.
        getSessions: () => ctx.get('sessions'),
        onChange(next) {
          try {
            sampler.setSampleSeconds(next.usage.sampleSeconds)
            limits.setAssistantEnabled(next.assistant.enabled === true)
            limits.evaluate(now())
          } catch (error) {
            warn(ctx, 'settings change could not be applied live', error)
          }
        },
      })

      try {
        disposers.push(installHostEventListeners({ ctx, ring, statusMap }))
      } catch (error) {
        warn(ctx, 'event listeners could not be installed', error)
      }

      try {
        disposers.push(registerApi({ ctx, api }))
      } catch (error) {
        warn(ctx, 'HTTP API could not be registered', error)
      }

      // One-second enforcement tick: a rest window must end promptly even if the
      // sampler stalls, the daily cap should react without waiting for a sample,
      // and auto-pause uses the latest accepted idle value together with the time
      // it was sampled (an idle value older than the last resume must not re-pause).
      timers.push(setInterval(() => {
        try {
          limits.evaluate(now(), {
            idleMs: sampler.lastIdleMs(),
            sampleAt: sampler.lastSampleAt(),
          })
        } catch {
          // A single bad tick must not stop the timer loop.
        }
      }, LIMITS_INTERVAL_MS))
      timers.push(setInterval(() => {
        void tracker.flushIfDue()
      }, FLUSH_INTERVAL_MS))
      for (const timer of timers) timer.unref?.()

      const boot = (async () => {
        try {
          await settings.load()
          await tracker.load()
          await limits.load()
          if (stopped) return
          await storage.prune({
            retentionDays: settings.get().usage.retentionDays,
            dayKey: localDayKey(now()),
          }).catch(() => {})
          sampler.setSampleSeconds(settings.get().usage.sampleSeconds)
          sampler.start()
          limits.evaluate(now())
        } catch (error) {
          warn(ctx, 'initialisation failed; running with defaults', error)
        }
      })()

      return async () => {
        if (stopped) return
        stopped = true
        for (const timer of timers) clearInterval(timer)
        try {
          sampler.stop()
        } catch {
          // The child process may already be gone.
        }
        for (const dispose of disposers.splice(0).reverse()) {
          try {
            dispose()
          } catch (error) {
            warn(ctx, 'cleanup step failed', error)
          }
        }
        try {
          await Promise.all([tracker.flush(), limits.flush()])
          await storage.flush()
        } catch {
          // Losing a final flush is better than failing unload.
        }
        await boot.catch(() => {})
      }
    },
  }
}
