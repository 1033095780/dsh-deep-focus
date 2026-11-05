/**
 * dsh-deep-focus — browser half v0.2 (single self-contained Client bundle).
 *
 * v0.2 is intentionally gentle: no tool blocking, no passwords, no lock screens
 * that trap the user. Focus mode only grays the sidebar (one injected CSS rule,
 * no inline styles, no pointer-events changes) and nudges on click; the headline
 * feature is per-application usage stats. When the Host is unreachable every
 * entry renders nothing and all DOM effects are torn down synchronously.
 *
 * Safety contract: this bundle never wraps or replaces a host service. On apply
 * it first repairs leftovers from a previously loaded generation (leaked
 * wrappers if they saved their original, inline dim marks, stale style nodes and
 * `data-dsh-focus-*` attributes), so a disabled/crashed old load can never leave
 * the sidebar unclickable.
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

    /* ── Wire contract (v2) ───────────────────────────────────────────────
     * Small copy of src/shared/contract.js — keep routes, event kinds and
     * setting names in sync when the shared contract changes. */
    const API_BASE = '/plugins/dsh-deep-focus/api'
    const ROUTES = {
      state: API_BASE + '/state',
      stats: API_BASE + '/stats',
      apps: API_BASE + '/apps',
      settings: API_BASE + '/settings',
      focusStart: API_BASE + '/focus/start',
      focusPause: API_BASE + '/focus/pause',
      focusResume: API_BASE + '/focus/resume',
      focusStop: API_BASE + '/focus/stop',
      focusComplete: API_BASE + '/focus/complete',
      unlock: API_BASE + '/unlock',
    }
    const EVENT = {
      focusStarted: 'focus-started',
      focusCompleted: 'focus-completed',
      breakCompleted: 'break-completed',
      taskCompleted: 'task-completed',
      focusStopped: 'focus-stopped',
      locked: 'locked',
      unlocked: 'unlocked',
      limitWarning: 'limit-warning',
    }
    const POLL_VISIBLE_MS = 1000
    const POLL_HIDDEN_MS = 5000
    const QUIET_POLL_MS = 5000
    const CLOCK_TICK_MS = 500
    const SIDE_DIM_OPACITY = '0.45'
    const MAX_ANCESTOR_DEPTH = 12
    const MAX_BLOCKED_IDS = 400
    const TOAST_MS = 4200
    const BLOCK_TOAST_THROTTLE_MS = 1500
    const MAX_TOP_APPS = 8
    const TREND_SEGMENTS = 5

    /* ── i18n: every user-facing string lives here (zh + en) ───────────── */
    const NS = 'deepFocus'
    const I18N = {
      zh: {
        'nav.label': '深度专注',
        'pill.idle': '专注',
        'pill.aria': '专注计时，点击打开面板',
        'pill.offline': '连接中断，显示最后一次数据',
        'pill.open': '打开专注面板',
        'phase.idle': '未开始',
        'phase.work': '专注中',
        'phase.break': '休息中',
        'phase.paused': '已暂停',
        'panel.close': '关闭面板',
        'panel.title': '深度专注',
        'panel.taskPlaceholder': '这一轮要做什么？（可选）',
        'panel.duration': '时长',
        'panel.start': '开始专注',
        'panel.pause': '暂停',
        'panel.resume': '继续',
        'panel.complete': '完成',
        'panel.stop': '结束',
        'panel.statActive': '活跃',
        'panel.statContinuous': '连续',
        'panel.statPomodoros': '番茄',
        'panel.statTopApp': '常用应用',
        'panel.offline': '连接中断，显示最后一次数据',
        'panel.retry': '重试',
        'toast.focusCompleted': '专注完成 · {minutes} 分钟',
        'toast.focusCompletedTask': '已完成：{task}',
        'toast.taskCompleted': '任务完成',
        'toast.breakCompleted': '休息结束，准备下一轮',
        'toast.focusStopped': '专注已结束',
        'toast.locked': '该休息一下了',
        'toast.unlocked': '好的，再继续 {minutes} 分钟',
        'toast.unlockedRest': '好的，先休息一下',
        'toast.limitWarning': '接近使用上限',
        'toast.gentleSwitch': '当前任务完成后再切换吧',
        'lock.title': '该休息一下了',
        'lock.body': '你已经专注/使用很久了，休息一会儿再回来会更清醒。',
        'lock.reason.daily': '今日使用时长已达上限',
        'lock.reason.continuous': '连续工作时长已达上限',
        'lock.reason.session': '本次专注时长已达上限',
        'lock.reason.manual': '手动锁定',
        'lock.usage': '今日已使用',
        'lock.limit': '上限',
        'lock.unlockFor': '再使用 {n} 分钟',
        'lock.rest': '休息一下',
        'lock.restHint': '结束当前锁定并重置连续工作计时',
        'lock.error': '操作失败，请稍后重试',
        'lock.todayNote': '默认额度全部关闭；你可以在设置里调整上限。',
        'settings.nav': '深度专注',
        'settings.title': '深度专注',
        'settings.desc': '番茄专注 + 温和的会话提醒 + 按应用的使用统计。修改后点保存生效。',
        'settings.group.focus': '专注计时',
        'settings.group.limits': '使用限制',
        'settings.group.alerts': '提醒与音效',
        'settings.group.usage': '统计与数据',
        'settings.group.privacy': '隐私',
        'settings.group.stats': '最近 7 天',
        'settings.group.today': '今日概览',
        'settings.note.privacy': '所有数据只保存在本机，不会上传。只记录应用名和时长，不记录窗口标题。',
        'settings.note.sampling': '只在 DSH 运行时统计；未运行时段不计入。',
        'settings.sampling.degraded': '系统活跃采样已降级，统计可能不完整。',
        'settings.sampling.off': '系统活跃采样不可用，计时功能不受影响。',
        'settings.appsSampling.off': '应用统计当前不可用（可能因为长时间空闲或未开启应用统计）。',
        'settings.save': '保存设置',
        'settings.reset': '放弃修改',
        'settings.dirty': '有未保存的修改',
        'settings.saved': '已保存',
        'settings.offline': '插件服务暂不可用，正在重试…',
        'settings.loading': '正在加载…',
        'settings.error.invalid': '设置有误，未保存',
        'settings.error.saveFailed': '保存失败，请重试',
        'settings.today.active': '今日活跃',
        'settings.today.focus': '今日专注',
        'settings.today.breaks': '休息次数',
        'settings.today.pomodoros': '完成轮数',
        'settings.today.apps': '今日应用',
        'settings.volumeValue': '{n}%',
        'settings.minutesValue': '{n} 分钟',
        'settings.hintZeroUnlimited': '0 = 不限',
        'settings.preview': '试听',
        'settings.chartAria': '最近 7 天活跃与专注时长柱状图',
        'settings.stats.empty': '还没有统计数据',
        'settings.stats.loading': '正在加载统计…',
        'settings.stats.legendActive': '活跃',
        'settings.stats.legendFocus': '专注',
        'field.workMinutes': '专注时长',
        'field.workMinutes.hint': '分钟，1–180',
        'field.breakMinutes': '休息时长',
        'field.breakMinutes.hint': '分钟，1–60',
        'field.longBreakMinutes': '长休时长',
        'field.longBreakEvery': '长休间隔',
        'field.longBreakEvery.hint': '每 N 轮一次长休，0 关闭',
        'field.autoStartBreak': '自动开始休息',
        'field.autoStartNext': '自动开始下一轮',
        'field.idlePauseSeconds': '空闲自动暂停',
        'field.idlePauseSeconds.hint': '秒，0 关闭',
        'field.autoResumeOnReturn': '回到电脑自动继续',
        'field.grayOutOtherSessions': '专注时置灰其它会话',
        'field.grayOutOtherSessions.hint': '仅视觉提示，不会阻断任何工作',
        'field.dailyActiveMinutes': '每日活跃上限',
        'field.dailyActiveMinutes.hint': '分钟，0 = 不限',
        'field.continuousWorkMinutes': '连续工作上限',
        'field.continuousWorkMinutes.hint': '分钟，0 = 不限',
        'field.sessionMinutes': '单次专注上限',
        'field.sessionMinutes.hint': '分钟，0 = 不限',
        'field.unlockMinutes': '每次续期时长',
        'field.unlockMinutes.hint': '分钟',
        'field.taskDone': '任务完成提示',
        'field.turnDone': '每轮结束提示',
        'field.sound': '提示音',
        'field.volume': '音量',
        'field.quietHours': '静音时段',
        'field.quietHours.hint': '留空表示不静音',
        'field.quietHoursStart': '开始',
        'field.quietHoursEnd': '结束',
        'field.sampleSeconds': '采样间隔',
        'field.sampleSeconds.hint': '秒，3–30',
        'field.idleThresholdSeconds': '空闲判定阈值',
        'field.idleThresholdSeconds.hint': '秒，0 = 关闭',
        'field.retentionDays': '数据保留',
        'field.retentionDays.hint': '天',
        'field.trackApps': '按应用统计使用时长',
        'field.trackApps.hint': '记录前台应用的名称与时长',
        'error.generic': '操作失败，请重试',
        'error.network': '无法连接插件服务',
        'error.notRunning': '当前没有进行中的专注',
        'error.alreadyRunning': '已有专注在进行中',
        'error.notPaused': '当前专注未暂停',
        'time.hm': '{h} 小时 {m} 分',
        'time.m': '{m} 分钟',
        'stats.title': '使用统计',
        'stats.subtitle': 'DSH 运行期间，你的时间花在了哪些应用上',
        'stats.refresh': '刷新',
        'stats.back': '返回对话',
        'stats.todayActive': '今日活跃',
        'stats.todayApps': '今日应用时长',
        'stats.noApps': '暂无应用数据。开启「按应用统计」后，这里会显示各应用用时。',
        'stats.trend': '最近 7 天',
        'stats.trendEmpty': '还没有足够的数据',
        'stats.loading': '正在加载使用数据…',
        'stats.loadFailed': '加载失败，点击刷新重试',
        'stats.privacy': '只记录应用名和时长，不记录窗口标题；数据只保存在本机。',
        'stats.other': '其它',
        'stats.total': '合计',
        'stats.samplingOff': '应用统计未开启或暂不可用',
        'stats.legendAria': '应用用时图例',
        'stats.chartAria': '最近 7 天应用用时堆叠柱状图',
        'stats.unknownApp': '未知应用',
        'stats.trackNote': '仅在 DSH 运行时采样',
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
        'wd.0': '周日',
        'wd.1': '周一',
        'wd.2': '周二',
        'wd.3': '周三',
        'wd.4': '周四',
        'wd.5': '周五',
        'wd.6': '周六',
      },
      en: {
        'nav.label': 'Deep focus',
        'pill.idle': 'Focus',
        'pill.aria': 'Focus timer — click to open the panel',
        'pill.offline': 'Disconnected — showing the last known data',
        'pill.open': 'Open focus panel',
        'phase.idle': 'Not started',
        'phase.work': 'Focusing',
        'phase.break': 'On a break',
        'phase.paused': 'Paused',
        'panel.close': 'Close panel',
        'panel.title': 'Deep focus',
        'panel.taskPlaceholder': 'What are you working on? (optional)',
        'panel.duration': 'Duration',
        'panel.start': 'Start focus',
        'panel.pause': 'Pause',
        'panel.resume': 'Resume',
        'panel.complete': 'Complete',
        'panel.stop': 'End',
        'panel.statActive': 'Active',
        'panel.statContinuous': 'Streak',
        'panel.statPomodoros': 'Pomodoros',
        'panel.statTopApp': 'Top app',
        'panel.offline': 'Disconnected — showing the last known data',
        'panel.retry': 'Retry',
        'toast.focusCompleted': 'Focus complete · {minutes} min',
        'toast.focusCompletedTask': 'Done: {task}',
        'toast.taskCompleted': 'Task completed',
        'toast.breakCompleted': 'Break over — ready for the next round',
        'toast.focusStopped': 'Focus ended',
        'toast.locked': 'Time for a break',
        'toast.unlocked': 'Okay — {minutes} more minutes',
        'toast.unlockedRest': 'Okay — take a break',
        'toast.limitWarning': 'Approaching the usage limit',
        'toast.gentleSwitch': "Finish the current task before switching — you've got this.",
        'lock.title': 'Time for a break',
        'lock.body': "You've been at it for a while. A short break will help you come back sharper.",
        'lock.reason.daily': 'Daily usage limit reached',
        'lock.reason.continuous': 'Continuous work limit reached',
        'lock.reason.session': 'This focus block reached its limit',
        'lock.reason.manual': 'Manually locked',
        'lock.usage': 'Used today',
        'lock.limit': 'Limit',
        'lock.unlockFor': 'Use for another {n} min',
        'lock.rest': 'Take a break',
        'lock.restHint': 'Ends the lock and resets the work streak',
        'lock.error': 'Something went wrong — try again shortly',
        'lock.todayNote': 'All limits are off by default; you can adjust them in Settings.',
        'settings.nav': 'Deep focus',
        'settings.title': 'Deep focus',
        'settings.desc': 'Pomodoro focus, gentle conversation nudges, and per-app usage stats. Press Save to apply.',
        'settings.group.focus': 'Focus timer',
        'settings.group.limits': 'Usage limits',
        'settings.group.alerts': 'Alerts & sound',
        'settings.group.usage': 'Tracking & data',
        'settings.group.privacy': 'Privacy',
        'settings.group.stats': 'Last 7 days',
        'settings.group.today': "Today's summary",
        'settings.note.privacy': 'Everything stays on this machine and is never uploaded. Only app names and durations are recorded — never window titles.',
        'settings.note.sampling': 'Sampled only while DSH runs; downtime is not counted.',
        'settings.sampling.degraded': 'Activity sampling is degraded — data may be incomplete.',
        'settings.sampling.off': 'Activity sampling is unavailable; timers still work.',
        'settings.appsSampling.off': 'App tracking is currently unavailable (long idle or disabled).',
        'settings.save': 'Save settings',
        'settings.reset': 'Discard changes',
        'settings.dirty': 'Unsaved changes',
        'settings.saved': 'Saved',
        'settings.offline': 'Plugin service unavailable — retrying…',
        'settings.loading': 'Loading…',
        'settings.error.invalid': 'Invalid settings — not saved',
        'settings.error.saveFailed': 'Save failed — try again',
        'settings.today.active': 'Active today',
        'settings.today.focus': 'Focus today',
        'settings.today.breaks': 'Breaks',
        'settings.today.pomodoros': 'Rounds',
        'settings.today.apps': 'Apps today',
        'settings.volumeValue': '{n}%',
        'settings.minutesValue': '{n} min',
        'settings.hintZeroUnlimited': '0 = unlimited',
        'settings.preview': 'Preview',
        'settings.chartAria': 'Bar chart of active and focus minutes over the last 7 days',
        'settings.stats.empty': 'No data yet',
        'settings.stats.loading': 'Loading stats…',
        'settings.stats.legendActive': 'Active',
        'settings.stats.legendFocus': 'Focus',
        'field.workMinutes': 'Focus length',
        'field.workMinutes.hint': 'minutes, 1–180',
        'field.breakMinutes': 'Break length',
        'field.breakMinutes.hint': 'minutes, 1–60',
        'field.longBreakMinutes': 'Long break length',
        'field.longBreakEvery': 'Long break every',
        'field.longBreakEvery.hint': 'rounds; 0 disables',
        'field.autoStartBreak': 'Start breaks automatically',
        'field.autoStartNext': 'Start the next round automatically',
        'field.idlePauseSeconds': 'Idle auto-pause',
        'field.idlePauseSeconds.hint': 'seconds, 0 disables',
        'field.autoResumeOnReturn': 'Resume on return',
        'field.grayOutOtherSessions': 'Gray out other conversations while focusing',
        'field.grayOutOtherSessions.hint': 'Visual nudge only — never blocks any work',
        'field.dailyActiveMinutes': 'Daily active limit',
        'field.dailyActiveMinutes.hint': 'minutes, 0 = unlimited',
        'field.continuousWorkMinutes': 'Continuous work limit',
        'field.continuousWorkMinutes.hint': 'minutes, 0 = unlimited',
        'field.sessionMinutes': 'Single focus limit',
        'field.sessionMinutes.hint': 'minutes, 0 = unlimited',
        'field.unlockMinutes': 'Extension length',
        'field.unlockMinutes.hint': 'minutes',
        'field.taskDone': 'Task-completed notice',
        'field.turnDone': 'Turn-completed notice',
        'field.sound': 'Sound',
        'field.volume': 'Volume',
        'field.quietHours': 'Quiet hours',
        'field.quietHours.hint': 'leave empty to disable',
        'field.quietHoursStart': 'start',
        'field.quietHoursEnd': 'end',
        'field.sampleSeconds': 'Sample interval',
        'field.sampleSeconds.hint': 'seconds, 3–30',
        'field.idleThresholdSeconds': 'Idle threshold',
        'field.idleThresholdSeconds.hint': 'seconds, 0 disables',
        'field.retentionDays': 'Keep history',
        'field.retentionDays.hint': 'days',
        'field.trackApps': 'Track per-app usage',
        'field.trackApps.hint': 'records the foreground app name and duration',
        'error.generic': 'Something went wrong. Try again.',
        'error.network': 'Cannot reach the plugin service',
        'error.notRunning': 'No focus block is running',
        'error.alreadyRunning': 'A focus block is already running',
        'error.notPaused': 'The focus block is not paused',
        'time.hm': '{h}h {m}m',
        'time.m': '{m}m',
        'stats.title': 'Usage',
        'stats.subtitle': 'How your time was spent while DSH was running',
        'stats.refresh': 'Refresh',
        'stats.back': 'Back to chat',
        'stats.todayActive': 'Active today',
        'stats.todayApps': 'App time today',
        'stats.noApps': 'No app data yet. Enable per-app tracking in Settings to see it here.',
        'stats.trend': 'Last 7 days',
        'stats.trendEmpty': 'Not enough data yet',
        'stats.loading': 'Loading usage data…',
        'stats.loadFailed': "Couldn't load — refresh to retry",
        'stats.privacy': 'Only app names and durations are recorded — never window titles. Data stays on this machine.',
        'stats.other': 'Other',
        'stats.total': 'Total',
        'stats.samplingOff': 'App tracking is off or unavailable',
        'stats.legendAria': 'App usage legend',
        'stats.chartAria': 'Stacked bar chart of app time over the last 7 days',
        'stats.unknownApp': 'Unknown app',
        'stats.trackNote': 'Sampled only while DSH runs',
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

    /** mm:ss countdown; minutes may exceed 60 (e.g. 90:00). */
    function fmtCountdown(ms) {
      const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60
      return minutes + ':' + pad2(seconds)
    }

    /** Compact per-app duration: mm:ss (h:mm:ss above an hour). */
    function fmtAppTime(ms) {
      const totalSeconds = Math.max(0, Math.round(numberOr(ms, 0) / 1000))
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      if (hours > 0) return hours + ':' + pad2(minutes) + ':' + pad2(seconds)
      return pad2(minutes) + ':' + pad2(seconds)
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

    function isKnownFocusPhase(phase) {
      return phase === 'work' || phase === 'break'
    }

    function focusIsActive(state) {
      if (!state || !state.focus) return false
      const focus = state.focus
      return isKnownFocusPhase(focus.phase) && (focus.status === 'running' || focus.status === 'paused')
    }

    /** Remaining time: endsAt wins while running, remainingMs while paused/idle. */
    function focusRemainingMs(state, clockOffset) {
      if (!state || !state.focus) return 0
      const focus = state.focus
      const paused = focus.status === 'paused' || Boolean(focus.pauseCause)
      const endsAt = toTimestamp(focus.endsAt)
      if (!paused && endsAt !== null) {
        return Math.max(0, endsAt - (Date.now() - numberOr(clockOffset, 0)))
      }
      return Math.max(0, numberOr(focus.remainingMs, 0))
    }

    /** Total block length estimate for the progress ring. */
    function focusTotalMs(state) {
      if (!state || !state.focus) return 0
      const focus = state.focus
      const elapsed = Math.max(0, numberOr(focus.elapsedMs, 0))
      const remaining = Math.max(0, numberOr(focus.remainingMs, 0))
      if (elapsed + remaining > 0) return elapsed + remaining
      const settings = state.settings || {}
      const focusCfg = settings.focus || {}
      const minutes = focus.phase === 'break' ? numberOr(focusCfg.breakMinutes, 5) : numberOr(focusCfg.workMinutes, 25)
      return minutes * 60000
    }

    /** The focus-bound conversation, or null when no focus block is active. */
    function focusOwnerSessionId(state) {
      if (!focusIsActive(state)) return null
      const sessionId = state.focus && state.focus.sessionId
      return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
    }

    /** Gentle sidebar graying is active only in a live focus block while enabled. */
    function sidebarGrayActive(state) {
      if (!state || !state.focus || !state.settings) return false
      // A focus block bound to a session that no longer exists must not gray the app.
      if (state.focus.sessionLive === false) return false
      if (!focusOwnerSessionId(state)) return false
      const focusCfg = state.settings.focus || {}
      return focusCfg.grayOutOtherSessions !== false
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
        const activeMs = Math.max(0, numberOr(entry.activeMs, numberOr(entry.totalMs, apps.reduce(function (sum, row) { return sum + row.ms }, 0))))
        trend.days.push({ day: day, activeMs: Math.round(activeMs), apps: apps })
      }
      return trend
    }

    function todayAppsFromState(state) {
      if (!state || typeof state.appsToday !== 'object' || state.appsToday === null) return []
      return normalizeAppRows(state.appsToday.top, MAX_TOP_APPS)
    }

    function todayAppsTotal(state) {
      if (!state) return 0
      const direct = numberOr(state.appsToday && state.appsToday.totalMs, -1)
      if (direct >= 0) return direct
      return todayAppsFromState(state).reduce(function (sum, row) { return sum + row.ms }, 0)
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

    /* ── Scoped styles (rendered as <style> React elements) ────────────── */

    const CSS_TEXT = [
      '[data-df-root]{box-sizing:border-box;font-family:inherit}',
      '.df-pill{display:inline-flex;align-items:center;gap:6px;height:28px;margin:0;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:1;white-space:nowrap;cursor:pointer;flex:0 0 auto;max-width:240px;transition:background-color .16s ease,border-color .16s ease,opacity .16s ease}',
      '.df-pill:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.df-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.df-pill[data-status="paused"]{opacity:.72;border-style:dashed}',
      '.df-pill[data-phase="work"][data-status="running"]{border-color:var(--dsw-alias-brand-primary)}',
      '.df-pill[data-phase="break"]{border-color:var(--dsw-alias-state-success-primary)}',
      '.df-pill-time{font-variant-numeric:tabular-nums;font-weight:600;letter-spacing:.2px}',
      '.df-pill[data-phase="work"] .df-pill-time{color:var(--dsw-alias-brand-primary)}',
      '.df-pill[data-phase="break"] .df-pill-time{color:var(--dsw-alias-state-success-primary)}',
      '.df-pill-task{max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}',
      '.df-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:0 0 auto}',
      '.df-icon{display:block;flex:0 0 auto}',
      '.df-panel-layer{position:absolute;inset:0;z-index:40;pointer-events:none}',
      '.df-panel{position:absolute;right:16px;bottom:16px;width:320px;max-width:calc(100vw - 32px);box-sizing:border-box;display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.45;pointer-events:auto;box-shadow:0 12px 32px color-mix(in srgb, var(--dsw-alias-bg-overlay) 62%, transparent);animation:df-in .16s ease-out}',
      '@keyframes df-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '.df-row{display:flex;align-items:center;gap:8px;min-width:0}',
      '.df-between{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}',
      '.df-title{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.df-muted{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0}',
      '.df-ring{position:relative;width:132px;height:132px;align-self:center;display:flex;align-items:center;justify-content:center;flex:0 0 auto}',
      '.df-ring svg{position:absolute;inset:0;width:132px;height:132px;transform:rotate(-90deg)}',
      '.df-ring-center{display:flex;flex-direction:column;align-items:center;gap:2px;z-index:1}',
      '.df-ring-time{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.5px}',
      '.df-ring-phase{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.df-ring-track{stroke:var(--dsw-alias-border-l1);fill:none}',
      '.df-ring-value{stroke:var(--dsw-alias-brand-primary);fill:none;transition:stroke-dashoffset .3s ease}',
      '.df-ring[data-phase="break"] .df-ring-value{stroke:var(--dsw-alias-state-success-primary)}',
      '.df-ring[data-status="paused"] .df-ring-value{stroke:var(--dsw-alias-state-warn-primary)}',
      '.df-input{box-sizing:border-box;width:100%;height:30px;padding:0 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;outline:none}',
      '.df-input:focus-visible,.df-number:focus-visible,.df-time:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.df-chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.df-chip{height:26px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:12px;cursor:pointer}',
      '.df-chip[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.df-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.df-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;cursor:pointer;transition:opacity .15s ease}',
      '.df-btn:hover:not([disabled]){opacity:.85}',
      '.df-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.df-btn[disabled]{opacity:.5;cursor:default}',
      '.df-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.df-btn-ghost{background:transparent}',
      '.df-btn-sm{height:26px;padding:0 9px;font-size:12px}',
      '.df-actions{display:flex;gap:8px;flex-wrap:wrap}',
      '.df-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:0}',
      '.df-stats{display:flex;gap:12px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.df-stats b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.df-toasts{position:absolute;top:var(--dsh-frame-overlay-top,56px);right:16px;z-index:60;display:flex;flex-direction:column;gap:8px;max-width:340px;pointer-events:none}',
      '.df-toast{box-sizing:border-box;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:1.45;box-shadow:0 8px 24px color-mix(in srgb, var(--dsw-alias-bg-overlay) 55%, transparent);animation:df-toast-in .18s ease-out}',
      '.df-toast[data-kind="gentle-switch"]{border-color:var(--dsw-alias-border-l2)}',
      '.df-toast[data-kind="focus-completed"],.df-toast[data-kind="task-completed"],.df-toast[data-kind="break-completed"]{border-color:var(--dsw-alias-state-success-primary)}',
      '@keyframes df-toast-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
      '.df-lock{position:absolute;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;background:var(--dsw-alias-bg-overlay);background:color-mix(in srgb, var(--dsw-alias-bg-overlay) 82%, transparent);backdrop-filter:blur(6px);pointer-events:auto}',
      '.df-lock-card{width:390px;max-width:100%;max-height:100%;overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;padding:22px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.5;box-shadow:0 24px 60px color-mix(in srgb, var(--dsw-alias-bg-overlay) 78%, transparent)}',
      '.df-lock-title{font-size:17px;font-weight:600;margin:0}',
      '.df-lock-body{color:var(--dsw-alias-label-secondary);font-size:13px;margin:0}',
      '.df-lock-reason{color:var(--dsw-alias-state-warn-primary);font-size:13px;margin:0}',
      '.df-kv{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.df-kv b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.df-divider{height:1px;border:0;margin:0;background:var(--dsw-alias-border-l2)}',
      '.df-settings{display:flex;flex-direction:column;font-family:inherit;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5;padding-top:4px}',
      '.df-settings-head{display:flex;flex-direction:column;gap:2px;padding:0 0 8px}',
      '.df-settings-title{font-size:16px;font-weight:600;margin:0}',
      '.df-settings-desc{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0}',
      '.df-group{padding:14px 0 4px;margin-top:8px;border-top:1px solid var(--dsw-alias-border-l2)}',
      '.df-group:first-of-type{border-top:0;margin-top:0;padding-top:0}',
      '.df-group-title{font-size:14px;font-weight:600;margin:0 0 2px}',
      '.df-field{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}',
      '.df-field:last-child{border-bottom:0}',
      '.df-field-label{display:flex;flex-direction:column;gap:2px;min-width:0}',
      '.df-field-title{font-size:14px}',
      '.df-field-hint{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.df-field-control{display:flex;align-items:center;gap:8px;flex:0 0 auto}',
      '.df-number{box-sizing:border-box;width:88px;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;text-align:right;outline:none}',
      '.df-time{box-sizing:border-box;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;outline:none;color-scheme:inherit}',
      '.df-range{width:140px;accent-color:var(--dsw-alias-brand-primary)}',
      '.df-switch{position:relative;width:38px;height:22px;flex:0 0 auto;padding:0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;transition:background-color .16s ease,border-color .16s ease}',
      '.df-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
      '.df-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.df-switch[disabled]{opacity:.5;cursor:default}',
      '.df-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform .16s ease}',
      '.df-switch[aria-checked="true"]::after{transform:translateX(16px)}',
      '.df-savebar{position:sticky;bottom:0;z-index:1;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 0;margin-top:10px;border-top:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}',
      '.df-save-state{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.df-save-state[data-kind="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.df-save-state[data-kind="saved"]{color:var(--dsw-alias-state-success-primary)}',
      '.df-chart{display:flex;flex-direction:column;gap:6px;padding:12px 0 4px}',
      '.df-chart svg{display:block;width:100%;height:110px}',
      '.df-chart-axis{stroke:var(--dsw-alias-border-l2);stroke-width:1}',
      '.df-bar-active{fill:var(--dsw-alias-border-l1)}',
      '.df-bar-focus{fill:var(--dsw-alias-brand-primary)}',
      '.df-chart-labels{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;color:var(--dsw-alias-label-secondary);font-size:11px;text-align:center}',
      '.df-chart-legend{display:flex;gap:14px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.df-legend-dot{display:inline-block;width:8px;height:8px;margin-right:4px;border-radius:2px}',
      '.df-today{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 20px;padding:4px 0 8px}',
      '.df-today-item{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-bottom:1px dashed var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.df-today-item b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.df-usage{box-sizing:border-box;height:100%;flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;padding:28px clamp(20px,4vw,48px) 40px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:14px;line-height:1.5;background:var(--dsw-alias-bg-base)}',
      '.df-usage-inner{width:100%;max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:18px}',
      '.df-usage-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}',
      '.df-usage-title{font-size:22px;font-weight:600;margin:0}',
      '.df-usage-sub{margin:2px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.df-usage-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.df-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}',
      '.df-card{box-sizing:border-box;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.df-card-label{color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.df-card-value{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:2px}',
      '.df-section{box-sizing:border-box;padding:16px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:12px}',
      '.df-section-title{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:14px;font-weight:600;margin:0}',
      '.df-app-row{display:grid;grid-template-columns:minmax(88px,150px) minmax(0,1fr) auto;gap:10px;align-items:center;font-size:13px;min-width:0}',
      '.df-app-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
      '.df-app-bar{position:relative;height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;min-width:0}',
      '.df-app-bar-fill{position:absolute;top:0;bottom:0;left:0;border-radius:999px;background:var(--dsw-alias-brand-primary)}',
      '.df-app-time{min-width:52px;text-align:right;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}',
      '.df-usage-empty{color:var(--dsw-alias-label-secondary);font-size:13px;margin:0}',
      '.df-usage-note{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0}',
      '.df-usage-chart svg{display:block;width:100%;height:150px}',
      '.df-usage-axis{stroke:var(--dsw-alias-border-l2);stroke-width:1}',
      '.df-usage-legend{display:flex;flex-wrap:wrap;gap:10px 14px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.df-seg-0{fill:var(--dsw-alias-brand-primary)}',
      '.df-seg-1{fill:var(--dsw-alias-state-success-primary)}',
      '.df-seg-2{fill:var(--dsw-alias-state-warn-primary)}',
      '.df-seg-3{fill:var(--dsw-alias-state-idle-primary)}',
      '.df-seg-4{fill:var(--dsw-alias-label-secondary)}',
      '.df-seg-other{fill:var(--dsw-alias-border-l1)}',
      '@media (prefers-reduced-motion: reduce){.df-panel,.df-toast{animation:none}.df-ring-value,.df-switch,.df-switch::after,.df-pill,.df-btn{transition:none}}',
    ].join('')

    /* ── Previous-generation self-heal ──────────────────────────────────
     * The v0.1 bundle once leaked a uiWorkspace wrapper and dimmed inline
     * styles on unload. These helpers run before anything else on apply and
     * are also used by the sidebar controller's synchronous teardown. */

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

    /* ── Runtime: i18n, shared store, gentle sidebar, components ───────── */

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

      /* ── Shared polling store (one loop for every component) ─────────── */

      const store = (function createStore() {
        let snapshot = {
          status: 'boot', // boot | live | hidden | disabled
          state: null,
          consecutiveFailures: 0,
          error: false,
          panelOpen: false,
          toasts: [],
          sessionId: null,
          stats: null,
          statsLoading: false,
          appsTrend: null,
          appsLoading: false,
          appsError: false,
          clockOffset: 0,
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

        function clearToasts() {
          if (snapshot.toasts.length === 0) return
          snapshot = Object.assign({}, snapshot, { toasts: [] })
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

        function eventToastText(kind, meta) {
          const safeMeta = meta && typeof meta === 'object' ? meta : {}
          switch (kind) {
            case EVENT.focusCompleted:
              if (safeMeta.task) return t('toast.focusCompletedTask', { task: String(safeMeta.task) })
              return t('toast.focusCompleted', { minutes: numberOr(safeMeta.minutes, 25) })
            case EVENT.taskCompleted:
              return t('toast.taskCompleted')
            case EVENT.breakCompleted:
              return t('toast.breakCompleted')
            case EVENT.focusStopped:
              return t('toast.focusStopped')
            case EVENT.locked:
              return t('toast.locked')
            case EVENT.unlocked:
              return safeMeta.mode === 'rest'
                ? t('toast.unlockedRest')
                : t('toast.unlocked', { minutes: numberOr(safeMeta.minutes, 20) })
            case EVENT.limitWarning:
              return t('toast.limitWarning')
            default:
              return null
          }
        }

        function soundFor(kind, alerts) {
          if (kind !== EVENT.focusCompleted && kind !== EVENT.taskCompleted && kind !== EVENT.breakCompleted) return
          if (alerts && alerts.sound === false) return
          if (isQuietHours(alerts)) return
          audio.chime(numberOr(alerts && alerts.volume, 0.6))
        }

        function handleEvent(event, alerts) {
          const kind = event && event.kind
          const meta = (event && event.meta) || {}
          const text = eventToastText(kind, meta)
          if (text) pushToast(kind, text)
          soundFor(kind, alerts)
        }

        /** Show each ring-buffer event once; a recovery or first load only sets a baseline. */
        function ingestEvents(events, nextState, resetBaseline) {
          if (!Array.isArray(events) || events.length === 0) return
          let maxSeq = null
          for (let i = 0; i < events.length; i += 1) {
            const seq = Number(events[i] && events[i].seq)
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
            .sort(function (a, b) {
              return Number(a.seq) - Number(b.seq)
            })
          lastSeq = maxSeq
          const alerts = (nextState && nextState.alerts) || null
          fresh.forEach(function (event) {
            handleEvent(event, alerts)
          })
        }

        function validState(data) {
          return Boolean(
            data && typeof data === 'object' && data.focus && typeof data.focus === 'object' && data.lock && data.usage,
          )
        }

        function applyState(next) {
          const serverNow = toTimestamp(next.now)
          const clockOffset = serverNow === null ? 0 : Date.now() - serverNow
          const recovering = snapshot.status !== 'live'
          ingestEvents(next.events, next, recovering)
          snapshot = Object.assign({}, snapshot, {
            status: 'live',
            state: next,
            error: false,
            consecutiveFailures: 0,
            clockOffset: clockOffset,
          })
          emit()
        }

        function goUnavailable(status) {
          if (snapshot.status === status) return
          snapshot = Object.assign({}, snapshot, {
            status: status,
            error: true,
            panelOpen: false,
            toasts: [],
          })
          emit()
        }

        function registerFailure(httpStatus) {
          const failures = snapshot.consecutiveFailures + 1
          if (httpStatus === 404) {
            // The Host plugin is disabled or gone: render nothing, restore the app.
            snapshot = Object.assign({}, snapshot, { consecutiveFailures: failures })
            goUnavailable('disabled')
            return
          }
          if (failures >= 2) {
            snapshot = Object.assign({}, snapshot, { consecutiveFailures: failures })
            goUnavailable('hidden')
            return
          }
          snapshot = Object.assign({}, snapshot, {
            consecutiveFailures: failures,
            error: true,
          })
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

        function countdownVisible() {
          return isVisible() && snapshot.state && snapshot.state.focus && snapshot.state.focus.phase !== 'idle'
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
            if (active && countdownVisible()) emitClock()
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

        function setSessionId(sessionId) {
          const next = sessionId === undefined ? null : sessionId
          if (snapshot.sessionId !== next) {
            snapshot = Object.assign({}, snapshot, { sessionId: next })
            emit()
          }
        }

        function setPanelOpen(open) {
          if (snapshot.panelOpen !== Boolean(open)) {
            snapshot = Object.assign({}, snapshot, { panelOpen: Boolean(open) })
            emit()
          }
        }

        function togglePanel() {
          if (!isVisible()) return
          setPanelOpen(!snapshot.panelOpen)
        }

        async function postAction(route, body) {
          const result = await fetchJSON(route, { method: 'POST', body: body === undefined ? {} : body })
          if (result.ok && result.data && result.data.state) applyState(result.data.state)
          else if (result.ok) refreshSoon()
          else if (
            result.status === 409 ||
            (result.data && result.data.error && /^(already-running|not-running|not-paused|not-locked)$/.test(String(result.data.error.code)))
          ) {
            refreshSoon()
          }
          return result
        }

        function startFocus(options) {
          const payload = { workMinutes: options && options.minutes }
          if (options && options.task) payload.task = options.task
          const sessionId = (options && options.sessionId) || snapshot.sessionId
          if (sessionId) payload.sessionId = sessionId
          return postAction(ROUTES.focusStart, payload)
        }

        function pauseFocus() {
          return postAction(ROUTES.focusPause, {})
        }

        function resumeFocus() {
          return postAction(ROUTES.focusResume, {})
        }

        function completeFocus() {
          return postAction(ROUTES.focusComplete, {})
        }

        function stopFocus() {
          return postAction(ROUTES.focusStop, {})
        }

        function unlock() {
          return postAction(ROUTES.unlock, {})
        }

        function restUnlock() {
          return postAction(ROUTES.unlock, { mode: 'rest' })
        }

        async function loadStats(force) {
          if (snapshot.statsLoading) return
          if (!force && snapshot.stats) return
          snapshot = Object.assign({}, snapshot, { statsLoading: true })
          emit()
          const result = await fetchJSON(ROUTES.stats + '?days=7')
          if (result.ok && result.data) {
            snapshot = Object.assign({}, snapshot, { statsLoading: false, stats: result.data })
          } else {
            snapshot = Object.assign({}, snapshot, { statsLoading: false })
          }
          emit()
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
          setSessionId: setSessionId,
          setPanelOpen: setPanelOpen,
          togglePanel: togglePanel,
          startFocus: startFocus,
          pauseFocus: pauseFocus,
          resumeFocus: resumeFocus,
          completeFocus: completeFocus,
          stopFocus: stopFocus,
          unlock: unlock,
          restUnlock: restUnlock,
          loadStats: loadStats,
          loadAppsTrend: loadAppsTrend,
          saveSettings: saveSettings,
          pushToast: pushToast,
        }
      })()

      /* ── Gentle sidebar graying (reversible inline styles only) ──────── */

      /* ── Gentle sidebar graying (one CSS rule + one <html> attribute) ── */
      // No host service is wrapped and no row gets inline styles: a single
      // injected <style> plus `data-dsh-focus-dim` on <html> drives the effect,
      // so cleanup can restore the app synchronously and idempotently.

      function cssEscape(value) {
        const text = String(value)
        try {
          if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text)
        } catch (error) {
          /* fall through to the manual escape */
        }
        return text.replace(/[^a-zA-Z0-9_-]/g, function (character) {
          return '\\' + character
        })
      }

      const sidebarGray = (function createSidebarGray() {
        let styleElement = null
        let lastToastAt = 0
        let running = false

        function activeState() {
          const current = store.get()
          if (current.status !== 'live') return null
          const state = current.state
          if (!state || !sidebarGrayActive(state)) return null
          const owner = focusOwnerSessionId(state)
          if (owner === null) return null
          const known = new Set()
          const sessions = Array.isArray(state.sessions) ? state.sessions : []
          for (let index = 0; index < sessions.length; index += 1) {
            const session = sessions[index]
            if (session && typeof session.id === 'string' && session.id.length > 0) known.add(session.id)
          }
          const blocked = new Set()
          for (const id of known) {
            if (id !== owner && blocked.size < MAX_BLOCKED_IDS) blocked.add(id)
          }
          return { owner: owner, known: known, blocked: blocked }
        }

        function notifyGentle() {
          const now = Date.now()
          if (now - lastToastAt < BLOCK_TOAST_THROTTLE_MS) return
          lastToastAt = now
          store.pushToast('gentle-switch', t('toast.gentleSwitch'))
        }

        function dimCss(owner) {
          return (
            'html[data-dsh-focus-dim] [data-row-key^="session:"]:not([data-row-key="session:' +
            cssEscape(owner) +
            '"]){opacity:.45}'
          )
        }

        function mountStyle(owner) {
          try {
            if (!styleElement || !styleElement.isConnected) {
              styleElement = document.createElement('style')
              styleElement.setAttribute('data-dsh-focus-style', '1')
              const parent = document.head || document.documentElement
              if (parent && typeof parent.appendChild === 'function') parent.appendChild(styleElement)
            }
            const css = dimCss(owner)
            if (styleElement.textContent !== css) styleElement.textContent = css
            document.documentElement.setAttribute('data-dsh-focus-dim', owner)
          } catch (error) {
            /* graying is cosmetic; never break the app */
          }
        }

        /** Synchronous, idempotent teardown: no style node, no html attribute, no marks. */
        function deactivate() {
          try {
            if (styleElement && styleElement.parentNode) styleElement.parentNode.removeChild(styleElement)
          } catch (error) {
            /* ignored */
          }
          styleElement = null
          try {
            document.documentElement.removeAttribute('data-dsh-focus-dim')
          } catch (error) {
            /* ignored */
          }
          restoreLegacyDimMarks()
        }

        function sync() {
          if (!running) return
          const lock = activeState()
          if (lock === null || lock.blocked.size === 0) {
            deactivate()
            return
          }
          mountStyle(lock.owner)
        }

        function isOwnUiTarget(target) {
          let element = target
          for (let depth = 0; element && depth < 20; depth += 1, element = element.parentElement) {
            if (!element || typeof element.getAttribute !== 'function') continue
            // Either marker identifies our own roots (style scope + click skip).
            if (
              element.getAttribute('data-dsh-deep-focus-root') !== null ||
              element.getAttribute('data-df-root') !== null
            ) {
              return true
            }
          }
          return false
        }

        function blockedSessionFromTarget(target) {
          if (isOwnUiTarget(target)) return null
          const lock = activeState()
          if (lock === null || lock.blocked.size === 0) return null
          let element = target
          for (let depth = 0; element && depth < MAX_ANCESTOR_DEPTH; depth += 1, element = element.parentElement) {
            if (!element || typeof element.getAttribute !== 'function') continue
            const rowKey = element.getAttribute('data-row-key')
            if (rowKey && rowKey.slice(0, 8) === 'session:') {
              const id = rowKey.slice(8)
              if (id === lock.owner) return null
              return lock.blocked.has(id) ? id : null
            }
            const attributes = element.attributes
            if (!attributes) continue
            for (let index = 0; index < attributes.length; index += 1) {
              const value = attributes[index].value
              if (!value || value.length > 200) continue
              if (lock.blocked.has(value)) return value
              const prefixed = value.slice(0, 8) === 'session:' ? value.slice(8) : null
              if (prefixed && lock.blocked.has(prefixed)) return prefixed
            }
          }
          return null
        }

        function onDocumentClick(event) {
          try {
            if (blockedSessionFromTarget(event.target)) {
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
            if (blockedSessionFromTarget(target)) {
              event.preventDefault()
              event.stopPropagation()
              notifyGentle()
            }
          } catch (error) {
            /* ignored */
          }
        }

        function start() {
          if (running) return
          running = true
          try {
            document.addEventListener('click', onDocumentClick, true)
            document.addEventListener('keydown', onDocumentKeyDown, true)
          } catch (error) {
            /* the nudge is best effort */
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
          deactivate()
        }

        return { start: start, stop: stop, sync: sync }
      })()

      function start() {
        const stopStore = store.start()
        sidebarGray.start()
        const unsubscribe = store.subscribe(function () {
          sidebarGray.sync()
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
          unsubscribe()
          sidebarGray.stop()
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

      function Styles() {
        return h('style', { 'data-df-styles': '1' }, CSS_TEXT)
      }

      function IconPlay() {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('path', {
            d: 'M3 2.2v7.6c0 .5.55.8.97.53l5.9-3.8a.63.63 0 0 0 0-1.06l-5.9-3.8A.63.63 0 0 0 3 2.2Z',
            fill: 'currentColor',
          }),
        )
      }

      function IconPause() {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('rect', { x: 2.5, y: 2, width: 2.6, height: 8, rx: 1, fill: 'currentColor' }),
          h('rect', { x: 6.9, y: 2, width: 2.6, height: 8, rx: 1, fill: 'currentColor' }),
        )
      }

      function IconStop() {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('rect', { x: 3, y: 3, width: 6, height: 6, rx: 1.4, fill: 'currentColor' }),
        )
      }

      function IconCheck() {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('path', {
            d: 'M2.2 6.4 4.8 9 9.9 3.4',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        )
      }

      function IconLeaf() {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('path', {
            d: 'M10 2C5.5 2 2 4 2 7.2c0 1.4.8 2.4 2 2.8C5.4 7.2 7.2 6 10 5.2',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
          }),
        )
      }

      function IconClose() {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('path', {
            d: 'M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.6,
            strokeLinecap: 'round',
          }),
        )
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

      /** Sidebar navigation icon: three usage bars. Receives the shell's `size` prop. */
      function FocusStatsIcon(props) {
        const size = numberOr(props && props.size, 16)
        return h(
          'svg',
          {
            className: 'df-icon',
            width: size,
            height: size,
            viewBox: '0 0 16 16',
            'aria-hidden': 'true',
          },
          h('rect', { x: 2.2, y: 8.4, width: 2.6, height: 5.2, rx: 1, fill: 'currentColor', opacity: 0.75 }),
          h('rect', { x: 6.7, y: 5.2, width: 2.6, height: 8.4, rx: 1, fill: 'currentColor' }),
          h('rect', { x: 11.2, y: 2.4, width: 2.6, height: 11.2, rx: 1, fill: 'currentColor', opacity: 0.55 }),
        )
      }

      function errorTextFor(result) {
        const code = result && result.data && result.data.error && result.data.error.code
        if (code) {
          const map = {
            'not-running': 'error.notRunning',
            'already-running': 'error.alreadyRunning',
            'not-paused': 'error.notPaused',
            'bad-json': 'error.generic',
          }
          if (map[code]) return t(map[code])
        }
        if (result && result.status === 0) return t('error.network')
        return t('error.generic')
      }

      function settingsErrorText(result) {
        const code = result && result.data && result.data.error && result.data.error.code
        if (code === 'invalid-settings') return t('settings.error.invalid')
        if (result && result.status === 0) return t('error.network')
        return t('settings.error.saveFailed')
      }

      /* ── Pill in the composer tool row ───────────────────────────────── */

      function FocusPill(props) {
        useLocaleTick()
        const snapshot = useStore(true)
        const sessionId = props && props.sessionId
        React.useEffect(
          function () {
            store.setSessionId(sessionId || null)
            return function () {
              store.setSessionId(null)
            }
          },
          [sessionId],
        )
        if (!store.isVisible()) return null
        const state = snapshot.state
        const focus = state && state.focus
        const phase = focus && focus.phase && focus.phase !== 'idle' ? focus.phase : 'idle'
        const status = focus && focus.status ? focus.status : 'idle'
        const running = phase !== 'idle' && status !== 'paused'
        const remaining = focusRemainingMs(state, snapshot.clockOffset)
        const ariaParts = [t('pill.aria')]
        if (snapshot.error) ariaParts.push(t('pill.offline'))
        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'button',
            {
              type: 'button',
              className: 'df-pill',
              'data-df-root': 'pill',
              'data-dsh-deep-focus-root': 'pill',
              'data-df': 'pill',
              'data-phase': phase,
              'data-status': running ? 'running' : status,
              title: snapshot.error ? t('pill.offline') : t('pill.open'),
              'aria-label': ariaParts.join(' · '),
              'aria-expanded': snapshot.panelOpen ? 'true' : 'false',
              onClick: function () {
                store.togglePanel()
              },
            },
            phase === 'break' ? h(IconLeaf) : running ? h(IconPause) : h(IconPlay),
            h(
              'span',
              { className: 'df-pill-time' },
              running || status === 'paused' ? fmtCountdown(remaining) : t('pill.idle'),
            ),
            running && focus && focus.task ? h('span', { className: 'df-pill-task' }, String(focus.task)) : null,
            snapshot.error ? h('span', { className: 'df-dot', 'aria-hidden': 'true' }) : null,
          ),
        )
      }

      function phaseLabel(phase, status) {
        if (phase === 'work') return status === 'paused' ? t('phase.paused') : t('phase.work')
        if (phase === 'break') return t('phase.break')
        return t('phase.idle')
      }

      /* ── Floating focus panel ────────────────────────────────────────── */

      function FocusPanel() {
        useLocaleTick()
        const snapshot = useStore(true)
        const open = snapshot.panelOpen
        const state = snapshot.state
        const focus = state && state.focus
        const settings = (state && state.settings) || {}
        const focusCfg = settings.focus || {}
        const phase = focus && focus.phase && focus.phase !== 'idle' ? focus.phase : 'idle'
        const status = focus && focus.status ? focus.status : 'idle'
        const running = phase !== 'idle' && status !== 'paused'
        const paused = phase !== 'idle' && status === 'paused'
        const remaining = focusRemainingMs(state, snapshot.clockOffset)
        const total = focusTotalMs(state)
        const progress = total > 0 ? Math.min(1, Math.max(0, (total - remaining) / total)) : 0
        const defaultMinutes = clampNumber(focusCfg.workMinutes, 1, 180, 25)
        const presetState = React.useState(defaultMinutes)
        const preset = presetState[0]
        const setPreset = presetState[1]
        const taskState = React.useState('')
        const task = taskState[0]
        const setTask = taskState[1]
        const busyState = React.useState(false)
        const busy = busyState[0]
        const setBusy = busyState[1]
        const errorState = React.useState(null)
        const error = errorState[0]
        const setError = errorState[1]

        React.useEffect(
          function () {
            if (!open) return undefined
            const onKeyDown = function (event) {
              if (event.key !== 'Escape') return
              event.preventDefault()
              store.setPanelOpen(false)
            }
            document.addEventListener('keydown', onKeyDown, true)
            return function () {
              document.removeEventListener('keydown', onKeyDown, true)
            }
          },
          [open],
        )

        React.useEffect(
          function () {
            setPreset(defaultMinutes)
          },
          [defaultMinutes],
        )

        if (!store.isVisible() || !open) return null

        async function run(action) {
          if (busy) return
          setBusy(true)
          setError(null)
          let result
          try {
            result = await action()
          } catch (caught) {
            result = { ok: false, status: 0, data: null }
          }
          setBusy(false)
          if (result && !result.ok) {
            setError(errorTextFor(result))
            if (result.status === 409) store.refreshSoon()
          }
        }

        const ringRadius = 54
        const circumference = 2 * Math.PI * ringRadius
        const topApp = todayAppsFromState(state)[0]

        const actionNodes = []
        if (phase === 'idle') {
          actionNodes.push(
            h(
              'button',
              {
                key: 'start',
                type: 'button',
                className: 'df-btn df-btn-primary',
                disabled: busy,
                onClick: function () {
                  run(function () {
                    return store.startFocus({ task: task.trim() || undefined, minutes: preset })
                  })
                },
              },
              h(IconPlay),
              t('panel.start'),
            ),
          )
        }
        if (running && phase === 'work') {
          actionNodes.push(
            h(
              'button',
              {
                key: 'pause',
                type: 'button',
                className: 'df-btn',
                disabled: busy,
                onClick: function () {
                  run(function () {
                    return store.pauseFocus()
                  })
                },
              },
              h(IconPause),
              t('panel.pause'),
            ),
          )
        }
        if (paused && phase === 'work') {
          actionNodes.push(
            h(
              'button',
              {
                key: 'resume',
                type: 'button',
                className: 'df-btn df-btn-primary',
                disabled: busy,
                onClick: function () {
                  run(function () {
                    return store.resumeFocus()
                  })
                },
              },
              h(IconPlay),
              t('panel.resume'),
            ),
          )
        }
        if (phase === 'work' && (running || paused)) {
          actionNodes.push(
            h(
              'button',
              {
                key: 'complete',
                type: 'button',
                className: 'df-btn',
                disabled: busy,
                onClick: function () {
                  run(function () {
                    return store.completeFocus()
                  })
                },
              },
              h(IconCheck),
              t('panel.complete'),
            ),
          )
        }
        if (phase !== 'idle') {
          actionNodes.push(
            h(
              'button',
              {
                key: 'stop',
                type: 'button',
                className: 'df-btn',
                disabled: busy,
                onClick: function () {
                  run(function () {
                    return store.stopFocus()
                  })
                },
              },
              h(IconStop),
              t('panel.stop'),
            ),
          )
        }

        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            {
              className: 'df-panel-layer',
              'data-df-root': 'panel',
              'data-dsh-deep-focus-root': 'panel',
              style: { pointerEvents: 'none' },
            },
            h(
              'section',
              { className: 'df-panel', role: 'dialog', 'aria-label': t('panel.title'), 'data-df': 'panel' },
              h(
                'div',
                { className: 'df-between' },
                h('span', { className: 'df-title' }, t('panel.title')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'df-btn df-btn-ghost',
                    style: { width: 28, height: 28, padding: 0 },
                    'aria-label': t('panel.close'),
                    title: t('panel.close'),
                    onClick: function () {
                      store.setPanelOpen(false)
                    },
                  },
                  h(IconClose),
                ),
              ),
              h(
                'div',
                {
                  className: 'df-ring',
                  'data-phase': phase,
                  'data-status': paused ? 'paused' : running ? 'running' : 'idle',
                },
                h(
                  'svg',
                  { viewBox: '0 0 132 132', 'aria-hidden': 'true' },
                  h('circle', { className: 'df-ring-track', cx: 66, cy: 66, r: ringRadius, strokeWidth: 6 }),
                  h('circle', {
                    className: 'df-ring-value',
                    cx: 66,
                    cy: 66,
                    r: ringRadius,
                    strokeWidth: 6,
                    strokeLinecap: 'round',
                    strokeDasharray: circumference.toFixed(2),
                    strokeDashoffset: (circumference * (1 - progress)).toFixed(2),
                  }),
                ),
                h(
                  'div',
                  { className: 'df-ring-center' },
                  h('span', { className: 'df-ring-time' }, fmtCountdown(phase === 'idle' ? preset * 60000 : remaining)),
                  h('span', { className: 'df-ring-phase' }, phaseLabel(phase, status)),
                ),
              ),
              phase === 'idle'
                ? h('input', {
                    className: 'df-input',
                    type: 'text',
                    value: task,
                    maxLength: 120,
                    placeholder: t('panel.taskPlaceholder'),
                    'aria-label': t('panel.taskPlaceholder'),
                    disabled: busy,
                    onChange: function (event) {
                      setTask(event.target.value)
                    },
                  })
                : focus && focus.task
                  ? h('p', { className: 'df-muted', title: String(focus.task) }, String(focus.task))
                  : null,
              phase === 'idle'
                ? h(
                    'div',
                    { className: 'df-between' },
                    h('span', { className: 'df-muted' }, t('panel.duration')),
                    h(
                      'div',
                      { className: 'df-chips', role: 'group', 'aria-label': t('panel.duration') },
                      [15, 25, 50].map(function (minutes) {
                        return h(
                          'button',
                          {
                            key: minutes,
                            type: 'button',
                            className: 'df-chip',
                            'aria-pressed': preset === minutes ? 'true' : 'false',
                            disabled: busy,
                            onClick: function () {
                              setPreset(minutes)
                            },
                          },
                          t('settings.minutesValue', { n: minutes }),
                        )
                      }),
                    ),
                  )
                : null,
              error ? h('p', { className: 'df-error', role: 'alert' }, error) : null,
              h('div', { className: 'df-actions' }, actionNodes),
              state
                ? h(
                    'div',
                    { className: 'df-stats' },
                    h(
                      'span',
                      null,
                      t('panel.statActive'),
                      ' ',
                      h('b', null, fmtDuration(t, numberOr(state.usage && state.usage.activeTodayMs, 0))),
                    ),
                    h(
                      'span',
                      null,
                      t('panel.statContinuous'),
                      ' ',
                      h('b', null, fmtDuration(t, numberOr(state.usage && state.usage.continuousMs, 0))),
                    ),
                    h(
                      'span',
                      null,
                      t('panel.statPomodoros'),
                      ' ',
                      h('b', null, String(numberOr(focus && focus.pomodorosToday, 0))),
                    ),
                    topApp
                      ? h(
                          'span',
                          null,
                          t('panel.statTopApp'),
                          ' ',
                          h('b', null, appDisplayName(topApp) + ' · ' + fmtAppTime(topApp.ms)),
                        )
                      : null,
                  )
                : null,
              snapshot.error
                ? h(
                    'div',
                    { className: 'df-between' },
                    h('p', { className: 'df-error', role: 'status' }, t('panel.offline')),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'df-btn df-btn-ghost',
                        onClick: function () {
                          store.refreshSoon()
                        },
                      },
                      t('panel.retry'),
                    ),
                  )
                : null,
            ),
          ),
        )
      }

      /* ── Overtime overlay (no password, gentle buttons only) ─────────── */

      function OvertimeOverlay() {
        useLocaleTick()
        const snapshot = useStore(false)
        const state = snapshot.state
        const lock = state && state.lock
        const locked = Boolean(store.isVisible() && lock && lock.locked)
        const cardRef = React.useRef(null)
        const busyState = React.useState(false)
        const busy = busyState[0]
        const setBusy = busyState[1]
        const errorState = React.useState(null)
        const error = errorState[0]
        const setError = errorState[1]

        React.useEffect(
          function () {
            if (!locked) return undefined
            const card = cardRef.current
            if (!card) return undefined
            const autofocus = card.querySelector('[data-df-autofocus]')
            try {
              ;(autofocus || card).focus({ preventScroll: true })
            } catch (caught) {
              /* ignored */
            }
            const onKeyDown = function (event) {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                return
              }
              if (event.key !== 'Tab') return
              const nodes = card.querySelectorAll(
                'button:not([disabled]),input:not([disabled]),a[href],select,textarea,[tabindex]:not([tabindex="-1"])',
              )
              const list = Array.prototype.slice.call(nodes)
              if (!list.length) return
              const first = list[0]
              const last = list[list.length - 1]
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
              }
            }
            card.addEventListener('keydown', onKeyDown)
            return function () {
              card.removeEventListener('keydown', onKeyDown)
            }
          },
          [locked],
        )

        if (!locked) return null

        const settings = state.settings || {}
        const limits = settings.limits || {}
        const usage = state.usage || {}
        const unlockMinutes = clampNumber(numberOr(lock.unlockMinutes, limits.unlockMinutes), 1, 120, 20)
        const reason = String(lock.reason || 'manual')
        const reasonKey = 'lock.reason.' + reason
        const reasonText = I18N.en[reasonKey] !== undefined ? t(reasonKey) : t('lock.reason.manual')
        const dailyLimit = numberOr(limits.dailyActiveMinutes, 0)
        const continuousLimit = numberOr(limits.continuousWorkMinutes, 0)

        async function continueWorking() {
          if (busy) return
          setBusy(true)
          setError(null)
          const result = await store.unlock()
          setBusy(false)
          if (!result.ok) setError(t('lock.error'))
        }

        async function takeRest() {
          if (busy) return
          setBusy(true)
          setError(null)
          const result = await store.restUnlock()
          setBusy(false)
          if (!result.ok) setError(t('lock.error'))
        }

        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            {
              className: 'df-lock',
              'data-df-root': 'lock',
              'data-dsh-deep-focus-root': 'lock',
              'data-df': 'lock',
              role: 'presentation',
              style: { pointerEvents: 'auto' },
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
                'data-df': 'lock-card',
              },
              h('h2', { className: 'df-lock-title' }, t('lock.title')),
              h('p', { className: 'df-lock-reason' }, reasonText),
              h('p', { className: 'df-lock-body' }, t('lock.body')),
              h('hr', { className: 'df-divider' }),
              h(
                'div',
                { className: 'df-kv' },
                h('span', null, t('lock.usage')),
                h(
                  'span',
                  null,
                  h('b', null, fmtDuration(t, numberOr(usage.activeTodayMs, 0))),
                  dailyLimit > 0 ? ' / ' + fmtDuration(t, dailyLimit * 60000) : null,
                ),
              ),
              continuousLimit > 0
                ? h(
                    'div',
                    { className: 'df-kv' },
                    h('span', null, t('field.continuousWorkMinutes')),
                    h(
                      'span',
                      null,
                      h('b', null, fmtDuration(t, numberOr(usage.continuousMs, 0))),
                      ' / ' + fmtDuration(t, continuousLimit * 60000),
                    ),
                  )
                : null,
              h('p', { className: 'df-muted' }, t('lock.todayNote')),
              error ? h('p', { className: 'df-error', role: 'alert' }, error) : null,
              h(
                'div',
                { className: 'df-actions', style: { justifyContent: 'flex-end' } },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'df-btn',
                    disabled: busy,
                    title: t('lock.restHint'),
                    onClick: takeRest,
                    'data-df-autofocus': '',
                  },
                  h(IconLeaf),
                  t('lock.rest'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'df-btn df-btn-primary', disabled: busy, onClick: continueWorking },
                  t('lock.unlockFor', { n: unlockMinutes }),
                ),
              ),
            ),
          ),
        )
      }

      /* ── Toasts ──────────────────────────────────────────────────────── */

      function Toasts() {
        const snapshot = useStore(false)
        const visible = store.isVisible()
        if (!visible || snapshot.toasts.length === 0) return null
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
              'data-df': 'toasts',
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

      /* ── Settings page ───────────────────────────────────────────────── */

      function Switch(props) {
        return h('button', {
          type: 'button',
          role: 'switch',
          className: 'df-switch',
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

      function Section(props) {
        return h('section', { className: 'df-group' }, h('h3', { className: 'df-group-title' }, props.title), props.children)
      }

      function StatsChart(props) {
        const days = props.days
        const tt = props.t
        if (!days || days.length === 0) return h('p', { className: 'df-muted' }, tt('settings.stats.empty'))
        const max = Math.max(
          1,
          ...days.map(function (day) {
            return Math.max(numberOr(day && day.activeMs, 0), numberOr(day && day.focusMs, 0))
          }),
        )
        const height = 88
        const top = 8
        const slot = 40
        const width = slot * 7
        const barWidth = 13
        const elements = []
        for (let index = 0; index < 7; index += 1) {
          const day = days[index]
          const x = index * slot + 4
          if (!day) continue
          const activeH = Math.round((numberOr(day.activeMs, 0) / max) * height)
          const focusH = Math.round((numberOr(day.focusMs, 0) / max) * height)
          elements.push(
            h(
              'g',
              { key: 'day-' + index },
              h('title', null, tt('settings.stats.aria') + ': ' + weekdayLabel(tt, day.day)),
              activeH > 0
                ? h('rect', { className: 'df-bar-active', x: x, y: top + height - activeH, width: barWidth, height: activeH, rx: 2 })
                : null,
              focusH > 0
                ? h('rect', {
                    className: 'df-bar-focus',
                    x: x + barWidth + 2,
                    y: top + height - focusH,
                    width: barWidth,
                    height: focusH,
                    rx: 2,
                  })
                : null,
            ),
          )
        }
        return h(
          'div',
          { className: 'df-chart' },
          h(
            'svg',
            { viewBox: '0 0 ' + width + ' ' + (height + top + 4), role: 'img', 'aria-label': tt('settings.stats.aria') },
            h('line', { className: 'df-chart-axis', x1: 0, y1: top + height, x2: width, y2: top + height }),
            elements,
          ),
          h(
            'div',
            { className: 'df-chart-labels' },
            days.slice(0, 7).map(function (day, index) {
              return h('span', { key: 'label-' + index }, weekdayLabel(tt, day && day.day))
            }),
          ),
          h(
            'div',
            { className: 'df-chart-legend' },
            h(
              'span',
              null,
              h('span', { className: 'df-legend-dot', style: { background: 'var(--dsw-alias-border-l1)' } }),
              tt('settings.stats.legendActive'),
            ),
            h(
              'span',
              null,
              h('span', { className: 'df-legend-dot', style: { background: 'var(--dsw-alias-brand-primary)' } }),
              tt('settings.stats.legendFocus'),
            ),
          ),
        )
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

      function SettingsSection() {
        useLocaleTick()
        const snapshot = useStore(false)
        const state = snapshot.state
        const settings = state && state.settings
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

        React.useEffect(
          function () {
            store.loadStats()
          },
          [],
        )

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

        if (!draft) {
          return h(
            Fragment,
            null,
            h(Styles),
            h(
              'div',
              { className: 'df-settings', 'data-df-root': 'settings', 'data-dsh-deep-focus-root': 'settings' },
              h(
                'div',
                { className: 'df-settings-head' },
                h('h2', { className: 'df-settings-title' }, t('settings.title')),
                h('p', { className: 'df-settings-desc' }, snapshot.error ? t('settings.offline') : t('settings.loading')),
              ),
            ),
          )
        }

        const dirty = JSON.stringify(draft) !== JSON.stringify(cleanRef.current)
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
          const result = await store.saveSettings(draft)
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
            setSaveError(settingsErrorText(result))
          }
        }

        function discard() {
          if (!cleanRef.current) return
          setDraft(deepClone(cleanRef.current))
          setSaveError(null)
        }

        const disabled = saving
        const focusCfg = draft.focus || {}
        const limits = draft.limits || {}
        const alerts = draft.alerts || {}
        const usage = draft.usage || {}
        const sampling = state && state.usage ? state.usage.sampling : null
        const appsSampling = state && state.usage ? state.usage.appsSampling : null

        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            { className: 'df-settings', 'data-df-root': 'settings', 'data-dsh-deep-focus-root': 'settings' },
            h(
              'div',
              { className: 'df-settings-head' },
              h('h2', { className: 'df-settings-title' }, t('settings.title')),
              h('p', { className: 'df-settings-desc' }, snapshot.error ? t('settings.offline') : t('settings.desc')),
            ),
            h(
              Section,
              { title: t('settings.group.focus') },
              h(
                FieldRow,
                { label: t('field.workMinutes'), hint: t('field.workMinutes.hint') },
                h(NumberInput, {
                  value: focusCfg.workMinutes,
                  min: 1,
                  max: 180,
                  label: t('field.workMinutes'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('focus.workMinutes', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.breakMinutes'), hint: t('field.breakMinutes.hint') },
                h(NumberInput, {
                  value: focusCfg.breakMinutes,
                  min: 1,
                  max: 60,
                  label: t('field.breakMinutes'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('focus.breakMinutes', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.longBreakMinutes') },
                h(NumberInput, {
                  value: focusCfg.longBreakMinutes,
                  min: 1,
                  max: 120,
                  label: t('field.longBreakMinutes'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('focus.longBreakMinutes', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.longBreakEvery'), hint: t('field.longBreakEvery.hint') },
                h(NumberInput, {
                  value: focusCfg.longBreakEvery,
                  min: 0,
                  max: 12,
                  label: t('field.longBreakEvery'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('focus.longBreakEvery', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.autoStartBreak') },
                h(Switch, {
                  checked: Boolean(focusCfg.autoStartBreak),
                  label: t('field.autoStartBreak'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('focus.autoStartBreak', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.autoStartNext') },
                h(Switch, {
                  checked: Boolean(focusCfg.autoStartNext),
                  label: t('field.autoStartNext'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('focus.autoStartNext', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.idlePauseSeconds'), hint: t('field.idlePauseSeconds.hint') },
                h(NumberInput, {
                  value: focusCfg.idlePauseSeconds,
                  min: 0,
                  max: 3600,
                  label: t('field.idlePauseSeconds'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('focus.idlePauseSeconds', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.autoResumeOnReturn') },
                h(Switch, {
                  checked: Boolean(focusCfg.autoResumeOnReturn),
                  label: t('field.autoResumeOnReturn'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('focus.autoResumeOnReturn', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.grayOutOtherSessions'), hint: t('field.grayOutOtherSessions.hint') },
                h(Switch, {
                  checked: focusCfg.grayOutOtherSessions !== false,
                  label: t('field.grayOutOtherSessions'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('focus.grayOutOtherSessions', value)
                  },
                }),
              ),
            ),
            h(
              Section,
              { title: t('settings.group.limits') },
              h(
                FieldRow,
                { label: t('field.dailyActiveMinutes'), hint: t('field.dailyActiveMinutes.hint') },
                h(NumberInput, {
                  value: limits.dailyActiveMinutes,
                  min: 0,
                  max: 1440,
                  step: 5,
                  label: t('field.dailyActiveMinutes'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('limits.dailyActiveMinutes', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.continuousWorkMinutes'), hint: t('field.continuousWorkMinutes.hint') },
                h(NumberInput, {
                  value: limits.continuousWorkMinutes,
                  min: 0,
                  max: 1440,
                  step: 5,
                  label: t('field.continuousWorkMinutes'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('limits.continuousWorkMinutes', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.sessionMinutes'), hint: t('field.sessionMinutes.hint') },
                h(NumberInput, {
                  value: limits.sessionMinutes,
                  min: 0,
                  max: 1440,
                  step: 5,
                  label: t('field.sessionMinutes'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('limits.sessionMinutes', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.unlockMinutes'), hint: t('field.unlockMinutes.hint') },
                h(NumberInput, {
                  value: limits.unlockMinutes,
                  min: 1,
                  max: 120,
                  step: 5,
                  label: t('field.unlockMinutes'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('limits.unlockMinutes', value)
                  },
                }),
              ),
            ),
            h(
              Section,
              { title: t('settings.group.alerts') },
              h(
                FieldRow,
                { label: t('field.taskDone') },
                h(Switch, {
                  checked: Boolean(alerts.taskDone),
                  label: t('field.taskDone'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('alerts.taskDone', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.turnDone') },
                h(Switch, {
                  checked: Boolean(alerts.turnDone),
                  label: t('field.turnDone'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('alerts.turnDone', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.sound') },
                h(Switch, {
                  checked: Boolean(alerts.sound),
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
                    disabled: disabled,
                    onClick: function () {
                      audio.unlock()
                      audio.chime(numberOr(alerts.volume, 0.6))
                    },
                  },
                  t('settings.preview'),
                ),
              ),
              h(
                FieldRow,
                { label: t('field.volume') },
                h('input', {
                  className: 'df-range',
                  type: 'range',
                  min: 0,
                  max: 100,
                  step: 5,
                  value: String(Math.round(numberOr(alerts.volume, 0.6) * 100)),
                  'aria-label': t('field.volume'),
                  disabled: disabled,
                  onChange: function (event) {
                    patch('alerts.volume', Number(event.target.value) / 100)
                  },
                }),
                h('span', { className: 'df-field-hint' }, t('settings.volumeValue', { n: Math.round(numberOr(alerts.volume, 0.6) * 100) })),
              ),
              h(
                FieldRow,
                { label: t('field.quietHours'), hint: t('field.quietHours.hint') },
                h('input', {
                  className: 'df-time',
                  type: 'time',
                  step: 60,
                  value: typeof alerts.quietHoursStart === 'string' ? alerts.quietHoursStart : '',
                  'aria-label': t('field.quietHoursStart'),
                  disabled: disabled,
                  onChange: function (event) {
                    patch('alerts.quietHoursStart', event.target.value || null)
                  },
                }),
                h('span', { className: 'df-field-hint' }, t('field.quietHoursEnd')),
                h('input', {
                  className: 'df-time',
                  type: 'time',
                  step: 60,
                  value: typeof alerts.quietHoursEnd === 'string' ? alerts.quietHoursEnd : '',
                  'aria-label': t('field.quietHoursEnd'),
                  disabled: disabled,
                  onChange: function (event) {
                    patch('alerts.quietHoursEnd', event.target.value || null)
                  },
                }),
              ),
            ),
            h(
              Section,
              { title: t('settings.group.usage') },
              h(
                FieldRow,
                { label: t('field.sampleSeconds'), hint: t('field.sampleSeconds.hint') },
                h(NumberInput, {
                  value: usage.sampleSeconds,
                  min: 3,
                  max: 30,
                  label: t('field.sampleSeconds'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('usage.sampleSeconds', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.idleThresholdSeconds'), hint: t('field.idleThresholdSeconds.hint') },
                h(NumberInput, {
                  value: usage.idleThresholdSeconds,
                  min: 0,
                  max: 3600,
                  step: 5,
                  label: t('field.idleThresholdSeconds'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('usage.idleThresholdSeconds', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.retentionDays'), hint: t('field.retentionDays.hint') },
                h(NumberInput, {
                  value: usage.retentionDays,
                  min: 1,
                  max: 365,
                  label: t('field.retentionDays'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('usage.retentionDays', value)
                  },
                }),
              ),
              h(
                FieldRow,
                { label: t('field.trackApps'), hint: t('field.trackApps.hint') },
                h(Switch, {
                  checked: usage.trackApps !== false,
                  label: t('field.trackApps'),
                  disabled: disabled,
                  onChange: function (value) {
                    patch('usage.trackApps', value)
                  },
                }),
              ),
              sampling && sampling !== 'ok'
                ? h(
                    'p',
                    { className: 'df-error', role: 'status' },
                    t(sampling === 'off' ? 'settings.sampling.off' : 'settings.sampling.degraded'),
                  )
                : null,
              appsSampling === 'off'
                ? h('p', { className: 'df-field-hint', role: 'status' }, t('settings.appsSampling.off'))
                : null,
              h('p', { className: 'df-field-hint' }, t('settings.note.sampling')),
            ),
            h(Section, { title: t('settings.group.privacy') }, h('p', { className: 'df-field-hint' }, t('settings.note.privacy'))),
            h(
              Section,
              { title: t('settings.group.stats') },
              snapshot.stats
                ? h(StatsChart, { t: t, days: (snapshot.stats.days || []).slice(-7) })
                : h(
                    'p',
                    { className: 'df-muted' },
                    snapshot.statsLoading ? t('settings.stats.loading') : t('settings.stats.empty'),
                  ),
              snapshot.stats && snapshot.stats.today
                ? h(
                    'div',
                    null,
                    h('h3', { className: 'df-group-title' }, t('settings.group.today')),
                    h(
                      'div',
                      { className: 'df-today' },
                      h(
                        'div',
                        { className: 'df-today-item' },
                        h('span', null, t('settings.today.active')),
                        h('b', null, fmtDuration(t, numberOr(snapshot.stats.today.activeMs, 0))),
                      ),
                      h(
                        'div',
                        { className: 'df-today-item' },
                        h('span', null, t('settings.today.focus')),
                        h('b', null, fmtDuration(t, numberOr(snapshot.stats.today.focusMs, 0))),
                      ),
                      h(
                        'div',
                        { className: 'df-today-item' },
                        h('span', null, t('settings.today.breaks')),
                        h('b', null, String(numberOr(snapshot.stats.today.breakCount, 0))),
                      ),
                      h(
                        'div',
                        { className: 'df-today-item' },
                        h('span', null, t('settings.today.pomodoros')),
                        h('b', null, String(numberOr(snapshot.stats.today.pomodoros, 0))),
                      ),
                      h(
                        'div',
                        { className: 'df-today-item' },
                        h('span', null, t('settings.today.apps')),
                        h('b', null, String(todayAppsFromState(state).length)),
                      ),
                    ),
                  )
                : null,
            ),
            h(
              'div',
              { className: 'df-savebar' },
              h(
                'button',
                { type: 'button', className: 'df-btn df-btn-primary', disabled: !dirty || saving, onClick: save },
                t('settings.save'),
              ),
              dirty ? h('button', { type: 'button', className: 'df-btn', disabled: saving, onClick: discard }, t('settings.reset')) : null,
              saving
                ? h('span', { className: 'df-save-state' }, '…')
                : saveError
                  ? h('span', { className: 'df-save-state', 'data-kind': 'error', role: 'alert' }, saveError)
                  : saved
                    ? h('span', { className: 'df-save-state', 'data-kind': 'saved' }, t('settings.saved'))
                    : dirty
                      ? h('span', { className: 'df-save-state' }, t('settings.dirty'))
                      : null,
            ),
          ),
        )
      }

      /* ── Usage stats: central panel (main keyed slot) ────────────────── */

      function layoutSelectPanel(id) {
        try {
          const layout = ctx && typeof ctx.get === 'function' ? ctx.get('layout') : undefined
          if (layout && typeof layout.selectPanel === 'function') {
            layout.selectPanel(id)
            return true
          }
        } catch (error) {
          /* the back affordance is optional */
        }
        return false
      }

      function UsageTrendChart(props) {
        const days = props.days
        const topRows = props.topRows
        const t = props.t
        if (!days || days.length === 0) return h('p', { className: 'df-usage-empty' }, t('stats.trendEmpty'))
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
              h('title', null, weekdayLabel(t, day.day) + ' · ' + fmtDuration(t, totals[index])),
              segments,
            ),
          )
        }
        return h(
          'div',
          { className: 'df-usage-chart' },
          h(
            'svg',
            { viewBox: '0 0 ' + width + ' ' + (height + top + 4), role: 'img', 'aria-label': t('stats.chartAria') },
            h('line', { className: 'df-usage-axis', x1: 0, y1: top + height, x2: width, y2: top + height }),
            elements,
          ),
          h(
            'div',
            { className: 'df-chart-labels' },
            days.slice(0, 7).map(function (day, index) {
              return h('span', { key: 'label-' + index }, weekdayLabel(t, day && day.day))
            }),
          ),
        )
      }

      function UsageLegend(props) {
        const t = props.t
        return h(
          'div',
          { className: 'df-usage-legend', role: 'list', 'aria-label': t('stats.legendAria') },
          props.rows.map(function (row, index) {
            return h(
              'span',
              { key: row.id, role: 'listitem' },
              h('span', { className: 'df-legend-dot df-legend-dot-' + index, style: { background: segmentColor(index) } }),
              appDisplayName(row),
            )
          }),
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

      function UsagePanel() {
        useLocaleTick()
        const snapshot = useStore(false)
        const state = snapshot.state
        const dayKey = state && state.usage ? state.usage.dayKey : null

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

        if (!store.isVisible()) return null

        const topApps = todayAppsFromState(state)
        const maxAppMs = Math.max(1, ...topApps.map(function (row) { return row.ms }))
        const activeToday = numberOr(state && state.usage && state.usage.activeTodayMs, todayAppsTotal(state))
        const appsSampling = state && state.usage ? state.usage.appsSampling : null
        const trend = snapshot.appsTrend
        const trendDays = trend && Array.isArray(trend.days) ? trend.days.slice(-7) : []
        const trendTop = trend && Array.isArray(trend.top) && trend.top.length > 0 ? trend.top : topApps
        const topRows = trendTop.slice(0, TREND_SEGMENTS)
        const todayTotal = todayAppsTotal(state)

        function refresh() {
          store.loadAppsTrend(true)
          store.loadStats(true)
          store.refreshSoon()
        }

        return h(
          Fragment,
          null,
          h(Styles),
          h(
            'div',
            { className: 'df-usage', 'data-df-root': 'usage', 'data-dsh-deep-focus-root': 'usage' },
            h(
              'div',
              { className: 'df-usage-inner' },
              h(
                'div',
                { className: 'df-usage-head' },
                h(
                  'div',
                  null,
                  h('h2', { className: 'df-usage-title' }, t('stats.title')),
                  h('p', { className: 'df-usage-sub' }, t('stats.subtitle')),
                ),
                h(
                  'div',
                  { className: 'df-usage-actions' },
                  h(
                    'button',
                    { type: 'button', className: 'df-btn df-btn-sm', onClick: refresh },
                    h(IconRefresh),
                    t('stats.refresh'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'df-btn df-btn-sm df-btn-ghost',
                      onClick: function () {
                        layoutSelectPanel(null)
                      },
                    },
                    t('stats.back'),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'df-cards' },
                h(
                  'div',
                  { className: 'df-card' },
                  h('div', { className: 'df-card-label' }, t('stats.todayActive')),
                  h('div', { className: 'df-card-value' }, fmtDuration(t, activeToday)),
                  h('div', { className: 'df-card-label' }, t('stats.trackNote')),
                ),
                h(
                  'div',
                  { className: 'df-card' },
                  h('div', { className: 'df-card-label' }, t('stats.todayApps')),
                  h('div', { className: 'df-card-value' }, fmtDuration(t, todayTotal)),
                ),
              ),
              appsSampling === 'off'
                ? h('p', { className: 'df-usage-note', role: 'status' }, t('stats.samplingOff'))
                : null,
              h(
                'section',
                { className: 'df-section' },
                h('h3', { className: 'df-section-title' }, t('stats.todayApps')),
                topApps.length === 0
                  ? h('p', { className: 'df-usage-empty' }, t('stats.noApps'))
                  : h(
                      Fragment,
                      null,
                      topApps.map(function (row) {
                        return h(
                          'div',
                          { key: row.id, className: 'df-app-row' },
                          h('span', { className: 'df-app-name', title: appDisplayName(row) }, appDisplayName(row)),
                          h(
                            'span',
                            { className: 'df-app-bar' },
                            h('span', {
                              className: 'df-app-bar-fill',
                              style: { width: Math.max(2, Math.round((row.ms / maxAppMs) * 100)) + '%' },
                            }),
                          ),
                          h('span', { className: 'df-app-time' }, fmtAppTime(row.ms)),
                        )
                      }),
                    ),
              ),
              h(
                'section',
                { className: 'df-section' },
                h('h3', { className: 'df-section-title' }, t('stats.trend')),
                snapshot.appsLoading && !trend
                  ? h('p', { className: 'df-usage-empty' }, t('stats.loading'))
                  : snapshot.appsError && !trend
                    ? h('p', { className: 'df-usage-empty', role: 'status' }, t('stats.loadFailed'))
                    : h(UsageTrendChart, { t: t, days: trendDays, topRows: topRows }),
                trendDays.length > 0 && topRows.length > 0 ? h(UsageLegend, { t: t, rows: topRows }) : null,
              ),
              h('p', { className: 'df-usage-note' }, t('stats.privacy')),
            ),
          ),
        )
      }

      return {
        t: t,
        store: store,
        start: start,
        components: {
          FocusPill: FocusPill,
          FocusPanel: FocusPanel,
          Toasts: Toasts,
          OvertimeOverlay: OvertimeOverlay,
          SettingsSection: SettingsSection,
          FocusStatsIcon: FocusStatsIcon,
          UsagePanel: UsagePanel,
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
          }, 'dsh-deep-focus: polling, sound and sidebar nudges')
        } catch (error) {
          /* the store is defensive; slots still register */
        }

        /** Register one slot contribution; returns its disposer (or a noop). */
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
          ['conversation.input.right', { name: 'conversation.input.right', id: 'dsh-deep-focus-pill', order: 30 }, client.components.FocusPill],
          ['shell.overlay', { name: 'shell.overlay', id: 'dsh-deep-focus-panel', order: 20 }, client.components.FocusPanel],
          ['shell.overlay', { name: 'shell.overlay', id: 'dsh-deep-focus-toasts', order: 90 }, client.components.Toasts],
          ['shell.overlay', { name: 'shell.overlay', id: 'dsh-deep-focus-lock', order: 100 }, client.components.OvertimeOverlay],
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

        // Navigable entries (settings page, sidebar usage row, usage main panel) are
        // registered only while the Host API is live, so a disabled/unreachable Host
        // leaves no empty pages or dead sidebar rows behind.
        const navigableEntries = [
          [
            'settings.section',
            {
              name: 'settings.section',
              id: 'deep-focus',
              order: 20,
              label: function () {
                try {
                  return client.t('settings.nav')
                } catch (error) {
                  return 'Deep focus'
                }
              },
            },
            client.components.SettingsSection,
          ],
          [
            'sidebar.panellist',
            {
              name: 'sidebar.panellist',
              id: 'focus-stats',
              order: 10,
              label: function () {
                try {
                  return client.t('stats.title')
                } catch (error) {
                  return 'Usage'
                }
              },
            },
            client.components.FocusStatsIcon,
          ],
          ['main', { name: 'main', key: 'focus-stats' }, client.components.UsagePanel],
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
