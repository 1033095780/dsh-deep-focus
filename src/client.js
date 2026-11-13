/**
 * dsh-deep-focus — client bundle v1.0.0 (single self-contained CJS factory).
 *
 * Product: a conversation task lock plus an optional DingTalk completion
 * notification.
 * - While a task is active a full-screen lock screen shows the locked
 *   conversation title, a one-second timer and a "skip" action.
 * - The sidebar page is a minimal DingTalk notification settings form
 *   (enable switch, write-only token field, save, send test message).
 * - No audio, no system notification APIs, no statistics, no timers besides one
 *   lightweight poll chain and the visible lock clock.
 *
 * Safety: the bundle never wraps a host service. On load it repairs leftovers
 * from older generations and, when the API is unreachable for three polls or
 * answers 404, it renders nothing instead of keeping the user locked.
 * Only `react` may be required.
 */
window.__ModuleLoader__.load({
  id: 'dsh-deep-focus',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const Fragment = React.Fragment

    /* ── Wire contract (v5) ────────────────────────────────────────────── */
    const API_BASE = '/plugins/dsh-deep-focus/api'
    const ROUTES = {
      state: API_BASE + '/state',
      settings: API_BASE + '/settings',
      skip: API_BASE + '/lock/skip',
      testNotify: API_BASE + '/notifications/test',
    }
    const POLL_LOCK_MS = 1000
    const POLL_IDLE_MS = 3000
    const POLL_HIDDEN_MS = 5000
    const FAILURE_HIDE_AFTER = 3
    const NS = 'deepFocus'
    const TOKEN_MAX = 256

    /* ── i18n ──────────────────────────────────────────────────────────── */
    const I18N = {
      zh: {
        'app.name': '会话锁',
        'app.subtitle': '会话锁定与钉钉完成提示',
        'lock.title': '任务进行中',
        'lock.body': '该对话全部完成后会自动解锁',
        'lock.elapsed': '已进行',
        'lock.skip': '跳过',
        'lock.skipping': '正在解锁…',
        'lock.skipFailed': '解锁失败，请重试',
        'lock.notifyOn': '完成后会发送钉钉通知',
        'lock.notifyOff': '未配置钉钉通知',
        'settings.title': '钉钉通知',
        'settings.desc': '任务完成并解锁后，通过钉钉机器人发送一条完成消息。',
        'settings.enable': '启用钉钉完成通知',
        'settings.token': 'Access token',
        'settings.token.placeholder': '粘贴机器人 access_token',
        'settings.token.kept': '已设置（尾号 {hint}）',
        'settings.token.empty': '未设置',
        'settings.token.clear': '清除',
        'settings.token.cleared': '保存后将清除已保存的 token',
        'settings.save': '保存',
        'settings.saving': '正在保存…',
        'settings.saved': '已保存',
        'settings.saveFailed': '保存失败，请重试',
        'settings.test': '发送测试消息',
        'settings.testing': '正在发送…',
        'settings.testSent': '测试消息已发送',
        'settings.testFailed': '测试消息发送失败',
        'settings.testDisabled': '请先填写 token 并启用通知',
        'settings.privacy': 'token 仅保存在本机 plugin-data，不会上传；消息以「[+] 」开头，只在会话完全完成解锁时发送。',
        'settings.unavailable': '通知服务暂不可用，请稍后再试。',
        'settings.enableHint': '关闭后不会发送任何消息。',
        'btn.retry': '重试',
      },
      en: {
        'app.name': 'Conversation lock',
        'app.subtitle': 'Conversation lock and DingTalk completion notice',
        'lock.title': 'Task in progress',
        'lock.body': 'It unlocks automatically when this conversation and its subagents finish',
        'lock.elapsed': 'Elapsed',
        'lock.skip': 'Skip',
        'lock.skipping': 'Unlocking…',
        'lock.skipFailed': 'Could not unlock. Try again.',
        'lock.notifyOn': 'A DingTalk message is sent on completion',
        'lock.notifyOff': 'DingTalk notice is not configured',
        'settings.title': 'DingTalk notification',
        'settings.desc': 'After the task finishes and unlocks, one completion message is sent through your DingTalk bot.',
        'settings.enable': 'Enable DingTalk completion notice',
        'settings.token': 'Access token',
        'settings.token.placeholder': 'Paste the bot access_token',
        'settings.token.kept': 'Saved (ends with {hint})',
        'settings.token.empty': 'Not set',
        'settings.token.clear': 'Clear',
        'settings.token.cleared': 'Saving will clear the saved token',
        'settings.save': 'Save',
        'settings.saving': 'Saving…',
        'settings.saved': 'Saved',
        'settings.saveFailed': 'Save failed. Try again.',
        'settings.test': 'Send test message',
        'settings.testing': 'Sending…',
        'settings.testSent': 'Test message sent',
        'settings.testFailed': 'Test message failed',
        'settings.testDisabled': 'Add a token and enable the notice first',
        'settings.privacy': 'The token stays on this machine in plugin-data and is never uploaded. Messages start with "[+] " and are sent only when a conversation fully finishes and unlocks.',
        'settings.unavailable': 'Notification service is temporarily unavailable.',
        'settings.enableHint': 'When off, no messages are sent.',
        'btn.retry': 'Retry',
      },
    }

    /* ── Helpers ───────────────────────────────────────────────────────── */
    function noop() {}

    function numberOr(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback
    }

    function clampNumber(value, min, max, fallback) {
      const numeric = numberOr(value, fallback)
      return Math.min(max, Math.max(min, numeric))
    }

    function formatElapsed(ms) {
      const total = Math.max(0, Math.floor(numberOr(ms, 0) / 1000))
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const seconds = total % 60
      const pad = function (value) {
        return String(value).padStart(2, '0')
      }
      if (hours > 0) return hours + ':' + pad(minutes) + ':' + pad(seconds)
      return pad(minutes) + ':' + pad(seconds)
    }

    function readLock(state) {
      const lock = state && state.lock && typeof state.lock === 'object' ? state.lock : null
      if (!lock || lock.active !== true) return null
      return lock
    }

    function readNotifications(state) {
      const settings = state && state.settings && typeof state.settings === 'object' ? state.settings : null
      const notifications = settings && settings.notifications && typeof settings.notifications === 'object'
        ? settings.notifications
        : {}
      return {
        dingtalkEnabled: notifications.dingtalkEnabled === true,
        dingtalkTokenSet: notifications.dingtalkTokenSet === true,
        dingtalkTokenHint: typeof notifications.dingtalkTokenHint === 'string' ? notifications.dingtalkTokenHint : '',
      }
    }

    function validState(data) {
      return Boolean(
        data &&
          typeof data === 'object' &&
          data.lock &&
          typeof data.lock === 'object' &&
          data.settings &&
          typeof data.settings === 'object',
      )
    }

    async function fetchJSON(path, options) {
      const init = Object.assign({ method: 'GET', credentials: 'same-origin', headers: {} }, options || {})
      if (init.body !== undefined && typeof init.body !== 'string') {
        init.headers = Object.assign({}, init.headers, { 'content-type': 'application/json' })
        init.body = JSON.stringify(init.body)
      }
      let response
      try {
        response = await fetch(path, init)
      } catch (error) {
        return { ok: false, status: 0, data: null, error: 'network' }
      }
      let data = null
      try {
        data = await response.json()
      } catch (error) {
        data = null
      }
      return { ok: Boolean(response.ok), status: response.status, data: data }
    }

    function succeeded(result) {
      if (!result || result.ok !== true) return false
      return !(result.data && result.data.ok === false)
    }

    function errorText(result) {
      const code = result && result.data && result.data.error && result.data.error.code
      return typeof code === 'string' && code.length > 0 ? code : ''
    }

    /* ── Theme styling (tokens only; no dynamic churn) ─────────────────── */
    const CSS_TEXT = [
      '.df-lock-layer{position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;background:color-mix(in srgb, var(--dsw-alias-bg-overlay, #000) 62%, transparent);backdrop-filter:blur(3px);pointer-events:auto;font-family:inherit;color:var(--dsw-alias-label-primary, #e5e7eb)}',
      '.df-lock-card{box-sizing:border-box;width:min(440px, calc(100vw - 32px));display:flex;flex-direction:column;gap:12px;padding:26px 28px;border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.35));border-radius:18px;background:var(--dsw-alias-bg-layer-1, #111827);box-shadow:0 24px 60px color-mix(in srgb, var(--dsw-alias-bg-overlay, #000) 55%, transparent);outline:none}',
      '.df-lock-title{font-size:19px;font-weight:600;margin:0;line-height:1.25}',
      '.df-lock-session{font-size:14px;margin:0;color:var(--dsw-alias-label-secondary, #94a3b8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.df-lock-clock{font-size:42px;font-weight:600;line-height:1.1;margin:4px 0 0;font-variant-numeric:tabular-nums;letter-spacing:1px}',
      '.df-lock-note{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-label-secondary, #94a3b8)}',
      '.df-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:6px}',
      '.df-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;height:34px;padding:0 16px;border-radius:9px;border-style:solid;border-width:1px;font:inherit;font-size:13px;line-height:1.2;cursor:pointer;appearance:none;webkit-appearance:none}',
      '.df-btn[disabled]{opacity:.55;cursor:default}',
      '.df-switch{width:42px;height:24px;padding:0;border-radius:999px;position:relative;cursor:pointer}',
      '.df-switch::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#ffffff;transition:left .14s ease}',
      '.df-switch[aria-checked="true"]::after{left:20px}',
      '.df-page{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;max-width:640px;padding:24px;color:var(--dsw-alias-label-primary, #e5e7eb);font-family:inherit}',
      '.df-page-title{font-size:21px;font-weight:600;margin:0}',
      '.df-page-sub{font-size:13px;line-height:1.5;margin:0;color:var(--dsw-alias-label-secondary, #94a3b8)}',
      '.df-section{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:18px 20px;border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.35));border-radius:14px;background:var(--dsw-alias-bg-layer-1, #111827)}',
      '.df-field{display:flex;flex-direction:column;gap:6px}',
      '.df-field-row{display:flex;align-items:center;justify-content:space-between;gap:12px}',
      '.df-field-label{font-size:13px;font-weight:600}',
      '.df-field-hint{font-size:12px;line-height:1.5;margin:0;color:var(--dsw-alias-label-secondary, #94a3b8)}',
      '.df-input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1, rgba(148,163,184,.35));background:var(--dsw-alias-bg-base, #0b1220);color:var(--dsw-alias-label-primary, #e5e7eb);font:inherit;font-size:13px;outline:none}',
      '.df-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #3b82f6);outline-offset:1px}',
      '.df-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
      '.df-hint{font-size:12px;line-height:1.6;margin:0;color:var(--dsw-alias-label-secondary, #94a3b8)}',
      '.df-error{font-size:12px;margin:0;color:var(--dsw-alias-state-error-primary, #f87171)}',
      '.df-ok{font-size:12px;margin:0;color:var(--dsw-alias-state-success-primary, #34d399)}',
    ].join('')

    function Styles() {
      return h('style', { 'data-df-styles': 'deep-focus' }, CSS_TEXT)
    }

    function primaryStyle(extra) {
      return Object.assign(
        {
          background: 'var(--dsw-alias-brand-primary, #3b82f6)',
          borderColor: 'var(--dsw-alias-brand-primary, #3b82f6)',
          color: '#ffffff',
          fontWeight: 600,
        },
        extra || {},
      )
    }

    function secondaryStyle(extra) {
      return Object.assign(
        {
          background: 'var(--dsw-alias-bg-layer-2, #1f2937)',
          borderColor: 'var(--dsw-alias-border-l1, rgba(148,163,184,.35))',
          color: 'var(--dsw-alias-label-primary, #e5e7eb)',
        },
        extra || {},
      )
    }

    /* ── Leftover repair from older generations ────────────────────────── */
    function repairLeftovers(ctx) {
      try {
        if (typeof document === 'undefined') return
        const nodes = document.querySelectorAll('style[data-dsh-focus-style],style[data-df-styles],style[data-dsh-focus-style]')
        for (let index = 0; index < nodes.length; index += 1) {
          const node = nodes[index]
          if (node && node.parentNode) node.parentNode.removeChild(node)
        }
        const marks = document.querySelectorAll('[data-dsh-focus-dimmed],[data-dsh-focus-orig-style]')
        for (let index = 0; index < marks.length; index += 1) {
          const row = marks[index]
          if (!row) continue
          const original = row.getAttribute('data-dsh-focus-orig-style')
          if (original !== null) row.setAttribute('style', original)
          else if (typeof row.removeAttribute === 'function') row.removeAttribute('style')
          row.removeAttribute('data-dsh-focus-dimmed')
          row.removeAttribute('data-dsh-focus-orig-style')
        }
        const root = document.documentElement
        if (root && root.attributes) {
          const names = []
          for (let index = 0; index < root.attributes.length; index += 1) {
            const name = root.attributes[index] && root.attributes[index].name
            if (typeof name === 'string' && name.indexOf('data-dsh-focus-') === 0) names.push(name)
          }
          names.forEach(function (name) {
            root.removeAttribute(name)
          })
        }
        const workspace = ctx && typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : null
        if (
          workspace &&
          typeof workspace.openSession === 'function' &&
          workspace.openSession.__dshDeepFocusWrapped === true &&
          typeof workspace.openSession.__dshDeepFocusOriginal === 'function'
        ) {
          workspace.openSession = workspace.openSession.__dshDeepFocusOriginal
        }
      } catch (error) {
        /* repair is best effort */
      }
    }

    /* ── Store: one timeout poll chain ─────────────────────────────────── */
    function createStore(ctx) {
      let snapshot = {
        status: 'boot', // boot | live | hidden | disabled
        state: null,
        receivedAt: 0,
        clockOffset: 0,
        failures: 0,
        skipBusy: false,
        skipError: '',
      }
      const listeners = new Set()
      let timer = 0
      let inFlight = false
      let destroyed = false
      let skippedSession = null

      function get() {
        return snapshot
      }

      function subscribe(listener) {
        listeners.add(listener)
        return function () {
          listeners.delete(listener)
        }
      }

      function emit() {
        listeners.forEach(function (listener) {
          try {
            listener()
          } catch (error) {
            /* ignored */
          }
        })
      }

      function visibleLock() {
        const lock = readLock(snapshot.state)
        if (!lock) return null
        if (skippedSession !== null && String(lock.sessionId || '') === String(skippedSession)) return null
        return lock
      }

      function delay() {
        try {
          if (typeof document !== 'undefined' && document.hidden) return POLL_HIDDEN_MS
        } catch (error) {
          /* ignored */
        }
        if (snapshot.status === 'live' && visibleLock()) return POLL_LOCK_MS
        if (snapshot.status === 'boot') return POLL_IDLE_MS
        return POLL_IDLE_MS
      }

      function schedule(ms) {
        if (destroyed) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(function () {
          timer = 0
          poll()
        }, ms)
      }

      async function poll() {
        if (destroyed || inFlight) return
        inFlight = true
        const result = await fetchJSON(ROUTES.state)
        inFlight = false
        if (destroyed) return

        if (result.status === 404) {
          snapshot = Object.assign({}, snapshot, { status: 'disabled', state: null, failures: 0 })
          skippedSession = null
          emit()
          schedule(POLL_HIDDEN_MS)
          return
        }

        if (!result.ok || !validState(result.data)) {
          const failures = snapshot.failures + 1
          snapshot = Object.assign({}, snapshot, {
            failures: failures,
            status: failures >= FAILURE_HIDE_AFTER ? 'hidden' : snapshot.status === 'boot' ? 'boot' : 'live',
          })
          emit()
          schedule(
            failures >= FAILURE_HIDE_AFTER ? POLL_HIDDEN_MS : visibleLock() ? POLL_LOCK_MS : POLL_IDLE_MS,
          )
          return
        }

        const data = result.data
        const clockOffset = typeof data.now === 'number' && Number.isFinite(data.now) ? Date.now() - data.now : 0
        const previousLock = readLock(snapshot.state)
        const nextLock = readLock(data)
        if (
          previousLock &&
          nextLock &&
          String(previousLock.sessionId || '') === String(nextLock.sessionId || '')
        ) {
          // same lock: keep the skip suppression for this session
        } else if (!nextLock) {
          skippedSession = null
        }
        snapshot = Object.assign({}, snapshot, {
          status: 'live',
          state: data,
          receivedAt: Date.now(),
          clockOffset: clockOffset,
          failures: 0,
          skipError: '',
        })
        emit()
        schedule(delay())
      }

      function start() {
        if (destroyed) return
        schedule(0)
      }

      function stop() {
        destroyed = true
        if (timer) clearTimeout(timer)
        timer = 0
        listeners.clear()
      }

      async function skip() {
        if (snapshot.skipBusy) return { ok: false }
        snapshot = Object.assign({}, snapshot, { skipBusy: true, skipError: '' })
        emit()
        const lock = visibleLock()
        const result = await fetchJSON(ROUTES.skip, { method: 'POST', body: {} })
        if (destroyed) return result
        if (succeeded(result)) {
          skippedSession = lock && lock.sessionId ? lock.sessionId : null
          snapshot = Object.assign({}, snapshot, {
            skipBusy: false,
            skipError: '',
            state: result.data && result.data.state && validState(result.data.state) ? result.data.state : snapshot.state,
          })
          emit()
          schedule(delay())
        } else {
          snapshot = Object.assign({}, snapshot, {
            skipBusy: false,
            skipError: errorText(result) || 'skip-failed',
          })
          emit()
        }
        return result
      }

      async function saveNotifications(patch) {
        const body = { settings: { version: 5, notifications: patch } }
        const result = await fetchJSON(ROUTES.settings, { method: 'POST', body: body })
        if (!destroyed && succeeded(result) && result.data && result.data.settings) {
          const nextState = snapshot.state
            ? Object.assign({}, snapshot.state, { settings: result.data.settings })
            : snapshot.state
          snapshot = Object.assign({}, snapshot, { state: nextState })
          emit()
        }
        return result
      }

      async function testNotification() {
        return fetchJSON(ROUTES.testNotify, { method: 'POST', body: {} })
      }

      return {
        get: get,
        subscribe: subscribe,
        start: start,
        stop: stop,
        skip: skip,
        saveNotifications: saveNotifications,
        testNotification: testNotification,
        visibleLock: visibleLock,
      }
    }

    /* ── Runtime ───────────────────────────────────────────────────────── */
    function createRuntime(ctx) {
      const locale = ctx && ctx.locale ? ctx.locale : null
      const translations = {}

      let bound = null
      function t(key, params) {
        try {
          if (!bound && locale && typeof locale.bind === 'function') bound = locale.bind(NS)
          const table = translations.zh || translations.en || {}
          const template = bound ? bound(key, params) : table[key] !== undefined ? table[key] : key
          if (!params) return String(template)
          return String(template).replace(/\{(\w+)\}/g, function (match, name) {
            return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
          })
        } catch (error) {
          return key
        }
      }

      function useLocaleTick() {
        const pair = React.useState(0)
        const force = pair[1]
        React.useEffect(function () {
          if (!locale || typeof locale.subscribe !== 'function') return undefined
          try {
            return locale.subscribe(function () {
              force(function (value) {
                return value + 1
              })
            })
          } catch (error) {
            return undefined
          }
        }, [])
      }

      function useStore(active) {
        const pair = React.useState(0)
        const force = pair[1]
        React.useEffect(function () {
          if (!active) return undefined
          return store.subscribe(function () {
            force(function (value) {
              return value + 1
            })
          })
        }, [active])
        return store.get()
      }

      const store = createStore(ctx)

      function LockOverlay() {
        useLocaleTick()
        const snapshot = useStore(true)
        const lock = store.visibleLock()
        const notifications = readNotifications(snapshot.state)

        const tickPair = React.useState(0)
        const forceTick = tickPair[1]
        const visible = Boolean(lock && snapshot.status === 'live')
        React.useEffect(
          function () {
            if (!visible) return undefined
            const timer = setInterval(function () {
              forceTick(function (value) {
                return value + 1
              })
            }, 1000)
            return function () {
              clearInterval(timer)
            }
          },
          [visible],
        )

        const cardRef = React.useRef(null)
        const skipRef = React.useRef(null)
        React.useEffect(
          function () {
            if (!visible) return undefined
            const card = cardRef.current
            if (card && typeof card.focus === 'function') {
              try {
                card.focus({ preventScroll: true })
              } catch (error) {
                /* ignored */
              }
            }
            return undefined
          },
          [visible],
        )

        if (!visible || !lock) return null

        const startedAt = numberOr(lock.startedAt, null)
        const baseElapsed = numberOr(lock.elapsedMs, 0)
        const elapsed =
          startedAt !== null
            ? Math.max(0, Date.now() - snapshot.clockOffset - startedAt)
            : Math.max(0, baseElapsed + Math.max(0, Date.now() - snapshot.receivedAt))
        const sessionTitle = typeof lock.title === 'string' && lock.title.trim().length > 0 ? lock.title.trim() : t('app.name')

        function onKeyDown(event) {
          if (!event || !event.key) return
          if (event.key === 'Tab') {
            event.preventDefault()
            const target = skipRef.current
            if (target && typeof target.focus === 'function') target.focus()
          }
        }

        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            {
              className: 'df-lock-layer',
              'data-dsh-deep-focus-root': 'lock',
              role: 'presentation',
              onKeyDown: onKeyDown,
            },
            h(
              'div',
              {
                className: 'df-lock-card',
                ref: cardRef,
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': t('lock.title'),
                tabIndex: -1,
              },
              h('h2', { className: 'df-lock-title' }, t('lock.title')),
              h('p', { className: 'df-lock-session', title: sessionTitle }, sessionTitle),
              h('p', { className: 'df-lock-clock', 'aria-label': t('lock.elapsed') + ' ' + formatElapsed(elapsed) }, formatElapsed(elapsed)),
              h('p', { className: 'df-lock-note' }, t('lock.body')),
              h(
                'p',
                { className: 'df-lock-note' },
                notifications.dingtalkEnabled && notifications.dingtalkTokenSet ? t('lock.notifyOn') : t('lock.notifyOff'),
              ),
              snapshot.skipError
                ? h('p', { className: 'df-error', role: 'alert' }, t('lock.skipFailed'))
                : null,
              h(
                'div',
                { className: 'df-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'df-btn',
                    style: secondaryStyle(),
                    disabled: snapshot.skipBusy,
                    onClick: function () {
                      store.skip()
                    },
                    ref: skipRef,
                    'data-df-autofocus': '',
                  },
                  snapshot.skipBusy ? t('lock.skipping') : t('lock.skip'),
                ),
              ),
            ),
          ),
        )
      }

      function AssistantIcon(props) {
        const size = clampNumber(props && props.size, 12, 32, 16)
        return h(
          'svg',
          { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
          h('rect', { x: 2.5, y: 6.5, width: 11, height: 7.5, rx: 1.8, stroke: 'currentColor', strokeWidth: 1.2 }),
          h('path', { d: 'M5.2 6.5V4.8a2.8 2.8 0 0 1 5.6 0v1.7', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
          h('circle', { cx: 8, cy: 10.2, r: 1.1, fill: 'currentColor' }),
        )
      }

      function AssistantPage() {
        useLocaleTick()
        const snapshot = useStore(true)
        const notifications = readNotifications(snapshot.state)
        const available = snapshot.status === 'live' && Boolean(snapshot.state)

        const enabledPair = React.useState(false)
        const enabled = enabledPair[0]
        const setEnabled = enabledPair[1]
        const tokenPair = React.useState('')
        const token = tokenPair[0]
        const setToken = tokenPair[1]
        const clearPair = React.useState(false)
        const clear = clearPair[0]
        const setClear = clearPair[1]
        const syncRef = React.useRef('')
        const statusPair = React.useState('idle') // idle | saving | saved | failed
        const status = statusPair[0]
        const setStatus = statusPair[1]
        const testPair = React.useState('idle') // idle | sending | sent | failed
        const testStatus = testPair[0]
        const setTestStatus = testPair[1]

        const serverSignature =
          (notifications.dingtalkEnabled ? '1' : '0') +
          '|' +
          (notifications.dingtalkTokenSet ? '1' : '0') +
          '|' +
          notifications.dingtalkTokenHint
        React.useEffect(
          function () {
            if (syncRef.current === serverSignature) return
            syncRef.current = serverSignature
            setEnabled(notifications.dingtalkEnabled)
            setToken('')
            setClear(false)
          },
          [serverSignature],
        )

        const canTest = available && notifications.dingtalkEnabled && notifications.dingtalkTokenSet

        async function save() {
          if (status === 'saving' || !available) return
          setStatus('saving')
          const patch = { dingtalkEnabled: enabled }
          if (clear) patch.dingtalkToken = null
          else if (token.trim().length > 0) patch.dingtalkToken = token.trim().slice(0, TOKEN_MAX)
          const result = await store.saveNotifications(patch)
          if (succeeded(result)) {
            setStatus('saved')
            setToken('')
            setClear(false)
          } else {
            setStatus('failed')
          }
        }

        async function sendTest() {
          if (!canTest || testStatus === 'sending') return
          setTestStatus('sending')
          const result = await store.testNotification()
          setTestStatus(succeeded(result) ? 'sent' : 'failed')
        }

        const tokenState = clear ? 'cleared' : notifications.dingtalkTokenSet ? 'kept' : 'empty'
        const placeholder =
          notifications.dingtalkTokenSet && !clear
            ? t('settings.token.kept', { hint: notifications.dingtalkTokenHint || '****' })
            : t('settings.token.placeholder')

        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            { className: 'df-page', 'data-dsh-deep-focus-root': 'settings' },
            h('h1', { className: 'df-page-title' }, t('settings.title')),
            h('p', { className: 'df-page-sub' }, t('settings.desc')),
            !available
              ? h('p', { className: 'df-error', role: 'status' }, t('settings.unavailable'))
              : null,
            h(
              'div',
              { className: 'df-section' },
              h(
                'div',
                { className: 'df-field-row' },
                h('span', { className: 'df-field-label' }, t('settings.enable')),
                h('button', {
                  type: 'button',
                  className: 'df-btn df-switch',
                  role: 'switch',
                  'aria-checked': enabled ? 'true' : 'false',
                  'aria-label': t('settings.enable'),
                  disabled: !available,
                  style: Object.assign(secondaryStyle(), {
                    background: enabled
                      ? 'var(--dsw-alias-brand-primary, #3b82f6)'
                      : 'var(--dsw-alias-bg-layer-2, #1f2937)',
                    borderColor: enabled
                      ? 'var(--dsw-alias-brand-primary, #3b82f6)'
                      : 'var(--dsw-alias-border-l1, rgba(148,163,184,.35))',
                  }),
                  onClick: function () {
                    setEnabled(!enabled)
                  },
                }),
              ),
              h('p', { className: 'df-field-hint' }, t('settings.enableHint')),
              h(
                'div',
                { className: 'df-field' },
                h('span', { className: 'df-field-label' }, t('settings.token')),
                h('input', {
                  className: 'df-input',
                  type: 'password',
                  autoComplete: 'off',
                  spellCheck: false,
                  value: token,
                  placeholder: placeholder,
                  disabled: !available || clear,
                  onChange: function (event) {
                    setToken(event && event.target ? event.target.value : '')
                    setStatus('idle')
                  },
                }),
                h(
                  'div',
                  { className: 'df-row' },
                  h(
                    'span',
                    { className: 'df-field-hint' },
                    tokenState === 'kept'
                      ? t('settings.token.kept', { hint: notifications.dingtalkTokenHint || '****' })
                      : tokenState === 'cleared'
                        ? t('settings.token.cleared')
                        : t('settings.token.empty'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'df-btn',
                      style: secondaryStyle({ height: '28px', padding: '0 10px', fontSize: '12px' }),
                      disabled: !available || !notifications.dingtalkTokenSet,
                      onClick: function () {
                        setClear(true)
                        setToken('')
                        setStatus('idle')
                      },
                    },
                    t('settings.token.clear'),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'df-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'df-btn',
                    style: secondaryStyle(),
                    disabled: !available || !canTest || testStatus === 'sending',
                    onClick: sendTest,
                  },
                  testStatus === 'sending' ? t('settings.testing') : t('settings.test'),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'df-btn',
                    style: primaryStyle(),
                    disabled: !available || status === 'saving',
                    onClick: save,
                  },
                  status === 'saving' ? t('settings.saving') : t('settings.save'),
                ),
              ),
              !canTest ? h('p', { className: 'df-field-hint' }, t('settings.testDisabled')) : null,
              status === 'saved' ? h('p', { className: 'df-ok', role: 'status' }, t('settings.saved')) : null,
              status === 'failed' ? h('p', { className: 'df-error', role: 'alert' }, t('settings.saveFailed')) : null,
              testStatus === 'sent' ? h('p', { className: 'df-ok', role: 'status' }, t('settings.testSent')) : null,
              testStatus === 'failed' ? h('p', { className: 'df-error', role: 'alert' }, t('settings.testFailed')) : null,
            ),
            h('p', { className: 'df-hint' }, t('settings.privacy')),
          ),
        )
      }

      function registerSlot(slots, name, options, Component) {
        return slots.register(Object.assign({ name: name }, options), Component)
      }

      function apply() {
        repairLeftovers(ctx)
        if (locale && typeof locale.register === 'function') {
          try {
            locale.register(NS, I18N)
          } catch (error) {
            /* locale may be optional */
          }
        }
        const slots = ctx && ctx.slots ? ctx.slots : null
        if (!slots) return
        const disposers = []
        function addSlot(name, options, Component) {
          try {
            const dispose = registerSlot(slots, name, options, Component)
            if (typeof dispose === 'function') disposers.push(dispose)
          } catch (error) {
            /* one slot must not break the others */
          }
        }
        addSlot('shell.overlay', { id: 'dsh-deep-focus-lock', order: 50 }, LockOverlay)
        addSlot(
          'sidebar.panellist',
          {
            id: 'focus-assistant',
            order: 10,
            label: function () {
              try {
                return t('app.name')
              } catch (error) {
                return 'Conversation lock'
              }
            },
          },
          AssistantIcon,
        )
        addSlot('main', { key: 'focus-assistant' }, AssistantPage)
        store.start()
        return function () {
          store.stop()
          repairLeftovers(ctx)
          for (let index = 0; index < disposers.length; index += 1) {
            try {
              disposers[index]()
            } catch (error) {
              /* ignored */
            }
          }
        }
      }

      return { t: t, apply: apply, store: store }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const runtime = createRuntime(ctx)
        const dispose = runtime.apply()
        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(function () {
            return function () {
              if (typeof dispose === 'function') dispose()
            }
          })
        }
      },
    }
  },
})
