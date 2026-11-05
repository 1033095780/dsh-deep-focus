/**
 * dsh-deep-focus — browser half v0.3 (single self-contained Client bundle).
 *
 * Pure-plugin "focus assistant": no pomodoro, no tool blocking, no passwords.
 * - sidebar hub page (usage overview + settings + on/off)
 * - top-right countdown chip (continuous use / forced rest / daily lock)
 * - DSH-only daily-overtime gray overlay with per-app breakdown + extend
 * - forced full-screen rest countdown
 * - solo session mode: temporarily hides other workspaces/sessions while a root
 *   conversation is running (one injected CSS rule, no inline host styles)
 *
 * Safety contract: this bundle never wraps or replaces a host service. On apply
 * it first repairs leftovers from a previously loaded generation (leaked
 * wrappers if they saved their original, inline dim marks, stale style nodes and
 * `data-dsh-focus-*` attributes). If the Host API is unreachable for two polls
 * or answers 404, every entry renders nothing and all DOM effects are torn down
 * synchronously.
 *
 * Loaded by the DSH web client as a lazy CJS closure factory. Only `react` may be
 * required; everything else is plain browser API.
 */
window.__ModuleLoader__.load({
  id: 'dsh-deep-focus',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const Fragment = React.Fragment

    /* ── Wire contract (v3) ───────────────────────────────────────────────
     * Small copy of src/shared/contract.js — keep routes, event kinds and
     * setting names in sync when the shared contract changes. */
    const API_BASE = '/plugins/dsh-deep-focus/api'
    const ROUTES = {
      state: API_BASE + '/state',
      apps: API_BASE + '/apps',
      settings: API_BASE + '/settings',
      assistant: API_BASE + '/assistant',
      pause: API_BASE + '/pause',
      resume: API_BASE + '/resume',
      restStart: API_BASE + '/rest/start',
      restFinish: API_BASE + '/rest/finish',
      extend: API_BASE + '/extend',
    }
    const EVENT = {
      taskCompleted: 'task-completed',
      paused: 'paused',
      resumed: 'resumed',
      restDue: 'rest-due',
      restStarted: 'rest-started',
      restFinished: 'rest-finished',
      dailyLocked: 'daily-locked',
      extended: 'extended',
      assistantOff: 'assistant-off',
      assistantOn: 'assistant-on',
    }
    const ACK_KEY_PREFIX = 'dsh-deep-focus.ack.'
    const POLL_VISIBLE_MS = 1000
    const POLL_HIDDEN_MS = 5000
    const QUIET_POLL_MS = 5000
    const CLOCK_TICK_MS = 500
    const TOAST_MS = 4200
    const MAX_TOP_APPS = 8
    const TREND_SEGMENTS = 5
    const DIM_STYLE_ATTR = 'data-dsh-focus-style'
    const SOLO_HTML_ATTR = 'data-dsh-focus-solo'

    /* ── i18n: every user-facing string lives here (zh + en) ───────────── */
    const NS = 'deepFocus'
    const I18N = {
      zh: {
        'rings.aria': '今日已用 {today}，连续 {continuous}',
        'rings.today': '今日',
        'rings.continuous': '连续',
        'rings.busy': '正在暂停…',
        'rings.summary': '今日 {today} / 连续 {continuous}',
        'pause.title': '已暂停计时',
        'pause.autoTitle': '已自动暂停计时',
        'veil.hint': '专注中：已切回正在运行的会话',
        'veil.aria': '专注模式：当前视图不是正在运行的会话',
        'veil.blocked': '先完成正在运行的任务再发送吧',
        'pause.hint': '动一下鼠标或键盘继续',
        'pause.aria': '计时已暂停，动一下鼠标或键盘继续',
        'rest.skip': '跳过休息',
        'rest.thenRestart': '已跳过休息，连续计时重新开始',
        'rest.doneWaiting': '休息完成 · 动一下鼠标键盘继续',
        'rest.waitingNote': '你回来并动一下键鼠后，本次休息才会结束。',
        'hub.title': '专注助手',
        'hub.subtitle': '使用统计、单会话与休息规则，都在这里。',
        'hub.assistant': '专注助手',
        'hub.on': '已启用',
        'hub.off': '已暂停（只统计，不限制）',
        'hub.enableHint': '暂停后只记录使用时长，不再隐藏会话或弹出提醒。',
        'hub.status.daily': '今日已用 {used} / {limit}',
        'hub.status.dailyUnlimited': '今日已用 {used} / 不限',
        'hub.status.continuous': '连续 {used} / {limit}',
        'hub.status.continuousOff': '连续计时已关闭',
        'hub.status.resting': '休息中 · {time}',
        'hub.status.rest': '未在休息',
        'hub.status.restDue': '连续使用接近上限',
        'hub.status.dailyLocked': '今日已用完 · 还可续期 {n} 次',
        'hub.status.dailyLockedNone': '今日已用完',
        'hub.status.offNote': '专注助手已暂停：只记录使用时长，不隐藏会话、不弹提醒。',
        'hub.section.overview': '概览',
        'hub.section.settings': '设置',
        'hub.dailyBar': '今日使用',
        'hub.continuousBar': '连续使用',
        'hub.restCard': '休息状态',
        'hub.restNow': '休息中',
        'hub.restAvailable': '无需休息，节奏不错',
        'hub.appsToday': '今日应用明细',
        'hub.noApps': '暂无应用数据。开启「按应用统计」后，这里会显示各应用用时。',
        'hub.trend': '最近 7 天',
        'hub.trendEmpty': '还没有足够的数据',
        'hub.loading': '正在加载使用数据…',
        'hub.refresh': '刷新',
        'hub.back': '返回对话',
        'hub.privacy': '只记录应用名和时长，不记录窗口标题；数据只保存在本机。',
        'hub.saved': '已保存',
        'hub.dirty': '有未保存的修改',
        'hub.save': '保存设置',
        'hub.discard': '放弃修改',
        'hub.saveFailed': '保存失败，请重试',
        'hub.invalid': '设置有误，未保存',
        'hub.offline': '插件服务暂不可用，正在重试…',
        'hub.todayAppsTotal': '今日应用合计 {time}',
        'group.limits': '使用限制',
        'group.alerts': '提示与统计',
        'group.focus': '专注与会话',
        'field.soloSession': '专注时只允许一个对话',
        'field.dailyMinutes': '每日使用上限',
        'field.dailyMinutes.hint': '分钟，0 = 不限',
        'field.continuousMinutes': '连续使用上限',
        'field.continuousMinutes.hint': '分钟，0 = 关闭',
        'field.restMinutes': '单次休息时长',
        'field.restMinutes.hint': '分钟',
        'field.extendMinutes': '每次续期时长',
        'field.extendMinutes.hint': '分钟',
        'field.sound': '提示音',
        'field.autoPauseSeconds': '空闲自动休息',
        'field.autoPauseSeconds.hint': '秒，0 = 关闭',
        'field.trackApps': '按应用统计使用时长',
        'field.trackApps.hint': '记录前台应用的名称与时长',
        'settings.preview': '试听',
        'settings.hintZeroUnlimited': '0 = 不限',
        'settings.loading': '正在加载…',
        'settings.appsSampling.off': '应用统计当前不可用（可能因为长时间空闲或未开启按应用统计）。',
        'daily.title': '今日使用已用完',
        'daily.reason': '达到每日使用上限了。',
        'daily.notify': '今日使用已超时 · 点击回到 DeepSeek',
        'daily.apps': '应用明细',
        'daily.extend': '再使用 {n} 分钟',
        'daily.extendRemaining': '今日还可续期 {n} 次',
        'daily.extendNone': '今日续期次数已用完',
        'daily.skip': '跳过',
        'daily.skipHint': '仅隐藏今日提醒（best effort），不影响统计与限制。',
        'daily.error': '操作失败，请稍后重试',
        'today.total': '今日总计',
        'rest.title': '休息中',
        'rest.body': '深呼吸，站起来走走，看看远处。',
        'rest.auto': '休息结束后会自动恢复。',
        'rest.aria': '休息倒计时 {time}',
        'toast.taskCompleted': '对话完成',
        'toast.gentleSwitch': '当前任务完成后再切换吧',
        'toast.taskCompletedTask': '对话完成：{task}',
        'time.hm': '{h} 小时 {m} 分',
        'time.m': '{m} 分钟',
        'error.extendLimit': '今日续期次数已用完',
        'app.browser': '浏览器',
        'app.qq': 'QQ',
        'app.wechat': '微信',
        'app.vscode': 'VS Code',
        'app.cursor': 'Cursor',
        'app.dsh': 'DeepSeek Harness',
        'app.terminal': '终端',
        'app.explorer': '资源管理器',
        'app.notion': 'Notion',
        'app.feishu': '飞书',
        'app.dingtalk': '钉钉',
        'app.spotify': 'Spotify',
        'app.bilibili': '哔哩哔哩',
        'app.vlc': 'VLC',
        'stats.unknownApp': '未知应用',
        'wd.0': '周日',
        'wd.1': '周一',
        'wd.2': '周二',
        'wd.3': '周三',
        'wd.4': '周四',
        'wd.5': '周五',
        'wd.6': '周六',
      },
      en: {
        'rings.aria': 'Used {today} today, continuous {continuous}',
        'rings.today': 'Today',
        'rings.continuous': 'Continuous',
        'rings.busy': 'Pausing…',
        'rings.summary': '{today} today / {continuous} continuous',
        'pause.title': 'Tracking paused',
        'pause.autoTitle': 'Tracking auto-paused',
        'veil.hint': 'Focus mode: switched back to the running conversation',
        'veil.aria': 'Focus mode: the current view is not the running conversation',
        'veil.blocked': 'Finish the running task before sending',
        'pause.hint': 'Move the mouse or press a key to continue',
        'pause.aria': 'Tracking is paused. Move the mouse or press a key to continue.',
        'rest.skip': 'Skip rest',
        'rest.thenRestart': 'Rest skipped — the continuous timer starts over',
        'rest.doneWaiting': 'Rest done · move the mouse or press a key to continue',
        'rest.waitingNote': 'This rest ends once you are back and move the mouse or keyboard.',
        'hub.title': 'Focus assistant',
        'hub.subtitle': 'Usage stats, one-conversation mode, and rest rules — all here.',
        'hub.assistant': 'Focus assistant',
        'hub.on': 'Enabled',
        'hub.off': 'Paused (stats only)',
        'hub.enableHint': 'While paused it only records usage: no hiding, no reminders.',
        'hub.status.daily': 'Used {used} / {limit} today',
        'hub.status.dailyUnlimited': 'Used {used} today / unlimited',
        'hub.status.continuous': 'Continuous {used} / {limit}',
        'hub.status.continuousOff': 'Continuous timer is off',
        'hub.status.resting': 'Resting · {time}',
        'hub.status.rest': 'Not resting',
        'hub.status.restDue': 'Continuous use is near the limit',
        'hub.status.dailyLocked': 'Daily limit reached · {n} extend(s) left',
        'hub.status.dailyLockedNone': 'Daily limit reached',
        'hub.status.offNote': 'Assistant paused: it only records usage — no hiding, no reminders.',
        'hub.section.overview': 'Overview',
        'hub.section.settings': 'Settings',
        'hub.dailyBar': 'Today',
        'hub.continuousBar': 'Continuous',
        'hub.restCard': 'Rest status',
        'hub.restNow': 'Resting',
        'hub.restAvailable': 'No rest needed — nice pace',
        'hub.appsToday': "Today's app breakdown",
        'hub.noApps': 'No app data yet. Enable per-app tracking in Settings to see it here.',
        'hub.trend': 'Last 7 days',
        'hub.trendEmpty': 'Not enough data yet',
        'hub.loading': 'Loading usage data…',
        'hub.refresh': 'Refresh',
        'hub.back': 'Back to chat',
        'hub.privacy': 'Only app names and durations are recorded — never window titles. Data stays on this machine.',
        'hub.saved': 'Saved',
        'hub.dirty': 'Unsaved changes',
        'hub.save': 'Save settings',
        'hub.discard': 'Discard changes',
        'hub.saveFailed': 'Save failed — try again',
        'hub.invalid': 'Invalid settings — not saved',
        'hub.offline': 'Plugin service unavailable — retrying…',
        'hub.todayAppsTotal': 'App time today {time}',
        'group.limits': 'Usage limits',
        'group.alerts': 'Alerts & tracking',
        'group.focus': 'Focus & sessions',
        'field.soloSession': 'Allow only one conversation in focus mode',
        'field.dailyMinutes': 'Daily usage limit',
        'field.dailyMinutes.hint': 'minutes, 0 = unlimited',
        'field.continuousMinutes': 'Continuous-use limit',
        'field.continuousMinutes.hint': 'minutes, 0 = off',
        'field.restMinutes': 'Rest length',
        'field.restMinutes.hint': 'minutes',
        'field.extendMinutes': 'Extension length',
        'field.extendMinutes.hint': 'minutes',
        'field.sound': 'Sound',
        'field.autoPauseSeconds': 'Auto-rest after idle',
        'field.autoPauseSeconds.hint': 'seconds, 0 = off',
        'field.trackApps': 'Track per-app usage',
        'field.trackApps.hint': 'records the foreground app name and duration',
        'settings.preview': 'Preview',
        'settings.hintZeroUnlimited': '0 = unlimited',
        'settings.loading': 'Loading…',
        'settings.appsSampling.off': 'App tracking is currently unavailable (long idle or disabled).',
        'daily.title': 'Daily usage is used up',
        'daily.reason': 'The daily usage limit has been reached.',
        'daily.notify': 'Daily limit reached · click to return to DeepSeek',
        'daily.apps': 'App breakdown',
        'daily.extend': 'Use {n} more minutes',
        'daily.extendRemaining': '{n} extension(s) left today',
        'daily.extendNone': 'No extensions left today',
        'daily.skip': 'Skip',
        'daily.skipHint': 'Only hides this reminder for today (best effort); tracking and limits are unchanged.',
        'daily.error': 'Something went wrong — try again shortly',
        'today.total': 'Total today',
        'rest.title': 'Resting',
        'rest.body': 'Breathe slowly, stand up, and look into the distance.',
        'rest.auto': 'It clears automatically when the rest ends.',
        'rest.aria': 'Rest countdown {time}',
        'toast.taskCompleted': 'Conversation finished',
        'toast.gentleSwitch': "Finish the current task before switching \u2014 you've got this.",
        'toast.taskCompletedTask': 'Finished: {task}',
        'time.hm': '{h}h {m}m',
        'time.m': '{m}m',
        'error.extendLimit': 'No extensions left today',
        'app.browser': 'Browser',
        'app.qq': 'QQ',
        'app.wechat': 'WeChat',
        'app.vscode': 'VS Code',
        'app.cursor': 'Cursor',
        'app.dsh': 'DeepSeek Harness',
        'app.terminal': 'Terminal',
        'app.explorer': 'File Explorer',
        'app.notion': 'Notion',
        'app.feishu': 'Feishu',
        'app.dingtalk': 'DingTalk',
        'app.spotify': 'Spotify',
        'app.bilibili': 'Bilibili',
        'app.vlc': 'VLC',
        'stats.unknownApp': 'Unknown app',
        'wd.0': 'Sun',
        'wd.1': 'Mon',
        'wd.2': 'Tue',
        'wd.3': 'Wed',
        'wd.4': 'Thu',
        'wd.5': 'Fri',
        'wd.6': 'Sat',
      },
    }

    /* Known executable ids -> localized display names (Host names are zh-only). */
    const APP_NAME_KEYS = {
      chrome: 'app.browser',
      'google chrome': 'app.browser',
      msedge: 'app.browser',
      'microsoft edge': 'app.browser',
      firefox: 'app.browser',
      safari: 'app.browser',
      qq: 'app.qq',
      wechat: 'app.wechat',
      wechatappex: 'app.wechat',
      weixin: 'app.wechat',
      code: 'app.vscode',
      cursor: 'app.cursor',
      'deepseek harness': 'app.dsh',
      windowsterminal: 'app.terminal',
      pwsh: 'app.terminal',
      powershell: 'app.terminal',
      explorer: 'app.explorer',
      notion: 'app.notion',
      feishu: 'app.feishu',
      lark: 'app.feishu',
      dingtalk: 'app.dingtalk',
      spotify: 'app.spotify',
      bilibili: 'app.bilibili',
      vlc: 'app.vlc',
    }

    /* ── Pure helpers ──────────────────────────────────────────────────── */

    function pad2(value) {
      return value < 10 ? '0' + value : String(value)
    }

    function numberOr(value, fallback) {
      return typeof value === 'number' && Number.isFinite(value) ? value : fallback
    }

    function clampNumber(value, min, max, fallback) {
      const n = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(n)) return fallback
      return Math.min(max, Math.max(min, Math.round(n)))
    }

    function deepClone(value) {
      try {
        return JSON.parse(JSON.stringify(value))
      } catch (error) {
        return value
      }
    }

    function interpolate(template, params) {
      if (!params) return template
      return String(template).replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
      )
    }

    /** mm:ss (or h:mm:ss above an hour) for countdowns and continuous timers. */
    function fmtClock(ms) {
      const totalSeconds = Math.max(0, Math.ceil(numberOr(ms, 0) / 1000))
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      if (hours > 0) return hours + ':' + pad2(minutes) + ':' + pad2(seconds)
      return pad2(minutes) + ':' + pad2(seconds)
    }

    /** mm:ss (or h:mm:ss above an hour) for durations. */
    function fmtAppTime(ms) {
      return fmtClock(ms)
    }

    /** Human duration, localized through `t`. */
    function fmtDuration(t, ms) {
      const value = Math.max(0, numberOr(ms, 0))
      const hours = Math.floor(value / 3600000)
      const minutes = Math.floor((value % 3600000) / 60000)
      if (hours > 0) return t('time.hm', { h: hours, m: minutes })
      return t('time.m', { m: minutes })
    }

    /** Accepts epoch ms, epoch seconds, or an ISO timestamp. */
    function toTimestamp(value) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value > 1e12 ? value : value * 1000
      }
      if (typeof value === 'string' && value) {
        const parsed = Date.parse(value)
        if (Number.isFinite(parsed)) return parsed
      }
      return null
    }

    /** "HH:MM" (or minutes-since-midnight) -> minutes; null when unparseable. */
    function parseClock(value) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.min(1439, Math.max(0, Math.round(value)))
      }
      if (typeof value !== 'string') return null
      const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
      if (!match) return null
      const hours = Number(match[1])
      const minutes = Number(match[2])
      if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
      if (hours > 23 || minutes > 59) return null
      return hours * 60 + minutes
    }

    /** Local quiet-hours check, including overnight windows. */
    function isQuietHours(alerts) {
      if (!alerts) return false
      const start = parseClock(alerts.quietHoursStart)
      const end = parseClock(alerts.quietHoursEnd)
      if (start === null || end === null || start === end) return false
      const now = new Date()
      const current = now.getHours() * 60 + now.getMinutes()
      return start < end ? current >= start && current < end : current >= start || current < end
    }

    /** Remaining forced-rest time from the authoritative state. */
    function restRemainingMs(limit, clockOffset) {
      if (!limit || limit.resting !== true) return 0
      const until = toTimestamp(limit.restUntil)
      if (until !== null) return Math.max(0, until - (Date.now() - numberOr(clockOffset, 0)))
      return Math.max(0, numberOr(limit.restRemainingMs, 0))
    }

    function progressRatio(used, limit) {
      const usedValue = Math.max(0, numberOr(used, 0))
      const limitValue = Math.max(0, numberOr(limit, 0))
      if (limitValue <= 0) return 0
      return Math.min(1, usedValue / limitValue)
    }

    function extendRemaining(limit) {
      if (!limit) return 0
      const limitValue = Math.max(0, numberOr(limit.extendLimit, 0))
      const used = Math.max(0, numberOr(limit.extendCountToday, 0))
      return Math.max(0, limitValue - used)
    }

    function assistantActive(state) {
      if (!state || !state.limit || !state.settings) return false
      if (state.limit.assistantEnabled === false) return false
      const assistant = state.settings.assistant || {}
      return assistant.enabled !== false
    }

    /* App usage normalizers keep the UI resilient if the Host evolves. */

    function normalizeAppRow(raw) {
      if (raw === null || typeof raw !== 'object') return null
      const id = typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : ''
      const fallbackName = typeof raw.name === 'string' ? raw.name.trim() : ''
      const ms = Math.max(0, numberOr(raw.ms, numberOr(raw.activeMs, numberOr(raw.durationMs, 0))))
      if (id.length === 0 && fallbackName.length === 0) return null
      if (ms <= 0) return null
      return { id: id.length > 0 ? id : fallbackName.toLowerCase(), name: fallbackName, ms: Math.round(ms) }
    }

    function normalizeAppRows(list, limit) {
      if (!Array.isArray(list)) return []
      const rows = []
      for (let index = 0; index < list.length; index += 1) {
        const row = normalizeAppRow(list[index])
        if (row !== null) rows.push(row)
      }
      rows.sort(function (left, right) {
        return right.ms - left.ms || left.id.localeCompare(right.id)
      })
      return limit > 0 ? rows.slice(0, limit) : rows
    }

    function todayAppsFromState(state) {
      if (!state || typeof state.appsToday !== 'object' || state.appsToday === null) return []
      return normalizeAppRows(state.appsToday.top, MAX_TOP_APPS)
    }

    function todayAppsTotal(state) {
      if (!state) return 0
      const direct = numberOr(state.appsToday && state.appsToday.totalMs, -1)
      if (direct >= 0) return direct
      return todayAppsFromState(state).reduce(function (sum, row) {
        return sum + row.ms
      }, 0)
    }

    /** Normalize GET /apps into `{ days:[{day, activeMs, apps}], top, retentionDays }`. */
    function normalizeAppsTrend(payload) {
      if (payload === null || typeof payload !== 'object') return null
      const trend = { days: [], top: normalizeAppRows(payload.top, 0), retentionDays: numberOr(payload.retentionDays, 0) }
      const rawDays = Array.isArray(payload.days) ? payload.days : []
      for (let index = 0; index < rawDays.length; index += 1) {
        const entry = rawDays[index]
        if (entry === null || typeof entry !== 'object') continue
        const day = typeof entry.day === 'string' ? entry.day : ''
        if (day.length === 0) continue
        const apps = normalizeAppRows(entry.apps, 0)
        const activeMs = Math.max(
          0,
          numberOr(
            entry.activeMs,
            numberOr(
              entry.totalMs,
              apps.reduce(function (sum, row) {
                return sum + row.ms
              }, 0),
            ),
          ),
        )
        trend.days.push({ day: day, activeMs: Math.round(activeMs), apps: apps })
      }
      return trend
    }

    /* ── Same-origin JSON transport ────────────────────────────────────── */

    async function fetchJSON(url, options) {
      const init = Object.assign({ cache: 'no-store', credentials: 'same-origin' }, options || {})
      if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
        init.body = JSON.stringify(init.body)
        init.headers = Object.assign({ 'content-type': 'application/json' }, init.headers || {})
      }
      try {
        const response = await fetch(url, init)
        let data = null
        try {
          data = await response.json()
        } catch (error) {
          data = null
        }
        const ok = response.ok && !(data && data.ok === false)
        return { ok: ok, status: response.status, data: data }
      } catch (error) {
        return { ok: false, status: 0, data: null }
      }
    }

    /* ── Web Audio chime (zero assets, fails silently) ─────────────────── */

    function createAudio() {
      let audioContext = null

      function ensureContext() {
        if (audioContext) return audioContext
        const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
        if (!Ctor) return null
        try {
          audioContext = new Ctor()
        } catch (error) {
          audioContext = null
        }
        return audioContext
      }

      function unlock() {
        const context = ensureContext()
        if (!context) return
        try {
          if (context.state === 'suspended') context.resume().catch(function () {})
        } catch (error) {
          /* ignored */
        }
      }

      /** Two-tone ascending chime; respects volume, never throws. */
      function chime(volume) {
        const level = Math.min(1, Math.max(0, numberOr(volume, 0.6)))
        if (level <= 0) return
        const context = ensureContext()
        if (!context) return
        try {
          if (context.state === 'suspended') context.resume().catch(function () {})
          const startAt = context.currentTime + 0.01
          const notes = [880, 1318.5]
          for (let i = 0; i < notes.length; i += 1) {
            const oscillator = context.createOscillator()
            const gain = context.createGain()
            oscillator.type = 'sine'
            oscillator.frequency.value = notes[i]
            const noteStart = startAt + i * 0.16
            const noteEnd = noteStart + 0.22
            gain.gain.setValueAtTime(0.0001, noteStart)
            gain.gain.linearRampToValueAtTime(level * 0.22, noteStart + 0.02)
            gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd)
            oscillator.connect(gain)
            gain.connect(context.destination)
            oscillator.start(noteStart)
            oscillator.stop(noteEnd + 0.02)
          }
        } catch (error) {
          /* audio is optional */
        }
      }

      return { unlock: unlock, chime: chime }
    }

    /* ── Previous-generation self-heal ────────────────────────────────── */

    /** Restore every element a previous generation marked as dimmed. */
    function restoreLegacyDimMarks() {
      try {
        const marked = document.querySelectorAll('[data-dsh-focus-dimmed]')
        for (let index = 0; index < marked.length; index += 1) {
          const element = marked[index]
          const original = element.getAttribute('data-dsh-focus-orig-style')
          try {
            if (original === null || original === '__none__') element.removeAttribute('style')
            else element.setAttribute('style', original)
          } catch (error) {
            /* ignored */
          }
          try {
            element.removeAttribute('data-dsh-focus-dimmed')
            element.removeAttribute('data-dsh-focus-orig-style')
          } catch (error) {
            /* ignored */
          }
        }
      } catch (error) {
        /* ignored */
      }
    }

    /** Undo anything a crashed/disabled previous bundle may have left behind. */
    function selfHealPreviousGeneration(ctx) {
      // 1) A legacy openSession wrapper is only restorable when it saved its original.
      try {
        const workspace = ctx && typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
        if (workspace && typeof workspace.openSession === 'function') {
          const wrapped = workspace.openSession
          if (wrapped.__dshDeepFocusWrapped === true && typeof wrapped.__dshDeepFocusOriginal === 'function') {
            workspace.openSession = wrapped.__dshDeepFocusOriginal
          }
        }
      } catch (error) {
        /* optional service */
      }
      // 2) Restore rows a legacy bundle dimmed with inline styles.
      restoreLegacyDimMarks()
      // 3) Remove leftover plugin style nodes from any generation.
      try {
        const styleNodes = document.querySelectorAll('style[data-dsh-focus-style],style[data-df-styles]')
        for (let index = 0; index < styleNodes.length; index += 1) {
          const node = styleNodes[index]
          if (node && node.parentNode && typeof node.parentNode.removeChild === 'function') {
            node.parentNode.removeChild(node)
          }
        }
      } catch (error) {
        /* ignored */
      }
      // 4) Strip leftover `data-dsh-focus-*` attributes from <html>.
      try {
        const root = document.documentElement
        if (root && root.attributes) {
          const names = []
          for (let index = 0; index < root.attributes.length; index += 1) {
            const name = root.attributes[index] && root.attributes[index].name
            if (typeof name === 'string' && name.indexOf('data-dsh-focus-') === 0) names.push(name)
          }
          names.forEach(function (name) {
            try {
              root.removeAttribute(name)
            } catch (error) {
              /* ignored */
            }
          })
        }
      } catch (error) {
        /* ignored */
      }
    }

    /* ── Scoped styles (rendered as <style> React elements) ────────────── */

    const CSS_TEXT = [
      '[data-df-root]{box-sizing:border-box;font-family:inherit}',
      /* countdown chip in the conversation header */
      '.df-icon{display:block;flex:0 0 auto}',
      /* overlays */
      '.df-overlay{position:absolute;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;background:var(--dsw-alias-bg-overlay);background:color-mix(in srgb, var(--dsw-alias-bg-overlay) 84%, transparent);backdrop-filter:blur(6px);pointer-events:auto}',
      '.df-card{width:460px;max-width:100%;max-height:100%;overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;padding:24px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.5;box-shadow:0 24px 60px color-mix(in srgb, var(--dsw-alias-bg-overlay) 78%, transparent)}',
      '.df-overlay-title{font-size:19px;font-weight:600;margin:0}',
      '.df-app-row{display:grid;grid-template-columns:minmax(88px,150px) minmax(0,1fr) auto;gap:10px;align-items:center;font-size:13px;min-width:0}',
      '.df-app-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
      '.df-app-bar{position:relative;height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;min-width:0}',
      '.df-app-bar-fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;background:var(--dsw-alias-brand-primary)}',
      '.df-app-time{min-width:52px;text-align:right;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}',
      '.df-divider{height:1px;border:0;margin:0;background:var(--dsw-alias-border-l2)}',
      '[data-df-root] .df-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.2;text-decoration:none;appearance:none;-webkit-appearance:none;cursor:pointer;transition:opacity .15s ease}',
      '[data-df-root] .df-btn:hover:not([disabled]){opacity:.85}',
      '[data-df-root] .df-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '[data-df-root] .df-btn[disabled]{opacity:.5;cursor:default}',
      '[data-df-root] .df-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}',
      '[data-df-root] .df-btn-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}',
      '[data-df-root] .df-btn-ghost:hover:not([disabled]){background:var(--dsw-alias-bg-layer-2);opacity:1}',
      '[data-df-root] .df-btn-sm{height:28px;padding:0 10px;font-size:12px}',
      '.df-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
      '.df-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:0}',
      '.df-muted{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0}',
      /* forced rest screen */
      '.df-rest{position:absolute;inset:0;z-index:130;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;background:var(--dsw-alias-bg-base);background:color-mix(in srgb, var(--dsw-alias-bg-base) 97%, var(--dsw-alias-state-success-primary));pointer-events:auto}',
      '.df-rest-time{font-size:56px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:1px;margin:0;color:var(--dsw-alias-state-success-primary)}',
      '.df-rest-body{color:var(--dsw-alias-label-secondary);font-size:14px;margin:0}',
      '.df-rings-layer{position:absolute;top:min(calc(var(--dsh-frame-top-clearance, 0px) + 96px), calc(100% - 150px));right:16px;z-index:75;display:flex;flex-direction:column;align-items:flex-end;gap:6px;pointer-events:none}',
      '@media (max-height: 540px){.df-rings-layer{top:calc(var(--dsh-frame-top-clearance, 0px) + 56px)}}',
      '.df-rings{position:static;display:flex;align-items:center;gap:10px;box-sizing:border-box;padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:color-mix(in srgb, var(--dsw-alias-bg-layer-1) 88%, transparent);backdrop-filter:blur(8px);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:11px;line-height:1.2;cursor:default;pointer-events:auto;box-shadow:0 8px 24px color-mix(in srgb, var(--dsw-alias-bg-overlay) 40%, transparent)}',
      '.df-rings:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.df-rings[data-busy="true"]{opacity:.7;cursor:default}',
      '.df-rings[data-paused="true"]{border-color:var(--dsw-alias-state-warn-primary)}',
      '.df-ring{position:relative;width:34px;height:34px;flex:0 0 auto}',
      '.df-ring svg{display:block;width:34px;height:34px;transform:rotate(-90deg)}',
      '.df-ring-track{stroke:var(--dsw-alias-border-l1);fill:none}',
      '.df-ring-value{fill:none;stroke-linecap:round;transition:stroke-dashoffset .3s ease}',
      '.df-ring[data-kind="daily"] .df-ring-value{stroke:var(--dsw-alias-brand-primary)}',
      '.df-ring[data-kind="continuous"] .df-ring-value{stroke:var(--dsw-alias-state-success-primary)}',
      '.df-ring[data-tone="warn"] .df-ring-value{stroke:var(--dsw-alias-state-warn-primary)}',
      '.df-ring[data-tone="danger"] .df-ring-value{stroke:var(--dsw-alias-state-error-primary)}',
      '.df-rings-text{display:flex;flex-direction:column;gap:1px;white-space:nowrap;max-width:150px}',
      '.df-rings-text b{font-weight:600;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}',
      '.df-rings-text span{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}',
      '.df-veil-layer{position:absolute;inset:0;z-index:116;pointer-events:none}',
      '.df-veil{position:absolute;top:0;right:0;bottom:0;left:0;background:color-mix(in srgb, var(--dsw-alias-bg-overlay) 16%, transparent);backdrop-filter:grayscale(.35);pointer-events:none}',
      '.df-veil-hint{position:absolute;top:calc(var(--dsh-frame-top-clearance, 0px) + 64px);left:50%;transform:translateX(-50%);box-sizing:border-box;max-width:calc(100vw - 32px);padding:6px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;box-shadow:0 6px 18px color-mix(in srgb, var(--dsw-alias-bg-overlay) 40%, transparent)}',
      /* toasts */
      '.df-toasts{position:absolute;top:var(--dsh-frame-overlay-top,56px);right:16px;z-index:60;display:flex;flex-direction:column;gap:8px;max-width:340px;pointer-events:none}',
      '.df-toast{box-sizing:border-box;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:1.45;box-shadow:0 8px 24px color-mix(in srgb, var(--dsw-alias-bg-overlay) 55%, transparent);animation:df-toast-in .18s ease-out}',
      '.df-toast[data-kind="task-completed"]{border-color:var(--dsw-alias-state-success-primary)}',
      '@keyframes df-toast-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
      /* hub page */
      '.df-hub{box-sizing:border-box;height:100%;flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;padding:28px clamp(20px,4vw,48px) 40px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:1.5;background:var(--dsw-alias-bg-base)}',
      '.df-hub-inner{width:100%;max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:18px}',
      '.df-hub-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}',
      '.df-hub-title{font-size:22px;font-weight:600;margin:0}',
      '.df-hub-sub{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.df-hub-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.df-hub-status{display:flex;gap:8px 18px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12.5px;padding:2px 0 0}',
      '.df-hub-status b{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}',
      '.df-hub-paused{color:var(--dsw-alias-state-warn-primary);font-size:12.5px;margin:0}',
      '.df-section{box-sizing:border-box;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:12px}',
      '.df-section-title{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:14px;font-weight:600;margin:0}',
      '.df-progress-row{display:flex;flex-direction:column;gap:5px}',
      '.df-progress-label{display:flex;justify-content:space-between;gap:12px;color:var(--dsw-alias-label-secondary);font-size:12.5px}',
      '.df-progress-label b{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}',
      '.df-progress{position:relative;height:10px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}',
      '.df-progress-fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}',
      '.df-progress-fill[data-tone="warn"]{background:var(--dsw-alias-state-warn-primary)}',
      '.df-progress-fill[data-tone="danger"]{background:var(--dsw-alias-state-error-primary)}',
      '.df-progress-fill[data-tone="rest"]{background:var(--dsw-alias-state-success-primary)}',
      '.df-kv{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}',
      '.df-kv b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.df-usage-empty{color:var(--dsw-alias-label-secondary);font-size:13px;margin:0}',
      '.df-usage-note{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0}',
      '.df-chart{display:flex;flex-direction:column;gap:6px;padding:4px 0}',
      '.df-chart svg{display:block;width:100%;height:150px}',
      '.df-usage-axis{stroke:var(--dsw-alias-border-l2);stroke-width:1}',
      '.df-chart-labels{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;color:var(--dsw-alias-label-secondary);font-size:11px;text-align:center}',
      '.df-usage-legend{display:flex;flex-wrap:wrap;gap:10px 14px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.df-legend-dot{display:inline-block;width:8px;height:8px;margin-right:4px;border-radius:2px}',
      '.df-seg-0{fill:var(--dsw-alias-brand-primary)}',
      '.df-seg-1{fill:var(--dsw-alias-state-success-primary)}',
      '.df-seg-2{fill:var(--dsw-alias-state-warn-primary)}',
      '.df-seg-3{fill:var(--dsw-alias-state-idle-primary)}',
      '.df-seg-4{fill:var(--dsw-alias-label-secondary)}',
      '.df-seg-other{fill:var(--dsw-alias-border-l1)}',
      '.df-field{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.df-field:last-child{border-bottom:0}',
      '.df-field-label{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.df-field-title{font-size:14px}',
      '.df-field-hint{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.df-field-control{display:flex;align-items:center;gap:8px;flex:0 0 auto}',
      '[data-df-root] .df-number{box-sizing:border-box;width:92px;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;text-align:right;outline:none}',
      '.df-number:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '[data-df-root] .df-switch{position:relative;width:38px;height:22px;flex:0 0 auto;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background-color .16s ease,border-color .16s ease}',
      '[data-df-root] .df-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '[data-df-root] .df-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '[data-df-root] .df-switch[disabled]{opacity:.5;cursor:default}',
      '[data-df-root] .df-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .16s ease}',
      '[data-df-root] .df-switch[aria-checked="true"]::after{transform:translateX(16px)}',
      '[data-df-root] .df-savebar{position:static;display:flex;align-items:center;justify-content:flex-end;gap:12px;flex-wrap:wrap;width:100%;box-sizing:border-box;padding:14px 0 6px;margin-top:14px;border-top:1px solid var(--dsw-alias-border-l2);background:transparent}',
      '[data-df-root] .df-savebar-actions{display:flex;align-items:center;gap:10px;margin-left:auto}',
      '.df-overlay-reason{color:var(--dsw-alias-label-secondary);font-size:13px;margin:0}',
      '[data-df-root] .df-save-state{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '[data-df-root] .df-save-state[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}',
      '[data-df-root] .df-save-state[data-kind="saved"]{color:var(--dsw-alias-state-success-primary)}',
      '@media (prefers-reduced-motion: reduce){.df-toast{animation:none}.df-progress-fill,.df-switch,.df-switch::after,.df-btn,.df-rings,.df-ring-value{transition:none}}',
    ].join('')

    /**
     * Running ROOT conversation ids from the client session snapshot — the same
     * source the sidebar uses to render its running dot. Subagent/teammate rows
     * are filtered out so they can never trigger solo hiding.
     */
    function runningRootIdsFrom(sessionsSnapshot, statusMap) {
      if (sessionsSnapshot === null || typeof sessionsSnapshot !== 'object') return null
      const byId = sessionsSnapshot.byId
      if (byId === null || typeof byId !== 'object') return null
      const listIds = Array.isArray(sessionsSnapshot.ids) ? sessionsSnapshot.ids : Object.keys(byId)
      const ids = []
      for (let index = 0; index < listIds.length; index += 1) {
        const id = listIds[index]
        const row = byId[id]
        if (!row) continue
        if (row.origin === 'subagent') continue
        if (row.parentId !== undefined && row.parentId !== null) continue
        const status = statusMap && typeof statusMap.get === 'function' ? statusMap.get(id) : undefined
        const running = status && typeof status.running === 'boolean' ? status.running : row.running === true
        if (running) ids.push(id)
      }
      return ids
    }

    /* ── Runtime: i18n, shared store, solo hiding, components ──────────── */

    function createRuntime(ctx) {
      const locale = ctx && ctx.locale ? ctx.locale : null
      const audio = createAudio()
      let boundTranslate = null

      function t(key, params) {
        try {
          if (locale && typeof locale.bind === 'function') {
            if (!boundTranslate) boundTranslate = locale.bind(NS)
            return boundTranslate(key, params)
          }
        } catch (error) {
          /* fall through to the local dictionary */
        }
        const template = I18N.en[key] !== undefined ? I18N.en[key] : key
        return interpolate(template, params)
      }

      function useLocaleTick() {
        const state = React.useState(0)
        const force = state[1]
        React.useEffect(function () {
          if (!locale || typeof locale.subscribe !== 'function') return undefined
          return locale.subscribe(function () {
            force(function (value) {
              return value + 1
            })
          })
        }, [])
      }

      function appDisplayName(row) {
        const id = row && typeof row.id === 'string' ? row.id.toLowerCase() : ''
        const key = APP_NAME_KEYS[id]
        if (key) return t(key)
        if (row && typeof row.name === 'string' && row.name.length > 0) return row.name
        return row && typeof row.id === 'string' && row.id.length > 0 ? row.id : t('stats.unknownApp')
      }

      /** Escape a value for use inside a double-quoted attribute selector. */
      function cssAttrValue(value) {
        return String(value).replace(/["\\]/g, function (character) {
          return '\\' + character
        })
      }

      function selectConversationPanel() {
        try {
          const layout = ctx && typeof ctx.get === 'function' ? ctx.get('layout') : undefined
          if (layout && typeof layout.selectPanel === 'function') {
            layout.selectPanel(null)
            return true
          }
        } catch (error) {
          /* optional affordance */
        }
        return false
      }

      function readAckKeys() {
        const keys = new Set()
        try {
          const storage = typeof window !== 'undefined' ? window.localStorage : undefined
          if (!storage) return keys
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index)
            if (typeof key === 'string' && key.indexOf(ACK_KEY_PREFIX) === 0) keys.add(key.slice(ACK_KEY_PREFIX.length))
          }
        } catch (error) {
          /* localStorage may be unavailable */
        }
        return keys
      }

      function writeAckKey(dayKey) {
        try {
          const storage = typeof window !== 'undefined' ? window.localStorage : undefined
          if (storage) storage.setItem(ACK_KEY_PREFIX + dayKey, '1')
        } catch (error) {
          /* in-memory fallback lives in the store snapshot */
        }
      }

      /* ── Shared polling store (one loop for every component) ─────────── */

      const store = (function createStore() {
        let snapshot = {
          status: 'boot', // boot | live | hidden | disabled
          state: null,
          consecutiveFailures: 0,
          error: false,
          toasts: [],
          appsTrend: null,
          appsLoading: false,
          appsError: false,
          clockOffset: 0,
          ackDays: readAckKeys(),
        }
        const listeners = new Set()
        const clockListeners = new Set()
        const toastTimers = new Set()
        let pollTimer = 0
        let clockTimer = 0
        let inFlight = false
        let active = false
        let lastSeq = null
        let toastSeq = 0

        function get() {
          return snapshot
        }

        function isVisible() {
          return snapshot.status === 'live'
        }

        function emit() {
          listeners.forEach(function (listener) {
            try {
              listener()
            } catch (error) {
              /* a subscriber must never break the store */
            }
          })
        }

        function emitClock() {
          clockListeners.forEach(function (listener) {
            try {
              listener()
            } catch (error) {
              /* ignored */
            }
          })
        }

        function subscribe(listener) {
          listeners.add(listener)
          return function () {
            listeners.delete(listener)
          }
        }

        function subscribeClock(listener) {
          clockListeners.add(listener)
          return function () {
            clockListeners.delete(listener)
          }
        }

        function pushToast(kind, text) {
          if (!text || !isVisible()) return
          const id = ++toastSeq
          const toasts = snapshot.toasts.concat([{ id: id, kind: kind, text: text }]).slice(-3)
          snapshot = Object.assign({}, snapshot, { toasts: toasts })
          emit()
          const timer = setTimeout(function () {
            toastTimers.delete(timer)
            dismissToast(id)
          }, TOAST_MS)
          toastTimers.add(timer)
        }

        function dismissToast(id) {
          const next = snapshot.toasts.filter(function (toast) {
            return toast.id !== id
          })
          if (next.length !== snapshot.toasts.length) {
            snapshot = Object.assign({}, snapshot, { toasts: next })
            emit()
          }
        }

        /** A completion event may only ring for a root conversation. */
        function isRootSessionId(sessionId) {
          if (typeof sessionId !== 'string' || sessionId.length === 0) return true
          const state = store.get().state
          const sessions = state && Array.isArray(state.sessions) ? state.sessions : []
          for (let index = 0; index < sessions.length; index += 1) {
            const row = sessions[index]
            if (!row || row.id !== sessionId) continue
            if (row.parentId) return false
            const origin = row.origin
            return origin !== 'subagent' && origin !== 'teammate'
          }
          return false
        }

        function completionToast(meta) {
          if (meta && !isRootSessionId(meta.sessionId)) return
          const task = meta && typeof meta.task === 'string' && meta.task.length > 0 ? meta.task : null
          pushToast('task-completed', task ? t('toast.taskCompletedTask', { task: task }) : t('toast.taskCompleted'))
        }

        function handleEvent(event) {
          const kind = event && event.kind
          if (kind !== EVENT.taskCompleted) return
          // A completion event only informs; sound is driven by the running-set edge.
          completionToast((event && event.meta) || {})
        }

        /** Show each ring-buffer event once; a recovery or first load only sets a baseline. */
        function ingestEvents(events, nextState, resetBaseline) {
          if (!Array.isArray(events) || events.length === 0) return
          let maxSeq = null
          for (let index = 0; index < events.length; index += 1) {
            const seq = Number(events[index] && events[index].seq)
            if (Number.isFinite(seq) && (maxSeq === null || seq > maxSeq)) maxSeq = seq
          }
          if (maxSeq === null) return
          if (resetBaseline || lastSeq === null || maxSeq < lastSeq) {
            lastSeq = maxSeq
            return
          }
          const fresh = events
            .filter(function (event) {
              const seq = Number(event && event.seq)
              return Number.isFinite(seq) && seq > lastSeq
            })
            .sort(function (left, right) {
              return Number(left.seq) - Number(right.seq)
            })
          lastSeq = maxSeq
          const alerts = (nextState && nextState.alerts) || (nextState && nextState.settings && nextState.settings.alerts) || null
          fresh.forEach(function (event) {
            handleEvent(event, alerts)
          })
        }

        function validState(data) {
          return Boolean(
            data &&
              typeof data === 'object' &&
              data.limit &&
              typeof data.limit === 'object' &&
              data.usage &&
              data.solo &&
              data.settings,
          )
        }

        function applyState(next) {
          const serverNow = toTimestamp(next.now)
          const clockOffset = serverNow === null ? 0 : Date.now() - serverNow
          const recovering = snapshot.status !== 'live'
          // Publish the fresh snapshot before ingesting the ring so event handlers
          // (completion chime away check) see the current state, not the previous one.
          snapshot = Object.assign({}, snapshot, {
            status: 'live',
            state: next,
            error: false,
            consecutiveFailures: 0,
            clockOffset: clockOffset,
          })
          ingestEvents(next.events, next, recovering)
          emit()
        }

        function goUnavailable(status) {
          if (snapshot.status === status) return
          snapshot = Object.assign({}, snapshot, { status: status, error: true, toasts: [] })
          emit()
        }

        function registerFailure(httpStatus) {
          const failures = snapshot.consecutiveFailures + 1
          if (httpStatus === 404) {
            snapshot = Object.assign({}, snapshot, { consecutiveFailures: failures })
            goUnavailable('disabled')
            return
          }
          if (failures >= 2) {
            snapshot = Object.assign({}, snapshot, { consecutiveFailures: failures })
            goUnavailable('hidden')
            return
          }
          snapshot = Object.assign({}, snapshot, { consecutiveFailures: failures, error: true })
          emit()
        }

        function pollDelay() {
          if (snapshot.status !== 'live') return QUIET_POLL_MS
          return typeof document !== 'undefined' && document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS
        }

        function schedule(delay) {
          if (!active) return
          clearTimeout(pollTimer)
          pollTimer = setTimeout(runPoll, delay === undefined ? pollDelay() : delay)
        }

        async function runPoll() {
          if (!active) return
          if (inFlight) {
            schedule()
            return
          }
          inFlight = true
          const result = await fetchJSON(ROUTES.state)
          inFlight = false
          if (!active) return
          if (result.ok && validState(result.data)) applyState(result.data)
          else if (result.status === 404) registerFailure(404)
          else registerFailure(result.status)
          schedule()
        }

        function refreshSoon() {
          if (!active) return
          schedule(0)
        }

        function restCountdownVisible() {
          const state = snapshot.state
          return isVisible() && Boolean(state && state.limit && state.limit.resting === true)
        }

        function start() {
          if (active) return function () {}
          active = true
          const onVisibility = function () {
            if (!active) return
            schedule(0)
          }
          const onOnline = function () {
            if (!active) return
            schedule(0)
          }
          try {
            document.addEventListener('visibilitychange', onVisibility)
            window.addEventListener('online', onOnline)
          } catch (error) {
            /* ignored */
          }
          clockTimer = setInterval(function () {
            if (active && restCountdownVisible()) emitClock()
          }, CLOCK_TICK_MS)
          schedule(0)
          return function () {
            active = false
            clearTimeout(pollTimer)
            clearInterval(clockTimer)
            toastTimers.forEach(function (timer) {
              clearTimeout(timer)
            })
            toastTimers.clear()
            try {
              document.removeEventListener('visibilitychange', onVisibility)
              window.removeEventListener('online', onOnline)
            } catch (error) {
              /* ignored */
            }
          }
        }

        function isAcked(dayKey) {
          if (typeof dayKey !== 'string' || dayKey.length === 0) return false
          return snapshot.ackDays.has(dayKey)
        }

        function ackToday(dayKey) {
          if (typeof dayKey !== 'string' || dayKey.length === 0) return
          const next = new Set(snapshot.ackDays)
          next.add(dayKey)
          snapshot = Object.assign({}, snapshot, { ackDays: next })
          writeAckKey(dayKey)
          emit()
        }

        async function postAction(route, body) {
          const result = await fetchJSON(route, { method: 'POST', body: body === undefined ? {} : body })
          if (result.ok && result.data && result.data.state) applyState(result.data.state)
          else if (result.ok) refreshSoon()
          else if (result.status === 409) refreshSoon()
          return result
        }

        function setAssistant(enabled) {
          return postAction(ROUTES.assistant, { enabled: Boolean(enabled) })
        }

        function extend() {
          return postAction(ROUTES.extend, {})
        }

        function startRest() {
          return postAction(ROUTES.restStart, {})
        }

        function finishRest() {
          return postAction(ROUTES.restFinish, {})
        }

        function resume() {
          return postAction(ROUTES.resume, {})
        }

        async function loadAppsTrend(force) {
          if (snapshot.appsLoading) return
          if (!force && snapshot.appsTrend) return
          snapshot = Object.assign({}, snapshot, { appsLoading: true, appsError: false })
          emit()
          const result = await fetchJSON(ROUTES.apps + '?days=7')
          if (result.ok && result.data) {
            snapshot = Object.assign({}, snapshot, {
              appsLoading: false,
              appsError: false,
              appsTrend: normalizeAppsTrend(result.data),
            })
          } else {
            snapshot = Object.assign({}, snapshot, { appsLoading: false, appsError: true })
          }
          emit()
        }

        async function saveSettings(settings) {
          const result = await fetchJSON(ROUTES.settings, { method: 'POST', body: { settings: settings } })
          if (result.ok && result.data && result.data.settings && snapshot.state) {
            snapshot = Object.assign({}, snapshot, {
              state: Object.assign({}, snapshot.state, { settings: result.data.settings }),
            })
            emit()
            refreshSoon()
          }
          return result
        }

        return {
          get: get,
          isVisible: isVisible,
          subscribe: subscribe,
          subscribeClock: subscribeClock,
          start: start,
          applyState: applyState,
          refreshSoon: refreshSoon,
          isAcked: isAcked,
          ackToday: ackToday,
          setAssistant: setAssistant,
          extend: extend,
          startRest: startRest,
          finishRest: finishRest,
            resume: resume,
            loadAppsTrend: loadAppsTrend,
          saveSettings: saveSettings,
          pushToast: pushToast,
        }
      })()

      /* ── Solo session hiding: one CSS rule + one <html> attribute ────── */
      // No host service is wrapped and no host row gets inline styles. The
      // injected rule hides non-running session rows and the other workspace
      // rows; activation/teardown is synchronous and idempotent.

      /* ── Away detection + repeating completion chime ─────────── */
      // The chime only rings while the user is not watching: window hidden or
      // unfocused, the Host reports away/idle, or local inactivity exceeds
      // alerts.awayIdleSeconds. It repeats until real input returns.

      const awayTracker = (function createAwayTracker() {
        let lastActivityAt = Date.now()
        let started = false

        function markActive() {
          lastActivityAt = Date.now()
        }

        function start() {
          if (started) return function () {}
          started = true
          const handler = function () {
            markActive()
          }
          const events = ['mousemove', 'keydown', 'pointerdown', 'wheel', 'touchstart', 'focus']
          try {
            events.forEach(function (name) {
              document.addEventListener(name, handler, true)
            })
          } catch (error) {
            /* ignored */
          }
          return function () {
            started = false
            try {
              events.forEach(function (name) {
                document.removeEventListener(name, handler, true)
              })
            } catch (error) {
              /* ignored */
            }
          }
        }

        function hostIdleMs(state) {
          const usage = state && state.usage ? state.usage : null
          if (!usage) return null
          const candidates = [usage.idleMs, usage.idleLengthMs]
          let best = null
          for (let index = 0; index < candidates.length; index += 1) {
            const value = candidates[index]
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
              best = best === null ? value : Math.max(best, value)
            }
          }
          return best
        }

        function isAway(alerts, state) {
          try {
            if (typeof document !== 'undefined' && document.hidden) return true
            if (
              typeof document !== 'undefined' &&
              typeof document.hasFocus === 'function' &&
              document.hasFocus() === false
            ) {
              return true
            }
          } catch (error) {
            /* ignored */
          }
          const limit = state && state.limit ? state.limit : null
          if (limit && limit.pausedNeedsActivity === true) return true
          const usage = state && state.usage ? state.usage : null
          if (usage && usage.away === true) return true
          const awaySeconds = clampNumber(alerts && alerts.awayIdleSeconds, 10, 3600, 30)
          const idle = hostIdleMs(state)
          if (idle !== null && idle >= awaySeconds * 1000) return true
          return Date.now() - lastActivityAt >= awaySeconds * 1000
        }

        return { start: start, isAway: isAway, markActive: markActive }
      })()

      const completionChime = (function createCompletionChime() {
        const INPUT_EVENTS = ['mousemove', 'keydown', 'pointerdown', 'wheel', 'touchstart', 'focus']
        const REPEAT_LIMIT = 120
        let timer = 0
        let repeating = false
        let activeAlerts = null
        let detachInput = null
        let plays = 0

        function clampInterval(value) {
          return clampNumber(value, 500, 10000, 1000)
        }

        function play(alerts) {
          if (plays >= REPEAT_LIMIT) return
          plays += 1
          if (!alerts || alerts.sound === false) return
          if (isQuietHours(alerts)) return
          audio.chime(numberOr(alerts.volume, 0.6))
        }

        function detach() {
          if (typeof detachInput === 'function') {
            try {
              detachInput()
            } catch (error) {
              /* ignored */
            }
          }
          detachInput = null
        }

        function stop() {
          repeating = false
          activeAlerts = null
          if (timer) {
            clearInterval(timer)
            timer = 0
          }
          detach()
        }

        function tick() {
          if (!repeating) return
          if (plays >= REPEAT_LIMIT) {
            stop()
            return
          }
          const state = store.get().state
          if (!awayTracker.isAway(activeAlerts, state)) {
            stop()
            return
          }
          play(activeAlerts)
        }

        function startRepeating(alerts) {
          activeAlerts = alerts
          repeating = true
          plays = 0
          play(alerts)
          if (timer) clearInterval(timer)
          timer = setInterval(tick, clampInterval(alerts && alerts.repeatIntervalMs))
          const onInput = function () {
            awayTracker.markActive()
            stop()
          }
          const onVisibility = function () {
            if (!document.hidden) {
              awayTracker.markActive()
              stop()
            }
          }
          const onWindowFocus = function () {
            awayTracker.markActive()
            stop()
          }
          try {
            INPUT_EVENTS.forEach(function (name) {
              document.addEventListener(name, onInput, true)
            })
            document.addEventListener('visibilitychange', onVisibility, true)
            window.addEventListener('focus', onWindowFocus, true)
          } catch (error) {
            /* ignored */
          }
          detachInput = function () {
            INPUT_EVENTS.forEach(function (name) {
              document.removeEventListener(name, onInput, true)
            })
            try {
              document.removeEventListener('visibilitychange', onVisibility, true)
              window.removeEventListener('focus', onWindowFocus, true)
            } catch (error) {
              /* ignored */
            }
          }
        }

        /** Ring only when ALL running root conversations just finished, and never while watching. */
        function triggerAllFinished() {
          const state = store.get().state
          const alerts = (state && state.settings && state.settings.alerts) || null
          if (!awayTracker.isAway(alerts, state)) return
          if (alerts && alerts.repeatUntilActive === false) {
            play(alerts)
            return
          }
          startRepeating(alerts || {})
        }

        return { triggerAllFinished: triggerAllFinished, stop: stop }
      })()

      /* ── Solo session hiding: one style node + animated html attribute ── */
      // Client-primary running-set detection. Non-owner session rows and the other
      // workspace/overflow rows fade out (~220ms) and then collapse to display:none;
      // restore runs the reverse. No inline styles and no banner.

      /* ── Solo session mode: gray rows + gentle click interception ── */
      // Client-primary running-set detection. A single injected style node + one
      // <html> attribute reduce opacity of non-owner session/workspace/overflow
      // rows; layout is never changed, so restore is exact and residue-free.

      const soloHider = (function createSoloHider() {
        let styleElement = null
        let running = false
        let clientRunningIds = null
        let clientCurrentId = null
        let lastBlockedAt = 0

        function activeState() {
          const current = store.get()
          if (current.status !== 'live') return null
          const state = current.state
          if (!state) return null
          if (!assistantActive(state)) return null
          const assistant = (state.settings && state.settings.assistant) || {}
          if (assistant.soloSession === false || assistant.hideOtherSessions === false) return null
          let ids = null
          if (clientRunningIds !== null) {
            ids = clientRunningIds
          } else if (state.solo && state.solo.active === true && Array.isArray(state.solo.sessions)) {
            ids = state.solo.sessions
          }
          const clean = Array.isArray(ids)
            ? ids.filter(function (id) {
                return typeof id === 'string' && id.length > 0
              })
            : []

          // The client running set is authoritative: nothing running means no solo
          // mode even if the Host state is momentarily stale.
          if (clientRunningIds !== null && clean.length === 0) return null

          // v0.4.6: exactly ONE owner. The Host's solo.primary wins; otherwise a
          // single running root, then the visible conversation if it is running.
          const solo = state.solo && typeof state.solo === 'object' ? state.solo : null
          const hostPrimary = solo ? solo.primary || solo.primarySession : null
          let owner = null
          if (typeof hostPrimary === 'string' && hostPrimary.length > 0) owner = hostPrimary
          else if (clean.length === 1) owner = clean[0]
          else if (clientCurrentId !== null && clean.indexOf(clientCurrentId) >= 0) owner = clientCurrentId
          return owner === null ? null : [owner]
        }

        function stateNow() {
          return store.get().state
        }

        /** Nearest sidebar group rows that contain one of the running sessions. */
        function ownerWorkspaceKeys(ids) {
          const keys = new Set()
          try {
            for (let index = 0; index < ids.length; index += 1) {
              const safe = String(ids[index]).replace(/["\\]/g, '')
              const row = document.querySelector('[data-row-key="session:' + safe + '"]')
              if (!row) continue
              let node = row
              for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
                const found = new Set()
                if (node && typeof node.querySelectorAll === 'function') {
                  const list = node.querySelectorAll('[data-row-key^="workspace:"]')
                  for (let foundIndex = 0; foundIndex < list.length; foundIndex += 1) {
                    const key = list[foundIndex].getAttribute && list[foundIndex].getAttribute('data-row-key')
                    if (key && key.indexOf('workspace:') === 0) found.add(key)
                  }
                }
                let sibling = node && node.previousElementSibling
                for (let step = 0; sibling && step < 3; step += 1, sibling = sibling.previousElementSibling) {
                  const siblingKey = sibling.getAttribute && sibling.getAttribute('data-row-key')
                  if (siblingKey && siblingKey.indexOf('workspace:') === 0) {
                    found.add(siblingKey)
                    break
                  }
                }
                if (found.size > 0) {
                  found.forEach(function (key) {
                    keys.add(key)
                  })
                  // Nearest enclosing group only: never walk up to the whole list.
                  break
                }
              }
            }
          } catch (error) {
            /* fall back to graying every workspace row */
          }
          return keys
        }

        function buildCss(ids) {
          const sessionKeep = ids
            .map(function (id) {
              return ':not([data-row-key="session:' + cssAttrValue(id) + '"])'
            })
            .join('')
          const workspaceKeep = Array.from(ownerWorkspaceKeys(ids))
            .map(function (key) {
              return ':not([data-row-key="' + cssAttrValue(key) + '"])'
            })
            .join('')
          return (
            'html[data-dsh-focus-solo] [data-row-key^="session:"]' +
            sessionKeep +
            '{opacity:.45}' +
            'html[data-dsh-focus-solo] [data-row-key^="workspace:"]' +
            workspaceKeep +
            '{opacity:.45}' +
            'html[data-dsh-focus-solo] [data-row-key^="overflow:"]{opacity:.45}'
          )
        }

        function ensureStyle(ids) {
          try {
            if (!styleElement || !styleElement.isConnected) {
              styleElement = document.createElement('style')
              styleElement.setAttribute(DIM_STYLE_ATTR, '1')
              const parent = document.head || document.documentElement
              if (parent && typeof parent.appendChild === 'function') parent.appendChild(styleElement)
            }
            const css = buildCss(ids)
            if (styleElement.textContent !== css) styleElement.textContent = css
            document.documentElement.setAttribute(SOLO_HTML_ATTR, ids.join(','))
          } catch (error) {
            /* graying is cosmetic; never break the app */
          }
        }

        /** Hard reset: remove the style node + html attribute, restore legacy marks. */
        function teardown() {
          try {
            if (styleElement && styleElement.parentNode) styleElement.parentNode.removeChild(styleElement)
          } catch (error) {
            /* ignored */
          }
          styleElement = null
          try {
            document.documentElement.removeAttribute(SOLO_HTML_ATTR)
            void document.documentElement.offsetHeight
          } catch (error) {
            /* ignored */
          }
          restoreLegacyDimMarks()
        }

        function sync() {
          if (!running) return
          const ids = activeState()
          if (ids === null) {
            teardown()
            return
          }
          ensureStyle(ids)
        }

        function notifyGentle() {
          const now = Date.now()
          if (now - lastBlockedAt < 1200) return
          lastBlockedAt = now
          store.pushToast('gentle-switch', t('toast.gentleSwitch'))
        }

        function isOwnUiTarget(target) {
          let element = target
          for (let depth = 0; element && depth < 20; depth += 1, element = element.parentElement) {
            if (!element || typeof element.getAttribute !== 'function') continue
            if (
              element.getAttribute('data-dsh-deep-focus-root') !== null ||
              element.getAttribute('data-df-root') !== null
            ) {
              return true
            }
          }
          return false
        }

        function soloInfo() {
          if (!running) return null
          const ids = activeState()
          if (ids === null) return null
          return { owners: new Set(ids), ownerWorkspaces: ownerWorkspaceKeys(ids) }
        }

        function blockedFrom(target) {
          if (isOwnUiTarget(target)) return null
          const info = soloInfo()
          if (info === null) return null
          const state = stateNow()
          const known = new Set()
          const sessions = state && Array.isArray(state.sessions) ? state.sessions : []
          for (let index = 0; index < sessions.length; index += 1) {
            const session = sessions[index]
            if (session && typeof session.id === 'string' && session.id.length > 0) known.add(session.id)
          }
          let element = target
          for (let depth = 0; element && depth < 12; depth += 1, element = element.parentElement) {
            if (!element || typeof element.getAttribute !== 'function') continue
            const rowKey = element.getAttribute('data-row-key')
            if (typeof rowKey === 'string' && rowKey.length > 0) {
              if (rowKey.indexOf('session:') === 0) {
                const id = rowKey.slice(8)
                if (info.owners.has(id)) return null
                return id
              }
              if (rowKey.indexOf('workspace:') === 0) {
                if (info.ownerWorkspaces.has(rowKey)) return null
                return rowKey
              }
              if (rowKey.indexOf('overflow:') === 0) return rowKey
            }
            const attributes = element.attributes
            if (!attributes) continue
            for (let index = 0; index < attributes.length; index += 1) {
              const value = attributes[index].value
              if (!value || value.length > 200) continue
              if (known.has(value) && !info.owners.has(value)) return value
              const prefixed = value.slice(0, 8) === 'session:' ? value.slice(8) : null
              if (prefixed && known.has(prefixed) && !info.owners.has(prefixed)) return prefixed
            }
          }
          return null
        }

        function onDocumentClick(event) {
          try {
            if (blockedFrom(event.target)) {
              event.preventDefault()
              event.stopPropagation()
              notifyGentle()
            }
          } catch (error) {
            /* never break host clicks */
          }
        }

        function onDocumentKeyDown(event) {
          try {
            if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
            const target = event.target
            if (!target || typeof target.getAttribute !== 'function') return
            if (blockedFrom(target)) {
              event.preventDefault()
              event.stopPropagation()
              notifyGentle()
            }
          } catch (error) {
            /* ignored */
          }
        }

        function setClientRunning(ids, currentSessionId) {
          const next = Array.isArray(ids)
            ? ids.filter(function (id) {
                return typeof id === 'string' && id.length > 0
              })
            : null
          const nextCurrent = typeof currentSessionId === 'string' && currentSessionId.length > 0 ? currentSessionId : null
          const nextSignature = (next === null ? '\u0000' : next.join('|')) + '#' + (nextCurrent === null ? '' : nextCurrent)
          const previousSignature =
            (clientRunningIds === null ? '\u0000' : clientRunningIds.join('|')) +
            '#' +
            (clientCurrentId === null ? '' : clientCurrentId)
          if (nextSignature === previousSignature) return
          clientRunningIds = next
          clientCurrentId = nextCurrent
          sync()
        }

        function start() {
          if (running) return
          running = true
          try {
            document.addEventListener('click', onDocumentClick, true)
            document.addEventListener('keydown', onDocumentKeyDown, true)
          } catch (error) {
            /* ignored */
          }
          sync()
        }

        function stop() {
          running = false
          try {
            document.removeEventListener('click', onDocumentClick, true)
            document.removeEventListener('keydown', onDocumentKeyDown, true)
          } catch (error) {
            /* ignored */
          }
          teardown()
        }

        function isActive() {
          return running && activeState() !== null
        }

        function getOwners() {
          const ids = activeState()
          return ids === null ? new Set() : new Set(ids)
        }

        return {
          start: start,
          stop: stop,
          sync: sync,
          setClientRunning: setClientRunning,
          isActive: isActive,
          getOwners: getOwners,
        }
      })()

      /* ── Focus guard: pin the UI to the solo primary conversation ── */
      // When solo is active and the main view is not the primary conversation,
      // jump once to it; the veil is the fallback. Never loops or fights the user.

      const focusGuard = (function createFocusGuard() {
        let currentSessionId = null
        let runningIds = []
        let lastAttemptKey = ''
        let lastSwitchAt = 0
        const listeners = new Set()

        function notify() {
          listeners.forEach(function (listener) {
            try {
              listener()
            } catch (error) {
              /* ignored */
            }
          })
        }

        function subscribe(listener) {
          listeners.add(listener)
          return function () {
            listeners.delete(listener)
          }
        }

        function currentOwners() {
          // Solo mode resolves exactly one owner (solo.primary -> single running
          // root -> visible running conversation -> none).
          if (!soloHider.isActive()) return []
          return Array.from(soloHider.getOwners())
        }

        function switchTo(target) {
          try {
            const workspace = ctx && typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
            if (workspace && typeof workspace.openSession === 'function') {
              workspace.openSession(target)
              return true
            }
          } catch (error) {
            /* fall through to the session service */
          }
          try {
            const sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
            if (sessions) {
              const methods = ['openSession', 'open', 'select']
              for (let index = 0; index < methods.length; index += 1) {
                const method = methods[index]
                if (typeof sessions[method] === 'function') {
                  sessions[method](target)
                  return true
                }
              }
            }
          } catch (error) {
            /* the veil stays as the fallback */
          }
          return false
        }

        function maybeJump() {
          if (!soloHider.isActive()) {
            lastAttemptKey = ''
            return false
          }
          const owners = currentOwners()
          if (owners.length === 0) return false
          if (currentSessionId === null) return false
          if (owners.indexOf(currentSessionId) >= 0) return false
          const key = owners.join('|') + '|' + currentSessionId
          if (key === lastAttemptKey && Date.now() - lastSwitchAt < 2500) return false
          lastAttemptKey = key
          lastSwitchAt = Date.now()
          return switchTo(owners[0])
        }

        function setContext(nextCurrentSessionId, nextRunningIds) {
          const current = typeof nextCurrentSessionId === 'string' ? nextCurrentSessionId : null
          const ids = Array.isArray(nextRunningIds)
            ? nextRunningIds.filter(function (id) {
                return typeof id === 'string' && id.length > 0
              })
            : []
          const changed = current !== currentSessionId || ids.join('|') !== runningIds.join('|')
          currentSessionId = current
          runningIds = ids
          if (changed) {
            notify()
            maybeJump()
          } else {
            maybeJump()
          }
        }

        function sync() {
          if (!soloHider.isActive()) {
            lastAttemptKey = ''
            return
          }
          // The primary can change on the Host side without the client session
          // context changing, so re-evaluate the pin on every state update.
          maybeJump()
        }

        function getInfo() {
          const owners = currentOwners()
          const active = soloHider.isActive()
          return {
            currentSessionId: currentSessionId,
            owners: owners,
            veilNeeded: Boolean(active && currentSessionId !== null && owners.indexOf(currentSessionId) < 0),
            soloActive: active,
          }
        }

        return { setContext: setContext, sync: sync, getInfo: getInfo, subscribe: subscribe, maybeJump: maybeJump }
      })()

      function start() {
        const stopStore = store.start()
        const stopAway = awayTracker.start()
        soloHider.start()
        const unsubscribe = store.subscribe(function () {
          soloHider.sync()
          focusGuard.sync()
        })
        const unlockAudio = function () {
          audio.unlock()
        }
        try {
          document.addEventListener('pointerdown', unlockAudio, true)
          document.addEventListener('keydown', unlockAudio, true)
        } catch (error) {
          /* ignored */
        }
        return function () {
          try {
            document.removeEventListener('pointerdown', unlockAudio, true)
            document.removeEventListener('keydown', unlockAudio, true)
          } catch (error) {
            /* ignored */
          }
          completionChime.stop()
          stopAway()
          unsubscribe()
          soloHider.stop()
          stopStore()
        }
      }

      /* ── Shared React hooks ──────────────────────────────────────────── */

      function useStore(clockToo) {
        const pair = React.useState(0)
        const force = pair[1]
        React.useEffect(
          function () {
            const unsubscribe = store.subscribe(function () {
              force(function (value) {
                return value + 1
              })
            })
            const unsubscribeClock = clockToo
              ? store.subscribeClock(function () {
                  force(function (value) {
                    return value + 1
                  })
                })
              : null
            return function () {
              unsubscribe()
              if (unsubscribeClock) unsubscribeClock()
            }
          },
          [clockToo],
        )
        return store.get()
      }

      /* ── Small pieces ────────────────────────────────────────────────── */

      const BUTTON_BASE_STYLE = {
        appearance: 'none',
        WebkitAppearance: 'none',
        borderStyle: 'solid',
        borderWidth: '1px',
        borderRadius: '8px',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: '1.2',
        boxSizing: 'border-box',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '5px',
        padding: '0 14px',
        height: '32px',
      }

      function primaryButtonStyle(extra) {
        return Object.assign({}, BUTTON_BASE_STYLE, {
          background: 'var(--dsw-alias-brand-primary)',
          borderColor: 'var(--dsw-alias-brand-primary)',
          color: '#ffffff',
          fontWeight: 600,
        }, extra || {})
      }

      function secondaryButtonStyle(extra) {
        return Object.assign({}, BUTTON_BASE_STYLE, {
          background: 'var(--dsw-alias-bg-layer-2)',
          borderColor: 'var(--dsw-alias-border-l1)',
          color: 'var(--dsw-alias-label-primary)',
        }, extra || {})
      }

      function smallButtonStyle(extra) {
        return Object.assign(secondaryButtonStyle(), { height: '28px', padding: '0 10px', fontSize: '12px' }, extra || {})
      }

      function toggleButtonStyle(checked) {
        return Object.assign({}, BUTTON_BASE_STYLE, {
          width: '38px',
          height: '22px',
          padding: 0,
          borderRadius: '999px',
          background: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-bg-layer-2)',
          borderColor: checked ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)',
          color: 'var(--dsw-alias-label-primary)',
        })
      }

      function Styles() {
        return h('style', { 'data-df-styles': '1' }, CSS_TEXT)
      }

      function IconRefresh() {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('path', {
            d: 'M9.8 6A3.8 3.8 0 1 1 8.6 3.2M8.6 1.6v1.9H6.7',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        )
      }

      /** Sidebar navigation icon for the hub (receives the shell's `size`). */
      function AssistantIcon(props) {
        const size = numberOr(props && props.size, 16)
        return h(
          'svg',
          { className: 'df-icon', width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
          h('circle', { cx: 8, cy: 8, r: 5.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
          h('circle', { cx: 8, cy: 8, r: 1.8, fill: 'currentColor' }),
          h('path', { d: 'M8 1.2v1.1M8 13.7v1.1M1.2 8h1.1M13.7 8h1.1', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        )
      }

      function Switch(props) {
        return h('button', {
          type: 'button',
          role: 'switch',
          className: 'df-switch',
          style: toggleButtonStyle(Boolean(props.checked)),
          'aria-checked': props.checked ? 'true' : 'false',
          'aria-label': props.label,
          disabled: Boolean(props.disabled),
          onClick: function () {
            props.onChange(!props.checked)
          },
        })
      }

      function FieldRow(props) {
        return h(
          'div',
          { className: 'df-field' },
          h(
            'div',
            { className: 'df-field-label' },
            h('span', { className: 'df-field-title' }, props.label),
            props.hint ? h('span', { className: 'df-field-hint' }, props.hint) : null,
          ),
          h('div', { className: 'df-field-control' }, props.children),
        )
      }

      function NumberInput(props) {
        return h('input', {
          className: 'df-number',
          type: 'number',
          inputMode: 'numeric',
          min: props.min,
          max: props.max,
          step: props.step || 1,
          value: props.value === undefined || props.value === null ? '' : String(props.value),
          'aria-label': props.label,
          disabled: Boolean(props.disabled),
          onChange: function (event) {
            const raw = event.target.value
            const parsed = Number(raw)
            props.onChange(raw === '' || !Number.isFinite(parsed) ? 0 : parsed)
          },
        })
      }

      function ProgressBar(props) {
        const ratio = progressRatio(props.used, props.limit)
        const tone = props.limit <= 0 ? 'neutral' : ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warn' : 'normal'
        return h(
          'div',
          { className: 'df-progress-row' },
          h(
            'div',
            { className: 'df-progress-label' },
            h('span', null, props.label),
            h('b', null, props.valueText),
          ),
          h(
            'div',
            {
              className: 'df-progress',
              role: 'progressbar',
              'aria-label': props.label,
              'aria-valuemin': 0,
              'aria-valuemax': 100,
              'aria-valuenow': Math.round(ratio * 100),
            },
            h('div', {
              className: 'df-progress-fill',
              'data-tone': tone === 'normal' || tone === 'neutral' ? undefined : tone,
              style: { width: Math.max(0, Math.min(100, ratio * 100)) + '%' },
            }),
          ),
        )
      }

      function Section(props) {
        return h('section', { className: 'df-section' }, h('h3', { className: 'df-section-title' }, props.title), props.children)
      }

      function weekdayIndex(dayKey) {
        if (typeof dayKey === 'string') {
          const parsed = new Date(dayKey + 'T12:00:00')
          if (!Number.isNaN(parsed.getTime())) return parsed.getDay()
        }
        return new Date().getDay()
      }

      function weekdayLabel(tt, dayKey) {
        return tt('wd.' + weekdayIndex(dayKey))
      }

      function UsageTrendChart(props) {
        const days = props.days
        const topRows = props.topRows
        const tt = props.t
        if (!days || days.length === 0) return h('p', { className: 'df-usage-empty' }, tt('hub.trendEmpty'))
        const totals = days.map(function (day) {
          return Math.max(
            numberOr(day && day.activeMs, 0),
            (day && Array.isArray(day.apps) ? day.apps : []).reduce(function (sum, row) {
              return sum + numberOr(row && row.ms, 0)
            }, 0),
          )
        })
        const max = Math.max(1, ...totals)
        const height = 96
        const top = 8
        const slot = 40
        const width = slot * 7
        const barWidth = 22
        const elements = []
        for (let index = 0; index < days.length && index < 7; index += 1) {
          const day = days[index] || {}
          const x = index * slot + 9
          const byId = new Map()
          const apps = Array.isArray(day.apps) ? day.apps : []
          for (let appIndex = 0; appIndex < apps.length; appIndex += 1) {
            const row = apps[appIndex]
            if (row && typeof row.id === 'string') byId.set(row.id, (byId.get(row.id) || 0) + numberOr(row.ms, 0))
          }
          let y = top + height
          const segments = []
          let used = 0
          for (let segIndex = 0; segIndex < topRows.length; segIndex += 1) {
            const topRow = topRows[segIndex]
            const ms = byId.get(topRow.id) || 0
            if (ms <= 0) continue
            const hPx = Math.max(1, Math.round((ms / max) * height))
            y -= hPx
            used += ms
            segments.push(
              h('rect', {
                key: 'seg-' + index + '-' + segIndex,
                className: 'df-seg-' + segIndex,
                x: x,
                y: y,
                width: barWidth,
                height: hPx,
                rx: segIndex === topRows.length - 1 ? 2 : 0,
              }),
            )
          }
          const otherMs = Math.max(0, totals[index] - used)
          if (otherMs > 0) {
            const hPx = Math.max(1, Math.round((otherMs / max) * height))
            y -= hPx
            segments.push(
              h('rect', { key: 'other-' + index, className: 'df-seg-other', x: x, y: y, width: barWidth, height: hPx, rx: 2 }),
            )
          }
          elements.push(
            h(
              'g',
              { key: 'day-' + index },
              h('title', null, weekdayLabel(tt, day.day) + ' · ' + fmtDuration(tt, totals[index])),
              segments,
            ),
          )
        }
        return h(
          'div',
          { className: 'df-chart' },
          h(
            'svg',
            { viewBox: '0 0 ' + width + ' ' + (height + top + 4), role: 'img', 'aria-label': tt('hub.trend') },
            h('line', { className: 'df-usage-axis', x1: 0, y1: top + height, x2: width, y2: top + height }),
            elements,
          ),
          h(
            'div',
            { className: 'df-chart-labels' },
            days.slice(0, 7).map(function (day, index) {
              return h('span', { key: 'label-' + index }, weekdayLabel(tt, day && day.day))
            }),
          ),
        )
      }

      function segmentColor(index) {
        const tokens = [
          'var(--dsw-alias-brand-primary)',
          'var(--dsw-alias-state-success-primary)',
          'var(--dsw-alias-state-warn-primary)',
          'var(--dsw-alias-state-idle-primary)',
          'var(--dsw-alias-label-secondary)',
        ]
        return tokens[index] || 'var(--dsw-alias-border-l1)'
      }

      function UsageLegend(props) {
        const tt = props.t
        return h(
          'div',
          { className: 'df-usage-legend', role: 'list', 'aria-label': tt('hub.appsToday') },
          props.rows.map(function (row, index) {
            return h(
              'span',
              { key: row.id, role: 'listitem' },
              h('span', { className: 'df-legend-dot', style: { background: segmentColor(index) } }),
              appDisplayName(row),
            )
          }),
        )
      }

      function AppRows(props) {
        const rows = props.rows
        const tt = props.t
        if (!rows || rows.length === 0) return h('p', { className: 'df-usage-empty' }, tt('hub.noApps'))
        const max = Math.max(1, ...rows.map(function (row) { return row.ms }))
        return h(
          Fragment,
          null,
          rows.map(function (row) {
            return h(
              'div',
              { key: row.id, className: 'df-app-row' },
              h('span', { className: 'df-app-name', title: appDisplayName(row) }, appDisplayName(row)),
              h(
                'span',
                { className: 'df-app-bar' },
                h('span', { className: 'df-app-bar-fill', style: { width: Math.max(2, Math.round((row.ms / max) * 100)) + '%' } }),
              ),
              h('span', { className: 'df-app-time' }, fmtAppTime(row.ms)),
            )
          }),
        )
      }

      /* ── Floating dual-ring widget (top-right) + pause overlay ── */

      function Ring(props) {
        const radius = 14
        const circumference = 2 * Math.PI * radius
        const ratio = props.limit > 0 ? Math.min(1, Math.max(0, numberOr(props.used, 0) / props.limit)) : 0
        return h(
          'span',
          {
            className: 'df-ring',
            'data-kind': props.kind,
            'data-tone': props.tone === 'normal' ? undefined : props.tone,
            'aria-hidden': 'true',
          },
          h(
            'svg',
            { viewBox: '0 0 34 34' },
            h('circle', { className: 'df-ring-track', cx: 17, cy: 17, r: radius, strokeWidth: 3 }),
            h('circle', {
              className: 'df-ring-value',
              cx: 17,
              cy: 17,
              r: radius,
              strokeWidth: 3,
              strokeDasharray: circumference.toFixed(2),
              strokeDashoffset: (circumference * (1 - ratio)).toFixed(2),
            }),
          ),
        )
      }

      /** Stand-in for a standard source hook in compositions that do not bind it. */
      function useAbsentSessionSource(selector) {
        React.useState(0)
        React.useEffect(function () {
          return undefined
        }, [])
        return selector ? selector(undefined) : undefined
      }

      function selectWholeSource(value) {
        return value
      }

      /**
       * Floating top-right widget: two SVG rings (today total vs daily cap,
       * continuous use vs continuous cap) plus a tiny summary. Clicking enters
       * the manual pause mode (POST /pause) and pauses counting; the same widget
       * resumes on click too. This always-mounted entry also feeds the
       * client-primary running-conversation detector for solo hiding.
       */
      function FloatingRings(props) {
        useLocaleTick()
        const snapshot = useStore(true)

        const useSessionsHook =
          props && typeof props.useSessions === 'function' ? props.useSessions : useAbsentSessionSource
        const useSessionStatusHook =
          props && typeof props.useSessionStatus === 'function' ? props.useSessionStatus : useAbsentSessionSource
        const sessionsSnapshot = useSessionsHook(selectWholeSource)
        const statusMap = useSessionStatusHook(selectWholeSource)
        const runningIds = runningRootIdsFrom(sessionsSnapshot, statusMap)
        const currentSessionId = useSessionsHook(function (state) {
          try {
            const byId = state && state.byId ? state.byId : null
            if (!byId) return null
            const ids = Array.isArray(state.ids) && state.ids.length > 0 ? state.ids : Object.keys(byId)
            for (let index = 0; index < ids.length; index += 1) {
              const row = byId[ids[index]]
              if (row && row.retainedBy && numberOr(row.retainedBy.mainView, 0) > 0) return ids[index]
            }
          } catch (error) {
            /* ignore */
          }
          return null
        })
        const signature = runningIds === null ? ' ' : runningIds.join('|')
        React.useEffect(
          function () {
            soloHider.setClientRunning(runningIds, currentSessionId)
            return function () {
              soloHider.setClientRunning(null, null)
            }
          },
          [signature, currentSessionId],
        )
        React.useEffect(
          function () {
            focusGuard.setContext(currentSessionId, runningIds)
            return function () {
              focusGuard.setContext(null, [])
            }
          },
          [signature, currentSessionId],
        )

        // Completion chime: fire only when the root running set goes from
        // non-empty to empty (all conversations finished), never on a partial
        // completion and never when the user is watching.
        const previousRunningRef = React.useRef(null)
        React.useEffect(
          function () {
            if (runningIds === null) {
              previousRunningRef.current = null
              return
            }
            const previous = previousRunningRef.current
            previousRunningRef.current = runningIds.slice()
            if (previous !== null && previous.length > 0 && runningIds.length === 0) {
              completionChime.triggerAllFinished()
            }
          },
          [signature],
        )

        const state = snapshot.state
        const limit = (state && state.limit) || {}
        const settings = (state && state.settings) || {}
        const assistantCfg = settings.assistant || {}
        const assistantOn = limit.assistantEnabled !== false && assistantCfg.enabled !== false
        if (!store.isVisible() || !assistantOn || assistantCfg.showRings === false) return null

        const dailyLimit = Math.max(0, numberOr(limit.dailyLimitMs, 0))
        const dailyUsed = Math.max(0, numberOr(limit.dailyUsedMs, 0))
        const continuousLimit = Math.max(0, numberOr(limit.continuousLimitMs, 0))
        const continuousUsed = Math.max(0, numberOr(limit.continuousUsedMs, 0))
        const dailyRatio = progressRatio(dailyUsed, dailyLimit)
        const continuousRatio = progressRatio(continuousUsed, continuousLimit)
        const dailyTone = dailyLimit > 0 && dailyRatio >= 1 ? 'danger' : dailyLimit > 0 && dailyRatio >= 0.9 ? 'warn' : 'normal'
        const continuousTone =
          continuousLimit > 0 && continuousRatio >= 1
            ? 'danger'
            : limit.restDue === true || (continuousLimit > 0 && continuousRatio >= 0.8)
              ? 'warn'
              : 'normal'
        const todayText = t('rings.today') + ' ' + fmtDuration(t, dailyUsed)
        const continuousText =
          continuousLimit > 0 ? t('rings.continuous') + ' ' + fmtClock(continuousUsed) : t('rings.continuous') + ' —'
        const summary = t('rings.summary', {
          today: fmtDuration(t, dailyUsed),
          continuous: continuousLimit > 0 ? fmtClock(continuousUsed) : '—',
        })

        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            { className: 'df-rings-layer', 'data-df-root': 'rings-layer' },
            h(
              'div',
              {
                className: 'df-rings',
                'data-df-root': 'rings',
                'data-dsh-deep-focus-root': 'rings',
                role: 'img',
                'aria-label': t('rings.aria', {
                  today: fmtDuration(t, dailyUsed),
                  continuous: continuousLimit > 0 ? fmtClock(continuousUsed) : '—',
                }),
                title: summary,
                style: {
                  appearance: 'none',
                  borderStyle: 'solid',
                  borderColor: 'var(--dsw-alias-border-l1)',
                  color: 'var(--dsw-alias-label-primary)',
                  font: 'inherit',
                  background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1) 88%, transparent)',
                  cursor: 'default',
                },
              },
              h(Ring, { kind: 'daily', used: dailyUsed, limit: dailyLimit, tone: dailyTone }),
              h(Ring, { kind: 'continuous', used: continuousUsed, limit: continuousLimit, tone: continuousTone }),
              h('span', { className: 'df-rings-text' }, h('b', null, todayText), h('span', null, continuousText)),
            ),
          ),
        )
      }

      function useFocusGuardTick() {
        const pair = React.useState(0)
        const force = pair[1]
        React.useEffect(function () {
          return focusGuard.subscribe(function () {
            force(function (value) {
              return value + 1
            })
          })
        }, [])
      }

      /** Fallback veil over the conversation column while a non-owner session shows. */
      function FocusVeil() {
        useLocaleTick()
        const snapshot = useStore(false)
        useFocusGuardTick()
        const info = focusGuard.getInfo()
        const visible = Boolean(store.isVisible() && info.veilNeeded)
        const leftPair = React.useState(0)
        const left = leftPair[0]
        const setLeft = leftPair[1]

        React.useEffect(
          function () {
            if (!visible) return undefined
            const measure = function () {
              try {
                const sidebar = document.querySelector('[class*="sidebarCol"]')
                const rect = sidebar && typeof sidebar.getBoundingClientRect === 'function' ? sidebar.getBoundingClientRect() : null
                setLeft(rect && Number.isFinite(rect.right) ? Math.max(0, Math.round(rect.right)) : 0)
              } catch (error) {
                setLeft(0)
              }
            }
            measure()
            try {
              window.addEventListener('resize', measure)
            } catch (error) {
              /* ignored */
            }
            return function () {
              try {
                window.removeEventListener('resize', measure)
              } catch (error) {
                /* ignored */
              }
            }
          },
          [visible],
        )

        React.useEffect(
          function () {
            if (!visible) return undefined
            const onKeyDown = function (event) {
              if (event.key !== 'Enter') return
              const target = event.target
              if (!target) return
              const editable =
                target.tagName === 'TEXTAREA' ||
                (target.tagName === 'INPUT' && (target.type === 'text' || target.type === 'search')) ||
                target.isContentEditable === true ||
                target.getAttribute('contenteditable') === 'true' ||
                target.getAttribute('contenteditable') === ''
              if (!editable) return
              event.preventDefault()
              event.stopPropagation()
              store.pushToast('gentle-switch', t('veil.blocked'))
            }
            const onClick = function (event) {
              let element = event.target
              for (let depth = 0; element && depth < 10; depth += 1, element = element.parentElement) {
                if (!element || typeof element.getAttribute !== 'function') continue
                if (element.getAttribute('data-dsh-deep-focus-root') !== null) return
                const label = element.getAttribute('aria-label')
                if (label && /send|发送/i.test(label)) {
                  event.preventDefault()
                  event.stopPropagation()
                  store.pushToast('gentle-switch', t('veil.blocked'))
                  return
                }
              }
            }
            try {
              document.addEventListener('keydown', onKeyDown, true)
              document.addEventListener('click', onClick, true)
            } catch (error) {
              /* ignored */
            }
            return function () {
              try {
                document.removeEventListener('keydown', onKeyDown, true)
                document.removeEventListener('click', onClick, true)
              } catch (error) {
                /* ignored */
              }
            }
          },
          [visible],
        )

        if (!visible) return null
        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            { className: 'df-veil-layer', 'data-df-root': 'veil-layer' },
            h('div', { className: 'df-veil', style: { left: left + 'px' }, 'data-dsh-deep-focus-root': 'veil', 'aria-hidden': 'true' }),
            h(
              'div',
              { className: 'df-veil-hint', 'data-dsh-deep-focus-root': 'veil-hint', role: 'status', 'aria-live': 'polite', 'aria-label': t('veil.aria') },
              t('veil.hint'),
            ),
          ),
        )
      }

      /** Pause screen: the same TodayUsageCard as rest/daily, with no actions. */
      function PauseOverlay() {
        useLocaleTick()
        const snapshot = useStore(true)
        const state = snapshot.state
        const limit = state && state.limit
        const paused = Boolean(store.isVisible() && limit && limit.paused === true)
        const resumingPair = React.useState(false)
        const resuming = resumingPair[0]
        const setResuming = resumingPair[1]

        React.useEffect(
          function () {
            if (!paused) return undefined
            const pausedAt = toTimestamp(limit && limit.pausedAt)
            const graceUntil =
              pausedAt === null ? Date.now() + 1500 : pausedAt + 1500 - numberOr(snapshot.clockOffset, 0)
            let used = false
            const onActivity = function () {
              if (used || Date.now() < graceUntil) return
              used = true
              setResuming(true)
              Promise.resolve(store.resume()).catch(function () {}).then(function () {
                setResuming(false)
              })
            }
            const events = ['mousemove', 'keydown', 'pointerdown']
            try {
              events.forEach(function (name) {
                document.addEventListener(name, onActivity, true)
              })
            } catch (error) {
              /* ignored */
            }
            return function () {
              try {
                events.forEach(function (name) {
                  document.removeEventListener(name, onActivity, true)
                })
              } catch (error) {
                /* ignored */
              }
            }
          },
          [paused, limit && limit.pausedAt],
        )

        if (!paused) return null
        const usedMs = Math.max(0, numberOr(limit.dailyUsedMs, numberOr(state.usage && state.usage.activeTodayMs, 0)))
        const apps = todayAppsFromState(state)
        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            {
              className: 'df-overlay',
              style: { pointerEvents: 'none', zIndex: 118 },
              'data-df-root': 'pause',
              'data-dsh-deep-focus-root': 'pause',
              role: 'status',
              'aria-live': 'polite',
              'aria-label': t('pause.aria'),
            },
            h(TodayUsageCard, {
              t: t,
              title: t('pause.title'),
              reason: resuming ? t('rings.busy') : t('pause.hint'),
              usedMs: usedMs,
              rows: apps,
              actions: [],
              root: 'pause-card',
              role: 'status',
            }),
          ),
        )
      }

      /* ── Daily overtime overlay ──────────────────────────────────────── */

      /** One shared "today usage" card for the daily-limit and forced-rest overlays. */
      function TodayUsageCard(props) {
        const tt = props.t
        return h(
          'div',
          {
            className: 'df-card df-today-card',
            ref: props.cardRef,
            role: props.role || 'dialog',
            'aria-modal': props.role ? undefined : 'true',
            'aria-label': props.title,
            tabIndex: -1,
            'data-dsh-deep-focus-root': props.root || 'today-card',
          },
          h('h2', { className: 'df-overlay-title' }, props.title),
          props.reason ? h('p', { className: 'df-overlay-reason' }, props.reason) : null,
          h('div', { className: 'df-kv' }, h('span', null, tt('today.total')), h('b', null, fmtDuration(tt, props.usedMs))),
          h('hr', { className: 'df-divider' }),
          h('p', { className: 'df-muted' }, tt('daily.apps')),
          h(AppRows, { t: tt, rows: props.rows }),
          props.extra || null,
          props.error ? h('p', { className: 'df-error', role: 'alert' }, props.error) : null,
          h('div', { className: 'df-actions', style: { justifyContent: 'flex-end' } }, props.actions),
          props.footer || null,
        )
      }

      /** Best-effort foreground helper: a pure plugin cannot force the OS window. */
      let dailyNotificationPermissionAsked = false

      function DailyLockOverlay() {
        useLocaleTick()
        const snapshot = useStore(false)
        const state = snapshot.state
        const limit = state && state.limit
        const dayKey = state && state.usage ? state.usage.dayKey : null
        const locked = Boolean(store.isVisible() && limit && limit.dailyLocked === true)
        const acked = store.isAcked(dayKey)
        const busyPair = React.useState(false)
        const busy = busyPair[0]
        const setBusy = busyPair[1]
        const errorPair = React.useState(null)
        const error = errorPair[0]
        const setError = errorPair[1]
        const cardRef = React.useRef(null)
        const notifiedRef = React.useRef(false)

        React.useEffect(
          function () {
            if (!locked || acked) {
              notifiedRef.current = false
              return
            }
            if (notifiedRef.current) return
            notifiedRef.current = true
            // Best effort only: a pure plugin cannot force the OS foreground
            // window. We try window.focus(), one system notification and one ring.
            try {
              window.focus()
            } catch (error) {
              /* ignored */
            }
            const alerts = (state.settings && state.settings.alerts) || {}
            if (alerts.sound !== false) {
              try {
                audio.chime(numberOr(alerts.volume, 0.6))
              } catch (error) {
                /* ignored */
              }
            }
            try {
              if (typeof Notification !== 'undefined') {
                const show = function () {
                  try {
                    const notification = new Notification(t('daily.notify'))
                    notification.onclick = function () {
                      try {
                        window.focus()
                      } catch (error) {
                        /* ignored */
                      }
                      try {
                        notification.close()
                      } catch (error) {
                        /* ignored */
                      }
                    }
                  } catch (error) {
                    /* notifications may be unavailable */
                  }
                }
                if (Notification.permission === 'granted') {
                  show()
                } else if (Notification.permission === 'default' && !dailyNotificationPermissionAsked) {
                  dailyNotificationPermissionAsked = true
                  Promise.resolve(Notification.requestPermission())
                    .then(function (result) {
                      if (result === 'granted') show()
                    })
                    .catch(function () {})
                }
              }
            } catch (error) {
              /* ignored */
            }
          },
          [locked, acked],
        )

        React.useEffect(
          function () {
            if (!locked || acked) return undefined
            const card = cardRef.current
            if (card && typeof card.focus === 'function') {
              try {
                card.focus({ preventScroll: true })
              } catch (caught) {
                /* ignored */
              }
            }
            return undefined
          },
          [locked, acked],
        )

        if (!locked || acked) return null

        const settings = state.settings || {}
        const limits = settings.limits || {}
        const extendMinutes = clampNumber(limits.extendMinutes, 1, 120, 20)
        const extendLimitCount = Math.max(0, numberOr(limit.extendLimit, 0))
        const unlimitedExtend = extendLimitCount <= 0
        const extendUsed = Math.max(0, numberOr(limit.extendCountToday, 0))
        const remaining = unlimitedExtend ? null : Math.max(0, extendLimitCount - extendUsed)
        const usedMs = Math.max(0, numberOr(limit.dailyUsedMs, numberOr(state.usage && state.usage.activeTodayMs, 0)))
        const apps = todayAppsFromState(state)

        async function doExtend() {
          if (busy) return
          setBusy(true)
          setError(null)
          const result = await store.extend()
          setBusy(false)
          if (!result.ok) {
            const code = result.data && result.data.error && result.data.error.code
            setError(code === 'extend-limit-reached' ? t('error.extendLimit') : t('daily.error'))
          }
        }

        const actions = [
          h(
            'button',
            {
              key: 'skip',
              type: 'button',
              className: 'df-btn',
              style: secondaryButtonStyle(),
              disabled: busy,
              onClick: function () {
                if (dayKey) store.ackToday(dayKey)
              },
            },
            t('daily.skip'),
          ),
          h(
            'button',
            {
              key: 'extend',
              type: 'button',
              className: 'df-btn df-btn-primary',
              style: primaryButtonStyle(),
              disabled: busy,
              onClick: doExtend,
              'data-df-autofocus': '',
            },
            t('daily.extend', { n: extendMinutes }),
          ),
        ]

        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            { className: 'df-overlay', 'data-df-root': 'daily-lock', 'data-dsh-deep-focus-root': 'daily-lock', role: 'presentation' },
            h(TodayUsageCard, {
              t: t,
              title: t('daily.title'),
              reason: t('daily.reason'),
              usedMs: usedMs,
              rows: apps,
              actions: actions,
              error: error,
              cardRef: cardRef,
              root: 'daily-card',
              extra: unlimitedExtend
                ? null
                : h(
                    'p',
                    { className: 'df-muted' },
                    remaining > 0 ? t('daily.extendRemaining', { n: remaining }) : t('daily.extendNone'),
                  ),
              footer: h('p', { className: 'df-muted' }, t('daily.skipHint')),
            }),
          ),
        )
      }

      /* ── Forced-rest full screen (skip + away waiting) ── */

      function RestOverlay() {
        useLocaleTick()
        const snapshot = useStore(true)
        const state = snapshot.state
        const limit = state && state.limit
        const resting = Boolean(store.isVisible() && limit && limit.resting === true)
        const cardRef = React.useRef(null)
        const busyPair = React.useState(false)
        const busy = busyPair[0]
        const setBusy = busyPair[1]

        React.useEffect(
          function () {
            if (!resting) return undefined
            const card = cardRef.current
            if (card && typeof card.focus === 'function') {
              try {
                card.focus({ preventScroll: true })
              } catch (caught) {
                /* ignored */
              }
            }
            return undefined
          },
          [resting],
        )

        if (!resting) return null
        const remaining = restRemainingMs(limit, snapshot.clockOffset)
        const needsActivity = limit.restNeedsActivity === true || remaining <= 0
        const usedMs = Math.max(
          0,
          numberOr(limit.dailyUsedMs, numberOr(state.usage && state.usage.activeTodayMs, 0)),
        )
        const apps = todayAppsFromState(state)

        async function skipRest() {
          if (busy) return
          setBusy(true)
          const result = await store.finishRest()
          setBusy(false)
          if (result.ok) store.pushToast('rest-skipped', t('rest.thenRestart'))
        }

        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            { className: 'df-rest', 'data-df-root': 'rest', 'data-dsh-deep-focus-root': 'rest', role: 'presentation' },
            h(TodayUsageCard, {
              t: t,
              title: t('rest.title'),
              reason: t('rest.body'),
              usedMs: usedMs,
              rows: apps,
              cardRef: cardRef,
              root: 'rest-card',
              extra: needsActivity
                ? h('p', { className: 'df-rest-body', role: 'status', 'aria-live': 'polite' }, t('rest.doneWaiting'))
                : h(
                    'p',
                    {
                      className: 'df-rest-time',
                      'aria-live': 'polite',
                      'aria-label': t('rest.aria', { time: fmtClock(remaining) }),
                    },
                    fmtClock(remaining),
                  ),
              actions: [
                h(
                  'button',
                  {
                    key: 'skip',
                    type: 'button',
                    className: 'df-btn',
                    style: secondaryButtonStyle(),
                    disabled: busy,
                    onClick: skipRest,
                  },
                  t('rest.skip'),
                ),
              ],
              footer: h(
                'p',
                { className: 'df-muted' },
                needsActivity ? t('rest.waitingNote') + ' ' + t('rest.auto') : t('rest.auto'),
              ),
            }),
          ),
        )
      }


      /* ── Toasts ──────────────────────────────────────────────────────── */

      function Toasts() {
        const snapshot = useStore(false)
        if (!store.isVisible() || snapshot.toasts.length === 0) return null
        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            {
              className: 'df-toasts',
              'data-df-root': 'toasts',
              'data-dsh-deep-focus-root': 'toasts',
              'aria-live': 'polite',
              role: 'status',
              style: { pointerEvents: 'none' },
            },
            snapshot.toasts.map(function (toast) {
              return h('div', { key: toast.id, className: 'df-toast', 'data-kind': toast.kind }, toast.text)
            }),
          ),
        )
      }

      /* ── Focus assistant hub page (keyed `main`) ─────────────────────── */

      function AssistantPage() {
        useLocaleTick()
        const snapshot = useStore(true)
        const state = snapshot.state
        const dayKey = state && state.usage ? state.usage.dayKey : null
        const draftState = React.useState(null)
        const draft = draftState[0]
        const setDraft = draftState[1]
        const cleanRef = React.useRef(null)
        const signatureRef = React.useRef('')
        const draftRef = React.useRef(null)
        draftRef.current = draft
        const savingState = React.useState(false)
        const saving = savingState[0]
        const setSaving = savingState[1]
        const saveErrorState = React.useState(null)
        const saveError = saveErrorState[0]
        const setSaveError = saveErrorState[1]
        const savedState = React.useState(false)
        const saved = savedState[0]
        const setSaved = savedState[1]
        const assistantBusyState = React.useState(false)
        const assistantBusy = assistantBusyState[0]
        const setAssistantBusy = assistantBusyState[1]
        const assistantErrorState = React.useState(null)
        const assistantError = assistantErrorState[0]
        const setAssistantError = assistantErrorState[1]

        React.useEffect(
          function () {
            if (!store.isVisible()) return
            store.loadAppsTrend()
          },
          [],
        )

        React.useEffect(
          function () {
            if (!store.isVisible()) return
            store.loadAppsTrend(true)
          },
          [dayKey],
        )

        const settings = state && state.settings
        React.useEffect(
          function () {
            if (!settings) return
            let signature = ''
            try {
              signature = JSON.stringify(settings)
            } catch (error) {
              signature = ''
            }
            if (signature === signatureRef.current) return
            signatureRef.current = signature
            const current = draftRef.current
            const clean = cleanRef.current
            if (current && clean && JSON.stringify(current) !== JSON.stringify(clean)) return
            cleanRef.current = deepClone(settings)
            setDraft(deepClone(settings))
          },
          [settings],
        )

        if (!store.isVisible()) return null

        const limit = (state && state.limit) || {}
        const alertsCfg = (state && state.settings && state.settings.alerts) || {}
        const limitsCfg = (state && state.settings && state.settings.limits) || {}
        const assistantCfg = (state && state.settings && state.settings.assistant) || {}
        const usageCfg = (state && state.settings && state.settings.usage) || {}
        const apps = todayAppsFromState(state)
        const appsTotal = todayAppsTotal(state)
        const dailyLimit = numberOr(limit.dailyLimitMs, numberOr(limitsCfg.dailyMinutes, 0) * 60000)
        const dailyUsed = Math.max(0, numberOr(limit.dailyUsedMs, numberOr(state && state.usage && state.usage.activeTodayMs, 0)))
        const continuousLimit = numberOr(limit.continuousLimitMs, numberOr(limitsCfg.continuousMinutes, 0) * 60000)
        const continuousUsed = Math.max(0, numberOr(limit.continuousUsedMs, 0))
        const resting = limit.resting === true
        const restRemaining = restRemainingMs(limit, snapshot.clockOffset)
        const extendLeft = extendRemaining(limit)
        const assistantOn = limit.assistantEnabled !== false && assistantCfg.enabled !== false
        const trend = snapshot.appsTrend
        const trendDays = trend && Array.isArray(trend.days) ? trend.days.slice(-7) : []
        const trendTop = trend && Array.isArray(trend.top) && trend.top.length > 0 ? trend.top : apps
        const trendTopRows = trendTop.slice(0, TREND_SEGMENTS)
        const sampling = state && state.usage ? state.usage.sampling : null
        const appsSampling = state && state.usage ? state.usage.appsSampling : null

        function statusText() {
          if (!assistantOn) return t('hub.status.offNote')
          if (resting) return t('hub.status.resting', { time: fmtClock(restRemaining) })
          const parts = []
          if (limit.paused === true) {
            parts.push(limit.pausedReason === 'idle' ? t('pause.autoTitle') : t('pause.title'))
          }
          parts.push(
            dailyLimit > 0
              ? t('hub.status.daily', { used: fmtDuration(t, dailyUsed), limit: fmtDuration(t, dailyLimit) })
              : t('hub.status.dailyUnlimited', { used: fmtDuration(t, dailyUsed) }),
          )
          if (continuousLimit > 0) {
            parts.push(t('hub.status.continuous', { used: fmtClock(continuousUsed), limit: fmtDuration(t, continuousLimit) }))
          } else {
            parts.push(t('hub.status.continuousOff'))
          }
          if (limit.dailyLocked === true) {
            const extendLimitCount = Math.max(0, numberOr(limit.extendLimit, 0))
            parts.push(
              extendLimitCount > 0 && extendLeft > 0
                ? t('hub.status.dailyLocked', { n: extendLeft })
                : t('hub.status.dailyLockedNone'),
            )
          } else if (limit.restDue === true) {
            parts.push(t('hub.status.restDue'))
          }
          return parts.join(' · ')
        }

        async function toggleAssistant() {
          if (assistantBusy) return
          setAssistantBusy(true)
          setAssistantError(null)
          const result = await store.setAssistant(!assistantOn)
          setAssistantBusy(false)
          if (!result.ok) setAssistantError(t('hub.saveFailed'))
        }

        function patch(path, value) {
          setDraft(function (previous) {
            const next = deepClone(previous || {})
            const parts = String(path).split('.')
            let node = next
            for (let index = 0; index < parts.length - 1; index += 1) {
              if (!node[parts[index]] || typeof node[parts[index]] !== 'object') node[parts[index]] = {}
              node = node[parts[index]]
            }
            node[parts[parts.length - 1]] = value
            return next
          })
          setSaved(false)
        }

        async function save() {
          if (!draft || saving) return
          setSaving(true)
          setSaveError(null)
          // The header switch owns assistant.enabled via POST /assistant; never
          // let a stale form draft flip it back during a settings save.
          const payload = deepClone(draft)
          if (!payload.assistant || typeof payload.assistant !== 'object') payload.assistant = {}
          payload.assistant.enabled = limit.assistantEnabled !== false
          const result = await store.saveSettings(payload)
          setSaving(false)
          if (result.ok) {
            const next = result.data && result.data.settings ? deepClone(result.data.settings) : deepClone(draft)
            cleanRef.current = next
            signatureRef.current = (function () {
              try {
                return JSON.stringify(next)
              } catch (error) {
                return ''
              }
            })()
            setDraft(deepClone(next))
            setSaved(true)
            setTimeout(function () {
              setSaved(false)
            }, 2500)
          } else {
            const code = result.data && result.data.error && result.data.error.code
            setSaveError(code === 'invalid-settings' ? t('hub.invalid') : t('hub.saveFailed'))
          }
        }

        function discard() {
          if (!cleanRef.current) return
          setDraft(deepClone(cleanRef.current))
          setSaveError(null)
        }

        if (!draft) {
          return h(
            Fragment,
            null,
            h(Styles),
            h(
              'div',
              { className: 'df-hub', 'data-df-root': 'hub', 'data-dsh-deep-focus-root': 'hub' },
              h(
                'div',
                { className: 'df-hub-inner' },
                h('h2', { className: 'df-hub-title' }, t('hub.title')),
                h('p', { className: 'df-hub-sub' }, snapshot.error ? t('hub.offline') : t('settings.loading')),
              ),
            ),
          )
        }

        const dirty = JSON.stringify(draft) !== JSON.stringify(cleanRef.current)
        const disabled = saving
        const draftLimits = draft.limits || {}
        const draftAssistant = draft.assistant || {}
        const draftAlerts = draft.alerts || {}
        const draftUsage = draft.usage || {}

        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            { className: 'df-hub', 'data-df-root': 'hub', 'data-dsh-deep-focus-root': 'hub' },
            h(
              'div',
              { className: 'df-hub-inner' },
              h(
                'div',
                { className: 'df-hub-head' },
                h(
                  'div',
                  null,
                  h('h2', { className: 'df-hub-title' }, t('hub.title')),
                  h('p', { className: 'df-hub-sub' }, t('hub.subtitle')),
                ),
                h(
                  'div',
                  { className: 'df-hub-actions' },
                  h(
                    'span',
                    { className: 'df-muted' },
                    t('hub.assistant') + ' · ' + (assistantOn ? t('hub.on') : t('hub.off')),
                  ),
                  h(Switch, {
                    checked: assistantOn,
                    label: t('hub.assistant'),
                    disabled: assistantBusy,
                    onChange: toggleAssistant,
                  }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'df-btn df-btn-sm',
                      style: smallButtonStyle(),
                      onClick: function () {
                        store.refreshSoon()
                        store.loadAppsTrend(true)
                      },
                    },
                    h(IconRefresh),
                    t('hub.refresh'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'df-btn df-btn-sm df-btn-ghost',
                      style: smallButtonStyle(),
                      onClick: function () {
                        selectConversationPanel()
                      },
                    },
                    t('hub.back'),
                  ),
                ),
              ),
              h('div', { className: 'df-hub-status' }, statusText()),
              assistantError ? h('p', { className: 'df-error', role: 'alert' }, assistantError) : null,
              !assistantOn ? h('p', { className: 'df-hub-paused' }, t('hub.enableHint')) : null,
              h('div', { className: 'df-section-title' }, t('hub.section.overview')),
              h(
                Section,
                { title: t('hub.dailyBar') },
                h(ProgressBar, {
                  label: t('hub.dailyBar'),
                  used: dailyUsed,
                  limit: dailyLimit,
                  valueText:
                    dailyLimit > 0
                      ? fmtDuration(t, dailyUsed) + ' / ' + fmtDuration(t, dailyLimit)
                      : fmtDuration(t, dailyUsed) + ' / ' + t('settings.hintZeroUnlimited'),
                }),
                h(ProgressBar, {
                  label: t('hub.continuousBar'),
                  used: continuousUsed,
                  limit: continuousLimit,
                  valueText:
                    continuousLimit > 0
                      ? fmtClock(continuousUsed) + ' / ' + fmtDuration(t, continuousLimit)
                      : t('hub.status.continuousOff'),
                }),
                h(
                  'div',
                  { className: 'df-kv' },
                  h('span', null, t('hub.restCard')),
                  h('span', null, h('b', null, resting ? t('hub.restNow') + ' · ' + fmtClock(restRemaining) : t('hub.restAvailable'))),
                ),
                h(
                  'div',
                  { className: 'df-kv' },
                  h('span', null, t('hub.todayAppsTotal', { time: fmtDuration(t, appsTotal) })),
                  h('span', null, resting ? t('hub.restNow') : t('hub.status.rest')),
                ),
              ),
              h(
                Section,
                { title: t('hub.appsToday') },
                h('p', { className: 'df-usage-note' }, t('hub.privacy')),
                appsSampling === 'off' ? h('p', { className: 'df-usage-note', role: 'status' }, t('settings.appsSampling.off')) : null,
                h(AppRows, { t: t, rows: apps }),
              ),
              h(
                Section,
                { title: t('hub.trend') },
                snapshot.appsLoading && !trend
                  ? h('p', { className: 'df-usage-empty' }, t('hub.loading'))
                  : snapshot.appsError && !trend
                    ? h('p', { className: 'df-usage-empty', role: 'status' }, t('hub.offline'))
                    : h(UsageTrendChart, { t: t, days: trendDays, topRows: trendTopRows }),
                trendDays.length > 0 && trendTopRows.length > 0 ? h(UsageLegend, { t: t, rows: trendTopRows }) : null,
              ),
              h('div', { className: 'df-section-title' }, t('hub.section.settings')),
              h(
                Section,
                { title: t('group.limits') },
                h(
                  FieldRow,
                  { label: t('field.dailyMinutes'), hint: t('field.dailyMinutes.hint') },
                  h(NumberInput, {
                    value: draftLimits.dailyMinutes,
                    min: 0,
                    max: 1440,
                    step: 5,
                    label: t('field.dailyMinutes'),
                    disabled: disabled,
                    onChange: function (value) {
                      patch('limits.dailyMinutes', value)
                    },
                  }),
                ),
                h(
                  FieldRow,
                  { label: t('field.continuousMinutes'), hint: t('field.continuousMinutes.hint') },
                  h(NumberInput, {
                    value: draftLimits.continuousMinutes,
                    min: 0,
                    max: 1440,
                    step: 5,
                    label: t('field.continuousMinutes'),
                    disabled: disabled,
                    onChange: function (value) {
                      patch('limits.continuousMinutes', value)
                    },
                  }),
                ),
                h(
                  FieldRow,
                  { label: t('field.restMinutes'), hint: t('field.restMinutes.hint') },
                  h(NumberInput, {
                    value: draftLimits.restMinutes,
                    min: 1,
                    max: 120,
                    step: 5,
                    label: t('field.restMinutes'),
                    disabled: disabled,
                    onChange: function (value) {
                      patch('limits.restMinutes', value)
                    },
                  }),
                ),
                h(
                  FieldRow,
                  { label: t('field.extendMinutes'), hint: t('field.extendMinutes.hint') },
                  h(NumberInput, {
                    value: draftLimits.extendMinutes,
                    min: 1,
                    max: 120,
                    step: 5,
                    label: t('field.extendMinutes'),
                    disabled: disabled,
                    onChange: function (value) {
                      patch('limits.extendMinutes', value)
                    },
                  }),
                ),
                h(
                  FieldRow,
                  { label: t('field.autoPauseSeconds'), hint: t('field.autoPauseSeconds.hint') },
                  h(NumberInput, {
                    value: draftUsage.autoPauseSeconds,
                    min: 0,
                    max: 3600,
                    step: 5,
                    label: t('field.autoPauseSeconds'),
                    disabled: disabled,
                    onChange: function (value) {
                      patch('usage.autoPauseSeconds', value)
                    },
                  }),
                ),
              ),
              h(
                Section,
                { title: t('group.alerts') },
                h(
                  FieldRow,
                  { label: t('field.sound') },
                  h(Switch, {
                    checked: Boolean(draftAlerts.sound),
                    label: t('field.sound'),
                    disabled: disabled,
                    onChange: function (value) {
                      patch('alerts.sound', value)
                    },
                  }),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'df-btn df-btn-ghost',
                      style: secondaryButtonStyle({ height: '30px', padding: '0 10px', fontSize: '12px' }),
                      disabled: disabled,
                      onClick: function () {
                        audio.unlock()
                        audio.chime(numberOr(draftAlerts.volume, 0.6))
                      },
                    },
                    t('settings.preview'),
                  ),
                ),
                h(
                  FieldRow,
                  { label: t('field.trackApps'), hint: t('field.trackApps.hint') },
                  h(Switch, {
                    checked: draftUsage.trackApps !== false,
                    label: t('field.trackApps'),
                    disabled: disabled,
                    onChange: function (value) {
                      patch('usage.trackApps', value)
                    },
                  }),
                ),
              ),
              h(
                Section,
                { title: t('group.focus') },
                h(
                  FieldRow,
                  { label: t('field.soloSession') },
                  h(Switch, {
                    checked: draftAssistant.soloSession !== false,
                    label: t('field.soloSession'),
                    disabled: disabled,
                    onChange: function (value) {
                      patch('assistant.soloSession', value)
                      patch('assistant.hideOtherSessions', value)
                    },
                  }),
                ),
              ),
              h('p', { className: 'df-field-hint' }, t('hub.privacy')),
              h(
                'div',
                { className: 'df-savebar' },
                h(
                  'div',
                  { className: 'df-savebar-actions' },
                  saving
                    ? h('span', { className: 'df-save-state' }, '…')
                    : saveError
                      ? h('span', { className: 'df-save-state', 'data-kind': 'error', role: 'alert' }, saveError)
                      : saved
                        ? h('span', { className: 'df-save-state', 'data-kind': 'saved' }, t('hub.saved'))
                        : dirty
                          ? h('span', { className: 'df-save-state' }, t('hub.dirty'))
                          : null,
                  dirty
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'df-btn',
                          style: secondaryButtonStyle(),
                          disabled: saving,
                          onClick: discard,
                        },
                        t('hub.discard'),
                      )
                    : null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'df-btn df-btn-primary',
                      style: primaryButtonStyle(),
                      disabled: !dirty || saving,
                      onClick: save,
                    },
                    t('hub.save'),
                  ),
                ),
              ),
            ),
          ),
        )
      }

      return {
        t: t,
        store: store,
        start: start,
        components: {
          FloatingRings: FloatingRings,
          FocusVeil: FocusVeil,
          PauseOverlay: PauseOverlay,
          DailyLockOverlay: DailyLockOverlay,
          RestOverlay: RestOverlay,
          Toasts: Toasts,
          AssistantIcon: AssistantIcon,
          AssistantPage: AssistantPage,
        },
      }
    }

    /* ── Plugin entry ──────────────────────────────────────────────────── */

    const runtime = {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // Undo any leftovers from a previously loaded generation first: the app
        // must be fully usable even if that old bundle never cleaned up.
        selfHealPreviousGeneration(ctx)

        const client = createRuntime(ctx)

        try {
          ctx.effect(function () {
            return ctx.locale.register(NS, { zh: I18N.zh, en: I18N.en })
          }, 'dsh-deep-focus: dictionaries')
        } catch (error) {
          /* a missing locale service keeps the English fallback */
        }

        try {
          ctx.effect(function () {
            return client.start()
          }, 'dsh-deep-focus: polling, solo hiding and sound')
        } catch (error) {
          /* the store is defensive; slots still register */
        }

        function registerSlot(slotName, options, Component) {
          try {
            const dispose = ctx.slots.inject(slotName, function () {
              return ctx.slots.register(options, Component)
            })
            return typeof dispose === 'function' ? dispose : function () {}
          } catch (error) {
            return function () {}
          }
        }

        // Always-present entries: they render nothing while the Host is unavailable.
        const staticEntries = [
          ['shell.overlay', { name: 'shell.overlay', id: 'dsh-deep-focus-rings', order: 70 }, client.components.FloatingRings],
          ['shell.overlay', { name: 'shell.overlay', id: 'dsh-deep-focus-toasts', order: 90 }, client.components.Toasts],
          ['shell.overlay', { name: 'shell.overlay', id: 'dsh-deep-focus-daily-lock', order: 100 }, client.components.DailyLockOverlay],
          ['shell.overlay', { name: 'shell.overlay', id: 'dsh-deep-focus-rest', order: 110 }, client.components.RestOverlay],
          ['shell.overlay', { name: 'shell.overlay', id: 'dsh-deep-focus-focus-veil', order: 114 }, client.components.FocusVeil],
          ['shell.overlay', { name: 'shell.overlay', id: 'dsh-deep-focus-pause-gray', order: 118 }, client.components.PauseOverlay],
        ]
        staticEntries.forEach(function (entry) {
          try {
            ctx.effect(function () {
              return registerSlot(entry[0], entry[1], entry[2])
            }, 'dsh-deep-focus: ' + entry[1].id)
          } catch (error) {
            /* never let one slot registration break the plugin row */
          }
        })

        // Navigable entries are registered only while the Host API is live, so a
        // disabled/unreachable Host leaves no empty pages or dead sidebar rows.
        const navigableEntries = [
          [
            'sidebar.panellist',
            {
              name: 'sidebar.panellist',
              id: 'focus-assistant',
              order: 10,
              label: function () {
                try {
                  return client.t('hub.title')
                } catch (error) {
                  return 'Focus assistant'
                }
              },
            },
            client.components.AssistantIcon,
          ],
          ['main', { name: 'main', key: 'focus-assistant' }, client.components.AssistantPage],
        ]
        let navigableDisposers = []
        function syncNavigableEntries() {
          const live = client.store.isVisible()
          if (live && navigableDisposers.length === 0) {
            navigableDisposers = navigableEntries.map(function (entry) {
              return registerSlot(entry[0], entry[1], entry[2])
            })
            return
          }
          if (!live && navigableDisposers.length > 0) {
            const pending = navigableDisposers
            navigableDisposers = []
            pending.forEach(function (dispose) {
              try {
                dispose()
              } catch (error) {
                /* ignored */
              }
            })
          }
        }
        try {
          ctx.effect(function () {
            const unsubscribe = client.store.subscribe(syncNavigableEntries)
            syncNavigableEntries()
            return function () {
              unsubscribe()
              const pending = navigableDisposers
              navigableDisposers = []
              pending.forEach(function (dispose) {
                try {
                  dispose()
                } catch (error) {
                  /* ignored */
                }
              })
            }
          }, 'dsh-deep-focus: navigable entries')
        } catch (error) {
          /* static entries still render */
        }
      },
    }

    return runtime
  },
})
