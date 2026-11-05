/**
 * dsh-deep-focus — browser half (single self-contained Client bundle).
 *
 * Registers: composer pill, floating panel, lock overlay, toasts, settings page,
 * plus best-effort sidebar locking. All Host data comes from the same-origin
 * HTTP API; the Host half stays authoritative for every state transition.
 *
 * Loaded by the DSH web client as a lazy CJS closure factory. Only `react` may
 * be required; everything else is plain browser API.
 */
window.__ModuleLoader__.load({
  id: 'dsh-deep-focus',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const Fragment = React.Fragment

    /* ── Wire contract ────────────────────────────────────────────────────
     * Small copy of src/shared/contract.js — keep routes, event kinds and
     * setting names in sync when the shared contract changes. */
    const API_BASE = '/plugins/dsh-deep-focus/api'
    const ROUTES = {
      state: API_BASE + '/state',
      stats: API_BASE + '/stats',
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
    const CLOCK_TICK_MS = 500
    const SIDE_DIM_OPACITY = '0.45'
    const MAX_ANCESTOR_DEPTH = 12
    const MAX_BLOCKED_IDS = 400

    /* ── i18n: every user-facing string lives here (zh + en) ───────────── */
    const NS = 'deepFocus'
    const I18N = {
      zh: {
        'nav.label': '深度专注',
        'pill.idle': '专注',
        'pill.aria': '专注计时，点击打开面板',
        'pill.offline': '连接中断，状态可能不是最新',
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
        'panel.today': '今日',
        'panel.statActive': '活跃',
        'panel.statContinuous': '连续',
        'panel.statPomodoros': '番茄',
        'panel.offline': '连接中断，显示最后一次数据',
        'panel.retry': '重试',
        'panel.endFocus': '结束专注',
        'panel.outsideSession': '你正在其它会话。专注只绑定一个会话，结束专注即可解锁。',
        'panel.bindingLost': '专注绑定的会话已不存在，结束专注即可重新开始。',
        'pill.lockedAria': '专注进行中，只能使用专注会话；点击打开面板结束专注',
        'pill.bindingLost': '绑定会话已不存在',
        'lock.title': '该休息一下了',
        'lock.reason.daily': '今日活跃时长已达上限',
        'lock.reason.continuous': '连续工作时长已达上限',
        'lock.reason.session': '本次专注时长已达上限',
        'lock.reason.manual': '应用已被锁定',
        'lock.usageTitle': '今日使用',
        'lock.active': '活跃',
        'lock.continuous': '连续工作',
        'lock.limit': '上限',
        'lock.unlockCount': '已解锁 {n} 次',
        'lock.password': '解锁密码',
        'lock.passwordPlaceholder': '输入解锁密码',
        'lock.enterPassword': '请输入密码',
        'lock.unlockFor': '再使用 {n} 分钟',
        'lock.rest': '休息一下',
        'lock.restHint': '结束本次专注并解锁',
        'lock.strict': '严格模式已开启，只能休息一下。',
        'lock.limitReached': '今日解锁次数已用完，请休息一下。',
        'lock.noPassword': '还没有设置解锁密码，请先在设置里设置。',
        'lock.badPassword': '密码不正确',
        'lock.offline': '暂时无法连接插件服务，请稍后重试。',
        'lock.escHint': '锁定期间无法关闭，输入密码或休息一下即可继续。',
        'lock.openSettings': '去设置密码',
        'toast.focusCompleted': '专注完成 · {minutes} 分钟',
        'toast.focusCompletedTask': '已完成：{task}',
        'toast.taskCompleted': '任务完成',
        'toast.breakCompleted': '休息结束，准备下一轮',
        'toast.focusStopped': '专注已结束',
        'toast.locked': '已锁定：{reason}',
        'toast.unlocked': '已解锁，可再使用 {minutes} 分钟',
        'toast.unlockedRest': '已解锁，先休息一下',
        'toast.limitWarning': '接近使用上限',
        'toast.sidebarBlocked': '专注中，只能进入当前会话',
        'settings.nav': '深度专注',
        'settings.title': '深度专注',
        'settings.desc': '番茄专注 + 单会话锁定 + 整机活跃统计。设置保存在本机，修改后点保存生效。',
        'settings.group.focus': '专注计时',
        'settings.group.limits': '使用限制',
        'settings.group.lock': '会话锁',
        'settings.group.alerts': '提醒与音效',
        'settings.group.usage': '统计与数据',
        'settings.group.security': '解锁密码',
        'settings.group.stats': '最近 7 天',
        'settings.group.today': '今日概览',
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
        'field.dailyActiveMinutes': '每日活跃上限',
        'field.dailyActiveMinutes.hint': '分钟，0 = 不限',
        'field.continuousWorkMinutes': '连续工作上限',
        'field.continuousWorkMinutes.hint': '分钟，0 = 不限',
        'field.sessionMinutes': '单次专注上限',
        'field.sessionMinutes.hint': '分钟，0 = 不限',
        'field.unlockMinutes': '解锁增加时长',
        'field.unlockMinutes.hint': '分钟',
        'field.dailyUnlockLimit': '每日解锁次数',
        'field.dailyUnlockLimit.hint': '0 = 不限',
        'field.strictNoUnlock': '严格模式',
        'field.strictNoUnlock.hint': '锁定后只能休息，不能输密码',
        'field.singleConversation': '单会话锁',
        'field.blockToolsOutsideFocus': '拒绝其它会话的工具调用',
        'field.lockSidebarOutsideFocus': '侧栏不可进入其它会话',
        'field.exemptSubagents': '子代理豁免',
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
        'field.detectMedia': '媒体播放视为活跃',
        'field.currentPassword': '当前密码',
        'field.newPassword': '新密码',
        'field.newPassword.hint': '至少 6 位',
        'field.confirmPassword': '确认密码',
        'settings.setPassword': '设置密码',
        'settings.changePassword': '修改密码',
        'settings.clearPassword': '清除密码',
        'settings.passwordSet': '密码已设置',
        'settings.passwordSaved': '密码已更新',
        'settings.passwordCleared': '密码已清除',
        'settings.passwordRequired': '请输入至少 6 位的新密码',
        'settings.passwordMismatch': '两次输入的密码不一致',
        'settings.preview': '试听',
        'settings.save': '保存设置',
        'settings.reset': '放弃修改',
        'settings.dirty': '有未保存的修改',
        'settings.saved': '已保存',
        'settings.note.privacy': '数据只保存在本机，不会上传。',
        'settings.note.sampling': '只在 DSH 运行时统计整机活跃时间；未运行时段不计入。',
        'settings.sampling.degraded': '系统活跃采样已降级，统计可能不完整。',
        'settings.sampling.off': '系统活跃采样不可用，计时功能不受影响。',
        'settings.offline': '插件服务暂不可用，正在重试…',
        'settings.stats.empty': '还没有统计数据',
        'settings.stats.loading': '正在加载统计…',
        'settings.loadingPassword': '正在读取密码状态…',
        'settings.stats.aria': '最近 7 天活跃与专注时长柱状图',
        'settings.stats.legendActive': '活跃',
        'settings.stats.legendFocus': '专注',
        'settings.today.active': '今日活跃',
        'settings.today.focus': '今日专注',
        'settings.today.breaks': '休息次数',
        'settings.today.pomodoros': '完成轮数',
        'settings.today.unlocks': '解锁次数',
        'settings.hintZeroUnlimited': '0 = 不限',
        'settings.error.invalid': '设置有误，未保存',
        'settings.error.tooShort': '密码至少 6 位',
        'settings.error.mismatch': '两次输入的密码不一致',
        'settings.error.missingCurrent': '需要输入当前密码',
        'settings.error.badPassword': '当前密码不正确',
        'settings.error.saveFailed': '保存失败，请重试',
        'error.generic': '操作失败，请重试',
        'error.network': '无法连接插件服务',
        'error.notRunning': '当前没有进行中的专注',
        'error.alreadyRunning': '已有专注在进行中',
        'error.notPaused': '当前专注未暂停',
        'time.hm': '{h} 小时 {m} 分',
        'time.m': '{m} 分钟',
        'settings.minutesValue': '{n} 分钟',
        'settings.volumeValue': '{n}%',
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
        'pill.offline': 'Disconnected — state may be stale',
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
        'panel.today': 'Today',
        'panel.statActive': 'Active',
        'panel.statContinuous': 'Streak',
        'panel.statPomodoros': 'Pomodoros',
        'panel.offline': 'Disconnected — showing the last known state',
        'panel.retry': 'Retry',
        'panel.endFocus': 'End focus',
        'panel.outsideSession': 'You are in another conversation. Focus is bound to one conversation — end focus to unlock.',
        'panel.bindingLost': 'The conversation this focus was bound to no longer exists — end focus to start over.',
        'pill.lockedAria': 'Focus in progress — only the focus conversation is available; click to open the panel and end focus',
        'pill.bindingLost': 'Bound conversation no longer exists',
        'lock.title': 'Time for a break',
        'lock.reason.daily': 'Daily active time limit reached',
        'lock.reason.continuous': 'Continuous work limit reached',
        'lock.reason.session': 'This focus block reached its limit',
        'lock.reason.manual': 'The app is locked',
        'lock.usageTitle': "Today's usage",
        'lock.active': 'Active',
        'lock.continuous': 'Continuous',
        'lock.limit': 'Limit',
        'lock.unlockCount': 'Unlocked {n}× today',
        'lock.password': 'Unlock password',
        'lock.passwordPlaceholder': 'Enter the unlock password',
        'lock.enterPassword': 'Enter the password',
        'lock.unlockFor': 'Use for {n} more min',
        'lock.rest': 'Take a break',
        'lock.restHint': 'Ends this focus block and unlocks',
        'lock.strict': 'Strict mode: the only way out is a break.',
        'lock.limitReached': 'No unlocks left today. Take a break.',
        'lock.noPassword': 'No unlock password set yet. Set one in Settings.',
        'lock.badPassword': 'Incorrect password',
        'lock.offline': 'Cannot reach the plugin service. Try again shortly.',
        'lock.escHint': 'This lock cannot be dismissed — unlock or take a break.',
        'lock.openSettings': 'Open settings',
        'toast.focusCompleted': 'Focus complete · {minutes} min',
        'toast.focusCompletedTask': 'Done: {task}',
        'toast.taskCompleted': 'Task completed',
        'toast.breakCompleted': 'Break over — ready for the next round',
        'toast.focusStopped': 'Focus ended',
        'toast.locked': 'Locked: {reason}',
        'toast.unlocked': 'Unlocked for {minutes} more minutes',
        'toast.unlockedRest': 'Unlocked — take a break',
        'toast.limitWarning': 'Approaching the usage limit',
        'toast.sidebarBlocked': 'Focus in progress — only the active conversation is available',
        'settings.nav': 'Deep focus',
        'settings.title': 'Deep focus',
        'settings.desc': 'Pomodoro focus, one-conversation lock, whole-machine activity. Settings are stored locally; press Save to apply.',
        'settings.group.focus': 'Focus timer',
        'settings.group.limits': 'Usage limits',
        'settings.group.lock': 'Conversation lock',
        'settings.group.alerts': 'Alerts & sound',
        'settings.group.usage': 'Tracking & data',
        'settings.group.security': 'Unlock password',
        'settings.group.stats': 'Last 7 days',
        'settings.group.today': "Today's summary",
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
        'field.dailyActiveMinutes': 'Daily active limit',
        'field.dailyActiveMinutes.hint': 'minutes, 0 = unlimited',
        'field.continuousWorkMinutes': 'Continuous work limit',
        'field.continuousWorkMinutes.hint': 'minutes, 0 = unlimited',
        'field.sessionMinutes': 'Single focus limit',
        'field.sessionMinutes.hint': 'minutes, 0 = unlimited',
        'field.unlockMinutes': 'Unlock grants',
        'field.unlockMinutes.hint': 'minutes',
        'field.dailyUnlockLimit': 'Unlocks per day',
        'field.dailyUnlockLimit.hint': '0 = unlimited',
        'field.strictNoUnlock': 'Strict mode',
        'field.strictNoUnlock.hint': 'break only, no password unlock',
        'field.singleConversation': 'One-conversation lock',
        'field.blockToolsOutsideFocus': 'Deny tools in other conversations',
        'field.lockSidebarOutsideFocus': 'Block other conversations in the sidebar',
        'field.exemptSubagents': 'Exempt subagents',
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
        'field.detectMedia': 'Treat media playback as active',
        'field.currentPassword': 'Current password',
        'field.newPassword': 'New password',
        'field.newPassword.hint': 'at least 6 characters',
        'field.confirmPassword': 'Confirm password',
        'settings.setPassword': 'Set password',
        'settings.changePassword': 'Change password',
        'settings.clearPassword': 'Clear password',
        'settings.passwordSet': 'Password set',
        'settings.passwordSaved': 'Password updated',
        'settings.passwordCleared': 'Password cleared',
        'settings.passwordRequired': 'Enter a new password of at least 6 characters',
        'settings.passwordMismatch': 'The two passwords do not match',
        'settings.preview': 'Preview',
        'settings.save': 'Save settings',
        'settings.reset': 'Discard changes',
        'settings.dirty': 'Unsaved changes',
        'settings.saved': 'Saved',
        'settings.note.privacy': 'Stored locally only; never uploaded.',
        'settings.note.sampling': 'Whole-machine activity is sampled only while DSH is running.',
        'settings.sampling.degraded': 'System activity sampling is degraded — data may be incomplete.',
        'settings.sampling.off': 'System activity sampling is unavailable; timers still work.',
        'settings.offline': 'Plugin service unavailable — retrying…',
        'settings.stats.empty': 'No data yet',
        'settings.stats.loading': 'Loading stats…',
        'settings.loadingPassword': 'Reading password status…',
        'settings.stats.aria': 'Bar chart of active and focus minutes over the last 7 days',
        'settings.stats.legendActive': 'Active',
        'settings.stats.legendFocus': 'Focus',
        'settings.today.active': 'Active today',
        'settings.today.focus': 'Focus today',
        'settings.today.breaks': 'Breaks',
        'settings.today.pomodoros': 'Rounds',
        'settings.today.unlocks': 'Unlocks',
        'settings.hintZeroUnlimited': '0 = unlimited',
        'settings.error.invalid': 'Invalid settings — not saved',
        'settings.error.tooShort': 'Password must be at least 6 characters',
        'settings.error.mismatch': 'The two passwords do not match',
        'settings.error.missingCurrent': 'Current password required',
        'settings.error.badPassword': 'Current password is incorrect',
        'settings.error.saveFailed': 'Save failed — try again',
        'error.generic': 'Something went wrong. Try again.',
        'error.network': 'Cannot reach the plugin service',
        'error.notRunning': 'No focus block is running',
        'error.alreadyRunning': 'A focus block is already running',
        'error.notPaused': 'The focus block is not paused',
        'time.hm': '{h}h {m}m',
        'time.m': '{m}m',
        'settings.minutesValue': '{n} min',
        'settings.volumeValue': '{n}%',
        'wd.0': 'Sun',
        'wd.1': 'Mon',
        'wd.2': 'Tue',
        'wd.3': 'Wed',
        'wd.4': 'Thu',
        'wd.5': 'Fri',
        'wd.6': 'Sat',
      },
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

    /** Human duration, localized through `t` ("{h}h {m}m" / "{h} 小时 {m} 分"). */
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
      return start < end
        ? current >= start && current < end
        : current >= start || current < end
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
      const remaining = numberOr(focus.remainingMs, 0)
      return Math.max(0, remaining)
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
      const minutes =
        focus.phase === 'break'
          ? numberOr(focusCfg.breakMinutes, 5)
          : numberOr(focusCfg.workMinutes, 25)
      return minutes * 60000
    }

    function isKnownFocusPhase(phase) {
      return phase === 'work' || phase === 'break'
    }

    /**
     * Owner set the Host enforces for the one-conversation lock:
     * - budget lock active -> no owner concept (the lock overlay covers the app)
     * - a running/paused work or break block -> owner is the focus session
     * - otherwise every running session is an owner
     * Returns the sidebar blocking decision derived from that set.
     */
    function computeSidebarLock(state) {
      const inactive = { active: false, owners: null, blocked: new Set() }
      if (!state || !state.focus || !state.settings) return inactive
      const lock = (state.settings && state.settings.lock) || {}
      if (state.lock && state.lock.locked) return inactive
      if (!lock.singleConversation) return inactive
      if (lock.lockSidebarOutsideFocus === false) return inactive
      // Stale/unknown binding: the Host does not deny for it, so do not dim or
      // block anything. `true` and an absent field keep the owner-set behavior.
      const sessionLive = state.focus.sessionLive
      if (sessionLive === false || sessionLive === null) return inactive
      const focus = state.focus
      const phase = focus.phase || 'idle'
      const status = focus.status || 'idle'
      const owners = new Set()
      if (isKnownFocusPhase(phase) && (status === 'running' || status === 'paused') && focus.sessionId) {
        owners.add(String(focus.sessionId))
      }
      if (owners.size === 0) {
        const sessions = Array.isArray(state.sessions) ? state.sessions : []
        for (const session of sessions) {
          if (session && session.running && session.id) owners.add(String(session.id))
        }
      }
      if (owners.size === 0) return inactive
      const known = new Set()
      const sessions = Array.isArray(state.sessions) ? state.sessions : []
      for (const session of sessions) {
        if (session && session.id) known.add(String(session.id))
      }
      const blocked = new Set()
      for (const id of known) {
        if (!owners.has(id) && blocked.size < MAX_BLOCKED_IDS) blocked.add(id)
      }
      return { active: blocked.size > 0, owners, blocked }
    }

    /**
     * Stale-binding flag from the Host: false means the focus points at a
     * conversation that no longer exists (the tool guard does not deny for it,
     * so the UI must relax its lock too). null/undefined stay "unknown".
     */
    function focusBindingLost(state) {
      return Boolean(state && state.focus && state.focus.sessionLive === false)
    }

    /**
     * The conversation entitled to the app while a focus block runs, or null.
     * The pill and the global panel use this so a user stranded in another
     * conversation always gets an obvious way out (end focus).
     */
    function conversationLockOwner(state) {
      if (!state || !state.focus) return null
      if (state.lock && state.lock.locked) return null
      const focus = state.focus
      if (!isKnownFocusPhase(focus.phase)) return null
      if (focus.status !== 'running' && focus.status !== 'paused') return null
      if (!focus.sessionId) return null
      return String(focus.sessionId)
    }

    /** True when the current conversation is not the focus owner. */
    function isOutsideFocusConversation(state, currentSessionId) {
      const owner = conversationLockOwner(state)
      if (!owner || !currentSessionId) return false
      return String(currentSessionId) !== owner
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
        return { ok, status: response.status, data }
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

      return { unlock, chime }
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
      '.df-pill[data-locked="true"]{border-color:var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.df-pill[data-locked="true"] .df-pill-time{color:var(--dsw-alias-state-warn-primary)}',
      '.df-pill[data-binding="lost"]{border-color:var(--dsw-alias-state-warn-primary);border-style:dashed}',
      '.df-pill[data-binding="lost"] .df-pill-task{color:var(--dsw-alias-state-warn-primary);max-width:120px}',
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
      '.df-actions{display:flex;gap:8px;flex-wrap:wrap}',
      '.df-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:0}',
      '.df-stats{display:flex;gap:12px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.df-stats b{color:var(--dsw-alias-label-primary);font-weight:600}',
      '.df-toasts{position:absolute;top:var(--dsh-frame-overlay-top,56px);right:16px;z-index:60;display:flex;flex-direction:column;gap:8px;max-width:340px;pointer-events:none}',
      '.df-toast{box-sizing:border-box;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:1.45;box-shadow:0 8px 24px color-mix(in srgb, var(--dsw-alias-bg-overlay) 55%, transparent);animation:df-toast-in .18s ease-out}',
      '.df-toast[data-kind="locked"]{border-color:var(--dsw-alias-state-warn-primary)}',
      '.df-toast[data-kind="focus-completed"],.df-toast[data-kind="task-completed"]{border-color:var(--dsw-alias-state-success-primary)}',
      '@keyframes df-toast-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
      '.df-lock{position:absolute;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;background:var(--dsw-alias-bg-overlay);background:color-mix(in srgb, var(--dsw-alias-bg-overlay) 82%, transparent);backdrop-filter:blur(6px);pointer-events:auto}',
      '.df-lock-card{width:380px;max-width:100%;max-height:100%;overflow:auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;padding:22px;border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.5;box-shadow:0 24px 60px color-mix(in srgb, var(--dsw-alias-bg-overlay) 78%, transparent)}',
      '.df-lock-title{font-size:17px;font-weight:600;margin:0}',
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
      '.df-pass{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;padding:6px 0}',
      '.df-pass .df-input{flex:1 1 150px;width:auto}',
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
      '@media (prefers-reduced-motion: reduce){.df-panel,.df-toast{animation:none}.df-ring-value,.df-switch,.df-switch::after,.df-pill,.df-btn{transition:none}}',
    ].join('')

    /* ── Runtime: i18n, shared store, sidebar lock, guards, components ─── */

    function createRuntime(ctx) {
      const locale = ctx && ctx.locale ? ctx.locale : null
      const audio = createAudio()
      let boundTranslate = null

      /** Translate through the Client locale service; dictionary fallback keeps
       * copy readable even before registration settles. */
      function t(key, params) {
        try {
          if (locale && typeof locale.bind === 'function') {
            if (!boundTranslate) boundTranslate = locale.bind(NS)
            return boundTranslate(key, params)
          }
        } catch (error) {
          /* fall through to the local dictionary */
        }
        const dict = I18N.en
        const template = dict[key] !== undefined ? dict[key] : key
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

      /* ── shared polling store (one loop for every component) ─────────── */

      const store = (function createStore() {
        let snapshot = {
          state: null,
          loaded: false,
          error: false,
          panelOpen: false,
          toasts: [],
          sessionId: null,
          stats: null,
          statsLoading: false,
          statsLoadedAt: 0,
          settingsMeta: null,
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

        function set(patch) {
          snapshot = Object.assign({}, snapshot, patch)
          emit()
        }

        function countdownVisible() {
          const state = snapshot.state
          return Boolean(state && state.focus && state.focus.phase && state.focus.phase !== 'idle')
        }

        function pollDelay() {
          return typeof document !== 'undefined' && document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS
        }

        function schedule(delay) {
          if (!active) return
          clearTimeout(pollTimer)
          pollTimer = setTimeout(runPoll, delay === undefined ? pollDelay() : delay)
        }

        function markOffline() {
          if (!snapshot.error) set({ error: true })
        }

        function applyState(next) {
          if (!next || typeof next !== 'object' || !next.focus) return
          const serverNow = toTimestamp(next.now)
          const clockOffset = serverNow === null ? 0 : Date.now() - serverNow
          ingestEvents(next.events, next)
          snapshot = Object.assign({}, snapshot, {
            state: next,
            loaded: true,
            error: false,
            clockOffset,
          })
          emit()
        }

        function reasonLabel(reason) {
          const key = 'lock.reason.' + String(reason || 'manual')
          const dict = I18N.en
          return dict[key] !== undefined ? t(key) : t('lock.reason.manual')
        }

        function eventToastText(kind, meta, alerts) {
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
              return t('toast.locked', { reason: reasonLabel(safeMeta.reason) })
            case EVENT.unlocked:
              return safeMeta.mode === 'rest'
                ? t('toast.unlockedRest')
                : t('toast.unlocked', {
                    minutes: numberOr(
                      safeMeta.minutes,
                      numberOr(alerts && alerts.unlockMinutes, 20),
                    ),
                  })
            case EVENT.limitWarning:
              return t('toast.limitWarning')
            default:
              return null
          }
        }

        function soundFor(kind, alerts, meta) {
          if (kind !== EVENT.focusCompleted && kind !== EVENT.taskCompleted && kind !== EVENT.breakCompleted) {
            return
          }
          if (alerts && alerts.sound === false) return
          if (isQuietHours(alerts)) return
          audio.chime(numberOr(alerts && alerts.volume, 0.6))
        }

        function pushToast(kind, text) {
          if (!text) return
          const id = ++toastSeq
          const toasts = snapshot.toasts.concat([{ id: id, kind: kind, text: text }]).slice(-3)
          snapshot = Object.assign({}, snapshot, { toasts: toasts })
          emit()
          const timer = setTimeout(function () {
            toastTimers.delete(timer)
            dismissToast(id)
          }, 6000)
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

        function handleEvent(event, alerts) {
          const kind = event && event.kind
          const meta = (event && event.meta) || {}
          const text = eventToastText(kind, meta, alerts)
          if (text) pushToast(kind, text)
          soundFor(kind, alerts, meta)
        }

        /** Show each ring-buffer event exactly once; the first fetch only sets a baseline. */
        function ingestEvents(events, nextState) {
          if (!Array.isArray(events) || events.length === 0) return
          let maxSeq = null
          for (let i = 0; i < events.length; i += 1) {
            const seq = Number(events[i] && events[i].seq)
            if (Number.isFinite(seq) && (maxSeq === null || seq > maxSeq)) maxSeq = seq
          }
          if (maxSeq === null) return
          if (lastSeq === null || maxSeq < lastSeq) {
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
          const alerts = (nextState && nextState.alerts) || (nextState && nextState.settings && nextState.settings.alerts) || null
          fresh.forEach(function (event) {
            handleEvent(event, alerts)
          })
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
          if (result.ok && result.data && result.data.focus) applyState(result.data)
          else markOffline()
          schedule()
        }

        function refreshSoon() {
          if (!active) return
          schedule(0)
        }

        function setSessionId(sessionId) {
          const next = sessionId === undefined ? null : sessionId
          if (snapshot.sessionId !== next) set({ sessionId: next })
        }

        function setPanelOpen(open) {
          if (snapshot.panelOpen !== Boolean(open)) set({ panelOpen: Boolean(open) })
        }

        function togglePanel() {
          setPanelOpen(!snapshot.panelOpen)
        }

        function start() {
          if (active) return function () {}
          active = true
          const onVisibility = function () {
            if (!active) return
            schedule(0)
          }
          try {
            document.addEventListener('visibilitychange', onVisibility)
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
            } catch (error) {
              /* ignored */
            }
          }
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

        function unlock(body) {
          return postAction(ROUTES.unlock, body || {})
        }

        function unlockRest() {
          return postAction(ROUTES.unlock, { rest: true })
        }

        async function loadStats(force) {
          if (snapshot.statsLoading) return
          if (!force && snapshot.stats) return
          set({ statsLoading: true })
          const result = await fetchJSON(ROUTES.stats + '?days=7')
          if (result.ok && result.data) set({ statsLoading: false, stats: result.data, statsLoadedAt: Date.now() })
          else set({ statsLoading: false })
        }

        async function loadSettingsMeta(force) {
          if (!force && snapshot.settingsMeta) return
          const result = await fetchJSON(ROUTES.settings)
          if (result.ok && result.data) {
            set({
              settingsMeta: {
                hasPassword: Boolean(result.data.hasPassword),
                settings: result.data.settings || null,
              },
            })
          }
        }

        async function saveSettings(payload) {
          const result = await fetchJSON(ROUTES.settings, { method: 'POST', body: payload })
          if (result.ok && result.data) {
            applyStateMetaFromSettingsResponse(result.data)
            refreshSoon()
          }
          return result
        }

        function applyStateMetaFromSettingsResponse(data) {
          if (!data) return
          const patch = {
            settingsMeta: {
              hasPassword: Boolean(data.hasPassword),
              settings: data.settings || (snapshot.settingsMeta && snapshot.settingsMeta.settings) || null,
            },
          }
          if (data.settings && snapshot.state) {
            patch.state = Object.assign({}, snapshot.state, { settings: data.settings })
          }
          set(patch)
        }

        return {
          get: get,
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
          unlockRest: unlockRest,
          loadStats: loadStats,
          loadSettingsMeta: loadSettingsMeta,
          saveSettings: saveSettings,
          pushToast: pushToast,
        }
      })()

      /* ── Best-effort sidebar lock: dim rows + block activations ──────── */

      const sidebarLock = (function createSidebarLock() {
        const records = new Map()
        let observer = null
        let applyTimer = 0
        let lastSignature = ''
        let lastBlockedAt = 0
        let running = false

        function info() {
          try {
            return computeSidebarLock(store.get().state)
          } catch (error) {
            return { active: false, owners: null, blocked: new Set() }
          }
        }

        function notifyBlocked() {
          const now = Date.now()
          if (now - lastBlockedAt < 1200) return
          lastBlockedAt = now
          store.pushToast('limit-warning', t('toast.sidebarBlocked'))
        }

        function restoreElement(element) {
          const original = records.get(element)
          records.delete(element)
          try {
            if (original === null || original === undefined) element.removeAttribute('style')
            else element.setAttribute('style', original)
          } catch (error) {
            /* ignored */
          }
        }

        function restoreAll() {
          Array.from(records.keys()).forEach(restoreElement)
          records.clear()
          lastSignature = ''
        }

        function dimElement(element) {
          if (!element || !element.style) return
          if (!records.has(element) || element.style.getPropertyValue('pointer-events') !== 'none') {
            if (records.has(element)) records.delete(element)
            const original = element.getAttribute('style')
            records.set(element, original)
            try {
              element.style.setProperty('opacity', SIDE_DIM_OPACITY)
              element.style.setProperty('pointer-events', 'none')
            } catch (error) {
              records.delete(element)
            }
          }
        }

        function apply() {
          if (!running) return
          const lock = info()
          if (!lock.active || !lock.blocked.size) {
            if (records.size) restoreAll()
            return
          }
          let rows = []
          try {
            rows = Array.prototype.slice.call(document.querySelectorAll('[data-row-key^="session:"]'))
          } catch (error) {
            rows = []
          }
          const wanted = []
          for (let i = 0; i < rows.length; i += 1) {
            const row = rows[i]
            if (!row || typeof row.getAttribute !== 'function') continue
            const key = row.getAttribute('data-row-key') || ''
            const id = key.slice(8)
            if (!id || lock.owners.has(id)) continue
            if (!lock.blocked.has(id)) continue
            wanted.push(row)
          }
          const signature = wanted
            .map(function (row) {
              return row.getAttribute('data-row-key')
            })
            .sort()
            .join('|')
          if (signature !== lastSignature) {
            restoreAll()
            lastSignature = signature
          }
          const wantedSet = new Set(wanted)
          wanted.forEach(dimElement)
          Array.from(records.keys()).forEach(function (element) {
            if (!wantedSet.has(element) || !element.isConnected) restoreElement(element)
          })
        }

        function scheduleApply() {
          if (!running || applyTimer) return
          applyTimer = setTimeout(function () {
            applyTimer = 0
            try {
              apply()
            } catch (error) {
              /* dimming is cosmetic; never break the app */
            }
          }, 120)
        }

        /** Our own pill/panel/lock/toasts/settings live outside the sidebar and
         * must never be swallowed by the sidebar click guard. */
        function isOwnUiTarget(target) {
          let element = target
          for (let depth = 0; element && depth < 20; depth += 1, element = element.parentElement) {
            if (element && typeof element.getAttribute === 'function' && element.getAttribute('data-dsh-deep-focus-root') !== null) {
              return true
            }
          }
          return false
        }

        function blockedIdFromTarget(target) {
          if (isOwnUiTarget(target)) return null
          const lock = info()
          if (!lock.active || !lock.blocked.size) return null
          let element = target
          for (let depth = 0; element && depth < MAX_ANCESTOR_DEPTH; depth += 1, element = element.parentElement) {
            if (!element || typeof element.getAttribute !== 'function') continue
            const rowKey = element.getAttribute('data-row-key')
            if (rowKey && rowKey.slice(0, 8) === 'session:') {
              const id = rowKey.slice(8)
              if (lock.owners.has(id)) return null
              if (lock.blocked.has(id)) return id
              return null
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
            if (blockedIdFromTarget(event.target)) {
              event.preventDefault()
              event.stopPropagation()
              notifyBlocked()
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
            if (blockedIdFromTarget(target)) {
              event.preventDefault()
              event.stopPropagation()
              notifyBlocked()
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
            if (typeof MutationObserver !== 'undefined' && document.body) {
              observer = new MutationObserver(scheduleApply)
              observer.observe(document.body, { childList: true, subtree: true })
            }
          } catch (error) {
            /* sidebar lock is best effort */
          }
          store.subscribe(scheduleApply)
          scheduleApply()
        }

        function stop() {
          running = false
          clearTimeout(applyTimer)
          applyTimer = 0
          if (observer) {
            try {
              observer.disconnect()
            } catch (error) {
              /* ignored */
            }
            observer = null
          }
          try {
            document.removeEventListener('click', onDocumentClick, true)
            document.removeEventListener('keydown', onDocumentKeyDown, true)
          } catch (error) {
            /* ignored */
          }
          restoreAll()
        }

        function isBlockedId(id) {
          try {
            const lock = info()
            return Boolean(lock.active && lock.blocked.has(String(id)))
          } catch (error) {
            return false
          }
        }

        return { start: start, stop: stop, isBlockedId: isBlockedId, notifyBlocked: notifyBlocked }
      })()

      /* ── Wrap uiWorkspace.openSession while the lock is active ────────── */

      const guardRestores = []

      function installOpenSessionGuard() {
        if (!ctx || typeof ctx.inject !== 'function') return function () {}
        let disposeChild = null
        try {
          disposeChild = ctx.inject(['uiWorkspace'], function (scope) {
            try {
              const workspace =
                (scope && typeof scope.get === 'function' ? scope.get('uiWorkspace') : undefined) ||
                (scope && scope.uiWorkspace)
              if (!workspace || typeof workspace.openSession !== 'function') return
              const original = workspace.openSession
              if (original.__dshDeepFocusWrapped) return
              const wrapper = function (target) {
                try {
                  if (typeof target === 'string' && sidebarLock.isBlockedId(target)) {
                    sidebarLock.notifyBlocked()
                    return undefined
                  }
                } catch (error) {
                  /* fall through to the real navigation */
                }
                return original.apply(this, arguments)
              }
              wrapper.__dshDeepFocusWrapped = true
              workspace.openSession = wrapper
              guardRestores.push(function () {
                try {
                  if (workspace.openSession === wrapper) workspace.openSession = original
                } catch (error) {
                  /* ignored */
                }
              })
            } catch (error) {
              /* optional service */
            }
          })
        } catch (error) {
          disposeChild = null
        }
        return function () {
          try {
            if (typeof disposeChild === 'function') disposeChild()
          } catch (error) {
            /* ignored */
          }
          while (guardRestores.length) {
            try {
              guardRestores.pop()()
            } catch (error) {
              /* ignored */
            }
          }
        }
      }

      function start() {
        const stopStore = store.start()
        sidebarLock.start()
        const stopGuard = installOpenSessionGuard()
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
          try {
            stopGuard()
          } catch (error) {
            /* ignored */
          }
          sidebarLock.stop()
          stopStore()
        }
      }

      /* ── Shared React hooks ──────────────────────────────────────────── */

      function useStore(clockToo) {
        const pair = React.useState(0)
        const force = pair[1]
        React.useEffect(function () {
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
        }, [clockToo])
        return store.get()
      }

      /* ── Small pieces ────────────────────────────────────────────────── */

      function Styles() {
        return h('style', { 'data-df-styles': '1' }, CSS_TEXT)
      }

      function IconPlay(props) {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('path', { d: 'M3 2.2v7.6c0 .5.55.8.97.53l5.9-3.8a.63.63 0 0 0 0-1.06l-5.9-3.8A.63.63 0 0 0 3 2.2Z', fill: 'currentColor' }),
        )
      }

      function IconPause(props) {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('rect', { x: 2.5, y: 2, width: 2.6, height: 8, rx: 1, fill: 'currentColor' }),
          h('rect', { x: 6.9, y: 2, width: 2.6, height: 8, rx: 1, fill: 'currentColor' }),
        )
      }

      function IconStop(props) {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('rect', { x: 3, y: 3, width: 6, height: 6, rx: 1.4, fill: 'currentColor' }),
        )
      }

      function IconCheck(props) {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('path', { d: 'M2.2 6.4 4.8 9 9.9 3.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        )
      }

      function IconLeaf(props) {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('path', { d: 'M10 2C5.5 2 2 4 2 7.2c0 1.4.8 2.4 2 2.8C5.4 7.2 7.2 6 10 5.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
        )
      }

      function IconClose(props) {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('path', { d: 'M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
        )
      }

      function IconLock(props) {
        return h(
          'svg',
          { className: 'df-icon', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true' },
          h('rect', { x: 2.6, y: 5.2, width: 6.8, height: 5, rx: 1.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
          h('path', { d: 'M4.1 5.2V4a1.9 1.9 0 0 1 3.8 0v1.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
        )
      }

      function errorTextFor(result, kind) {
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
        const message = result && result.data && result.data.error && result.data.error.message
        if (message) return String(message)
        return t(kind === 'settings' ? 'settings.error.saveFailed' : 'error.generic')
      }

      function settingsErrorText(result) {
        const code = result && result.data && result.data.error && result.data.error.code
        const map = {
          'invalid-settings': 'settings.error.invalid',
          'password-missing': 'settings.passwordRequired',
          'password-too-short': 'settings.error.tooShort',
          'password-mismatch': 'settings.error.mismatch',
          'missing-current-password': 'settings.error.missingCurrent',
          'bad-current-password': 'settings.error.badPassword',
          'bad-json': 'error.generic',
        }
        if (code && map[code]) return t(map[code])
        if (result && result.status === 0) return t('error.network')
        return t('settings.error.saveFailed')
      }

      function unlockErrorText(result) {
        const code = result && result.data && result.data.error && result.data.error.code
        if (code === 'bad-password') return t('lock.badPassword')
        if (code === 'no-password') return t('lock.noPassword')
        if (code === 'strict') return t('lock.strict')
        if (code === 'limit-reached') return t('lock.limitReached')
        if (code === 'missing-password') return t('lock.enterPassword')
        if (code === 'bad-json') return t('error.generic')
        if (result && result.status === 0) return t('lock.offline')
        return t('error.generic')
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
        const state = snapshot.state
        const focus = state && state.focus
        const phase = focus && focus.phase && focus.phase !== 'idle' ? focus.phase : 'idle'
        const status = focus && focus.status ? focus.status : 'idle'
        const running = phase !== 'idle' && status !== 'paused'
        const remaining = focusRemainingMs(state, snapshot.clockOffset)
        const outside = isOutsideFocusConversation(state, sessionId || snapshot.sessionId)
        const bindingLost = focusBindingLost(state)
        const hintText = bindingLost
          ? t('pill.bindingLost')
          : running && focus && focus.task
            ? String(focus.task)
            : null
        const ariaParts = [bindingLost ? t('pill.bindingLost') : outside ? t('pill.lockedAria') : t('pill.aria')]
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
              'data-locked': outside ? 'true' : undefined,
              'data-binding': bindingLost ? 'lost' : undefined,
              title: bindingLost
                ? t('pill.bindingLost')
                : outside
                  ? t('pill.lockedAria')
                  : snapshot.error
                    ? t('pill.offline')
                    : t('pill.open'),
              'aria-label': ariaParts.join(' · '),
              'aria-expanded': snapshot.panelOpen ? 'true' : 'false',
              onClick: function () {
                store.togglePanel()
              },
            },
            outside || bindingLost
              ? h(IconLock)
              : phase === 'break'
                ? h(IconLeaf)
                : running
                  ? h(IconPause)
                  : h(IconPlay),
            h(
              'span',
              { className: 'df-pill-time' },
              running || status === 'paused' ? fmtCountdown(remaining) : t('pill.idle'),
            ),
            hintText ? h('span', { className: 'df-pill-task' }, hintText) : null,
            snapshot.error ? h('span', { className: 'df-dot', 'aria-hidden': 'true' }) : null,
          ),
        )
      }

      /* ── Floating focus panel ────────────────────────────────────────── */

      function FocusPanel() {
        useLocaleTick()
        const snapshot = useStore(true)
        const state = snapshot.state
        const focus = state && state.focus
        const settings = (state && state.settings) || {}
        const focusCfg = settings.focus || {}
        const phase = focus && focus.phase && focus.phase !== 'idle' ? focus.phase : 'idle'
        const status = focus && focus.status ? focus.status : 'idle'
        const running = phase !== 'idle' && status !== 'paused'
        const paused = phase !== 'idle' && status === 'paused'
        const outside = isOutsideFocusConversation(state, snapshot.sessionId)
        const bindingLost = focusBindingLost(state)
        const escape = outside || bindingLost
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
        const open = snapshot.panelOpen

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

        if (!open) return null

        const phaseLabel = focusedPhaseLabel(t, phase, status)

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
            setError(errorTextFor(result, 'focus'))
            if (result.status === 409) store.refreshSoon()
          }
        }

        const ringRadius = 54
        const circumference = 2 * Math.PI * ringRadius

        // Action row is computed once; `escape` (outside owner or stale binding)
        // collapses it to the single "end focus" way out.
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
        const endFocusButton = h(
          'button',
          {
            key: 'end-focus',
            type: 'button',
            className: 'df-btn df-btn-primary',
            disabled: busy,
            onClick: function () {
              run(function () {
                return store.stopFocus()
              })
            },
          },
          h(IconLock),
          t('panel.endFocus'),
        )

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
              { className: 'df-ring', 'data-phase': phase, 'data-status': paused ? 'paused' : running ? 'running' : 'idle' },
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
                h('span', { className: 'df-ring-phase' }, phaseLabel),
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
            bindingLost
              ? h('p', { className: 'df-muted', role: 'status' }, t('panel.bindingLost'))
              : outside
                ? h('p', { className: 'df-muted', role: 'status' }, t('panel.outsideSession'))
                : null,
            error ? h('p', { className: 'df-error', role: 'alert' }, error) : null,
            h('div', { className: 'df-actions' }, escape ? endFocusButton : actionNodes),
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

      function focusedPhaseLabel(t, phase, status) {
        if (phase === 'work') return status === 'paused' ? t('phase.paused') : t('phase.work')
        if (phase === 'break') return t('phase.break')
        return t('phase.idle')
      }

      /* ── Lock overlay ────────────────────────────────────────────────── */

      function LockOverlay() {
        useLocaleTick()
        const snapshot = useStore(false)
        const state = snapshot.state
        const lock = state && state.lock
        const loaded = snapshot.loaded && state
        const locked = Boolean(loaded && lock && lock.locked)
        const cardRef = React.useRef(null)
        const passwordState = React.useState('')
        const password = passwordState[0]
        const setPassword = passwordState[1]
        const busyState = React.useState(false)
        const busy = busyState[0]
        const setBusy = busyState[1]
        const errorState = React.useState(null)
        const error = errorState[0]
        const setError = errorState[1]
        const hintState = React.useState(false)
        const hint = hintState[0]
        const setHint = hintState[1]

        React.useEffect(
          function () {
            if (!locked) return undefined
            // The lock can appear before the settings page was ever opened; read
            // whether a password exists so the form is never a dead end.
            store.loadSettingsMeta()
            return undefined
          },
          [locked],
        )

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
                setHint(true)
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
        const focus = state.focus || {}
        const unlockMinutes = clampNumber(limits.unlockMinutes, 1, 120, 20)
        const hasPassword =
          snapshot.settingsMeta && typeof snapshot.settingsMeta.hasPassword === 'boolean'
            ? snapshot.settingsMeta.hasPassword
            : true
        const strict = Boolean(lock.strict || limits.strictNoUnlock)
        const canUnlock = lock.canUnlock !== false
        const reason = String(lock.reason || 'manual')
        const reasonKey = 'lock.reason.' + reason
        const reasonText = I18N.en[reasonKey] !== undefined ? t(reasonKey) : t('lock.reason.manual')

        async function submitUnlock(event) {
          if (event && typeof event.preventDefault === 'function') event.preventDefault()
          if (busy) return
          setBusy(true)
          setError(null)
          const result = await store.unlock({ password: password })
          setBusy(false)
          if (result.ok) {
            setPassword('')
            setHint(false)
          } else {
            setError(unlockErrorText(result))
          }
        }

        async function takeRest() {
          if (busy) return
          setBusy(true)
          setError(null)
          const result = await store.unlockRest()
          setBusy(false)
          if (!result.ok) setError(unlockErrorText(result))
        }

        const dailyLimit = numberOr(limits.dailyActiveMinutes, 0)
        const continuousLimit = numberOr(limits.continuousWorkMinutes, 0)

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
            h('hr', { className: 'df-divider' }),
            h('div', { className: 'df-muted' }, t('lock.usageTitle')),
            h(
              'div',
              { className: 'df-kv' },
              h('span', null, t('lock.active')),
              h(
                'span',
                null,
                h('b', null, fmtDuration(t, numberOr(usage.activeTodayMs, 0))),
                dailyLimit > 0 ? ' / ' + fmtDuration(t, dailyLimit * 60000) : ' / ' + t('settings.hintZeroUnlimited'),
              ),
            ),
            h(
              'div',
              { className: 'df-kv' },
              h('span', null, t('lock.continuous')),
              h(
                'span',
                null,
                h('b', null, fmtDuration(t, numberOr(usage.continuousMs, 0))),
                continuousLimit > 0
                  ? ' / ' + fmtDuration(t, continuousLimit * 60000)
                  : ' / ' + t('settings.hintZeroUnlimited'),
              ),
            ),
            numberOr(lock.unlockCountToday, 0) > 0
              ? h('div', { className: 'df-kv' }, h('span'), h('span', null, t('lock.unlockCount', { n: numberOr(lock.unlockCountToday, 0) })))
              : null,
            h('hr', { className: 'df-divider' }),
            strict
              ? h('p', { className: 'df-muted', role: 'status' }, t('lock.strict'))
              : canUnlock && hasPassword
                ? h(
                    'form',
                    { className: 'df-pass', onSubmit: submitUnlock },
                    h('input', {
                      className: 'df-input',
                      type: 'password',
                      value: password,
                      placeholder: t('lock.passwordPlaceholder'),
                      'aria-label': t('lock.password'),
                      autoComplete: 'current-password',
                      'data-df-autofocus': '',
                      disabled: busy,
                      onChange: function (event) {
                        setPassword(event.target.value)
                      },
                    }),
                    h(
                      'button',
                      {
                        type: 'submit',
                        className: 'df-btn df-btn-primary',
                        disabled: busy || password.length === 0,
                      },
                      t('lock.unlockFor', { n: unlockMinutes }),
                    ),
                  )
                : canUnlock && !hasPassword
                  ? h('p', { className: 'df-muted', role: 'status' }, t('lock.noPassword'))
                  : h('p', { className: 'df-muted', role: 'status' }, t('lock.limitReached')),
            error ? h('p', { className: 'df-error', role: 'alert' }, error) : null,
            snapshot.error ? h('p', { className: 'df-error', role: 'status' }, t('lock.offline')) : null,
            hint ? h('p', { className: 'df-muted', role: 'status' }, t('lock.escHint')) : null,
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
                  'data-df-autofocus': strict ? '' : undefined,
                },
                h(IconLeaf),
                t('lock.rest'),
              ),
            ),
          ),
          ),
        )
      }

      /* ── Toasts ──────────────────────────────────────────────────────── */

      function Toasts() {
        const snapshot = useStore(false)
        if (!snapshot.toasts.length) return null
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
        return h(
          'section',
          { className: 'df-group' },
          h('h3', { className: 'df-group-title' }, props.title),
          props.children,
        )
      }

      function StatsChart(props) {
        const t = props.t
        const days = props.days
        if (!days || days.length === 0) return h('p', { className: 'df-muted' }, t('settings.stats.empty'))
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
          const label = t('wd.' + weekdayIndex(day.day))
          const detail = t('settings.stats.aria') + ': ' + label
          elements.push(
            h(
              'g',
              { key: 'day-' + index },
              h('title', null, detail),
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
            { viewBox: '0 0 ' + width + ' ' + (height + top + 4), role: 'img', 'aria-label': t('settings.stats.aria') },
            h('line', { className: 'df-chart-axis', x1: 0, y1: top + height, x2: width, y2: top + height }),
            elements,
          ),
          h(
            'div',
            { className: 'df-chart-labels' },
            days.slice(0, 7).map(function (day, index) {
              return h('span', { key: 'label-' + index }, t('wd.' + weekdayIndex(day && day.day)))
            }),
          ),
          h(
            'div',
            { className: 'df-chart-legend' },
            h(
              'span',
              null,
              h('span', {
                className: 'df-legend-dot',
                style: { background: 'var(--dsw-alias-border-l1)' },
              }),
              t('settings.stats.legendActive'),
            ),
            h(
              'span',
              null,
              h('span', {
                className: 'df-legend-dot',
                style: { background: 'var(--dsw-alias-brand-primary)' },
              }),
              t('settings.stats.legendFocus'),
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
            store.loadSettingsMeta()
            store.loadStats(true)
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
                h('p', { className: 'df-settings-desc' }, snapshot.error ? t('settings.offline') : t('settings.desc')),
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
          const result = await store.saveSettings({ settings: draft })
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
        const lockCfg = draft.lock || {}
        const alerts = draft.alerts || {}
        const usage = draft.usage || {}
        const sampling = state && state.usage ? state.usage.sampling : null

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
                max: 600,
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
            h(
              FieldRow,
              { label: t('field.dailyUnlockLimit'), hint: t('field.dailyUnlockLimit.hint') },
              h(NumberInput, {
                value: limits.dailyUnlockLimit,
                min: 0,
                max: 20,
                label: t('field.dailyUnlockLimit'),
                disabled: disabled,
                onChange: function (value) {
                  patch('limits.dailyUnlockLimit', value)
                },
              }),
            ),
            h(
              FieldRow,
              { label: t('field.strictNoUnlock'), hint: t('field.strictNoUnlock.hint') },
              h(Switch, {
                checked: Boolean(limits.strictNoUnlock),
                label: t('field.strictNoUnlock'),
                disabled: disabled,
                onChange: function (value) {
                  patch('limits.strictNoUnlock', value)
                },
              }),
            ),
          ),
          h(
            Section,
            { title: t('settings.group.lock') },
            h(
              FieldRow,
              { label: t('field.singleConversation') },
              h(Switch, {
                checked: Boolean(lockCfg.singleConversation),
                label: t('field.singleConversation'),
                disabled: disabled,
                onChange: function (value) {
                  patch('lock.singleConversation', value)
                },
              }),
            ),
            h(
              FieldRow,
              { label: t('field.blockToolsOutsideFocus') },
              h(Switch, {
                checked: Boolean(lockCfg.blockToolsOutsideFocus),
                label: t('field.blockToolsOutsideFocus'),
                disabled: disabled,
                onChange: function (value) {
                  patch('lock.blockToolsOutsideFocus', value)
                },
              }),
            ),
            h(
              FieldRow,
              { label: t('field.lockSidebarOutsideFocus') },
              h(Switch, {
                checked: lockCfg.lockSidebarOutsideFocus !== false,
                label: t('field.lockSidebarOutsideFocus'),
                disabled: disabled,
                onChange: function (value) {
                  patch('lock.lockSidebarOutsideFocus', value)
                },
              }),
            ),
            h(
              FieldRow,
              { label: t('field.exemptSubagents') },
              h(Switch, {
                checked: Boolean(lockCfg.exemptSubagents),
                label: t('field.exemptSubagents'),
                disabled: disabled,
                onChange: function (value) {
                  patch('lock.exemptSubagents', value)
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
              h(
                'span',
                { className: 'df-field-hint' },
                t('settings.volumeValue', { n: Math.round(numberOr(alerts.volume, 0.6) * 100) }),
              ),
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
              h(
                'span',
                { className: 'df-field-hint' },
                t('field.quietHoursEnd'),
              ),
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
                max: 600,
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
              { label: t('field.detectMedia') },
              h(Switch, {
                checked: Boolean(usage.detectMedia),
                label: t('field.detectMedia'),
                disabled: disabled,
                onChange: function (value) {
                  patch('usage.detectMedia', value)
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
            h('p', { className: 'df-field-hint' }, t('settings.note.sampling')),
            h('p', { className: 'df-field-hint' }, t('settings.note.privacy')),
          ),
          h(
            Section,
            { title: t('settings.group.security') },
            h(PasswordEditor, {
              t: t,
              ready: snapshot.settingsMeta !== null,
              hasPassword: Boolean(snapshot.settingsMeta && snapshot.settingsMeta.hasPassword),
              disabled: disabled,
            }),
          ),
          h(
            Section,
            { title: t('settings.group.stats') },
            snapshot.stats
              ? h(StatsChart, { t: t, days: (snapshot.stats.days || []).slice(-7) })
              : h('p', { className: 'df-muted' }, snapshot.statsLoading ? t('settings.stats.loading') : t('settings.stats.empty')),
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
                      h('span', null, t('settings.today.unlocks')),
                      h('b', null, String(numberOr(snapshot.stats.today.unlocks, 0))),
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
              {
                type: 'button',
                className: 'df-btn df-btn-primary',
                disabled: !dirty || saving,
                onClick: save,
              },
              t('settings.save'),
            ),
            dirty
              ? h(
                  'button',
                  { type: 'button', className: 'df-btn', disabled: saving, onClick: discard },
                  t('settings.reset'),
                )
              : null,
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

      /* Settings sub-component: unlock password set / change / clear. */
      function PasswordEditor(props) {
        const t = props.t
        const hasPassword = props.hasPassword
        const [current, setCurrent] = React.useState('')
        const [next, setNext] = React.useState('')
        const [confirm, setConfirm] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [error, setError] = React.useState(null)
        const [notice, setNotice] = React.useState(null)

        if (!props.ready) {
          return h('p', { className: 'df-muted', role: 'status' }, t('settings.loadingPassword'))
        }

        function resetFields() {
          setCurrent('')
          setNext('')
          setConfirm('')
        }

        function localError() {
          if (!hasPassword && next.length < 6) return t('settings.passwordRequired')
          if (hasPassword && current.length === 0) return t('settings.error.missingCurrent')
          if (next.length < 6) return t('settings.passwordRequired')
          if (next !== confirm) return t('settings.passwordMismatch')
          return null
        }

        async function submit() {
          if (busy) return
          const local = localError()
          if (local) {
            setError(local)
            setNotice(null)
            return
          }
          setBusy(true)
          setError(null)
          setNotice(null)
          const payload = { password: next }
          if (hasPassword) payload.currentPassword = current
          const result = await store.saveSettings(payload)
          setBusy(false)
          if (result.ok) {
            resetFields()
            setNotice(hasPassword ? t('settings.passwordSaved') : t('settings.passwordSet'))
          } else {
            setError(settingsErrorText(result))
          }
        }

        async function clear() {
          if (busy) return
          if (hasPassword && current.length === 0) {
            setError(t('settings.error.missingCurrent'))
            return
          }
          setBusy(true)
          setError(null)
          setNotice(null)
          const payload = { clearPassword: true }
          if (hasPassword) payload.currentPassword = current
          const result = await store.saveSettings(payload)
          setBusy(false)
          if (result.ok) {
            resetFields()
            setNotice(t('settings.passwordCleared'))
          } else {
            setError(settingsErrorText(result))
          }
        }

        const disabled = Boolean(props.disabled) || busy

        return h(
          'div',
          null,
          hasPassword
            ? h('div', { className: 'df-pass' },
                h('input', {
                  className: 'df-input',
                  type: 'password',
                  value: current,
                  placeholder: t('field.currentPassword'),
                  'aria-label': t('field.currentPassword'),
                  autoComplete: 'current-password',
                  disabled: disabled,
                  onChange: function (event) {
                    setCurrent(event.target.value)
                  },
                }),
              )
            : null,
          h(
            'div',
            { className: 'df-pass' },
            h('input', {
              className: 'df-input',
              type: 'password',
              value: next,
              placeholder: t('field.newPassword'),
              'aria-label': t('field.newPassword'),
              autoComplete: 'new-password',
              disabled: disabled,
              onChange: function (event) {
                setNext(event.target.value)
              },
            }),
            h('input', {
              className: 'df-input',
              type: 'password',
              value: confirm,
              placeholder: t('field.confirmPassword'),
              'aria-label': t('field.confirmPassword'),
              autoComplete: 'new-password',
              disabled: disabled,
              onChange: function (event) {
                setConfirm(event.target.value)
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'df-btn df-btn-primary',
                disabled: disabled,
                onClick: submit,
              },
              hasPassword ? t('settings.changePassword') : t('settings.setPassword'),
            ),
            hasPassword
              ? h(
                  'button',
                  { type: 'button', className: 'df-btn', disabled: disabled, onClick: clear },
                  t('settings.clearPassword'),
                )
              : null,
          ),
          h('p', { className: 'df-field-hint' }, t('field.newPassword.hint')),
          error ? h('p', { className: 'df-error', role: 'alert' }, error) : null,
          notice ? h('p', { className: 'df-save-state', 'data-kind': 'saved', role: 'status' }, notice) : null,
        )
      }

      return {
        t: t,
        store: store,
        start: start,
        components: {
          FocusPill: FocusPill,
          FocusPanel: FocusPanel,
          LockOverlay: LockOverlay,
          Toasts: Toasts,
          SettingsSection: SettingsSection,
        },
      }
    }

    const runtime = {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const client = createRuntime(ctx)
        const registrations = [
          [
            'conversation.input.right',
            { name: 'conversation.input.right', id: 'dsh-deep-focus-pill', order: 30 },
            client.components.FocusPill,
          ],
          [
            'shell.overlay',
            { name: 'shell.overlay', id: 'dsh-deep-focus-panel', order: 20 },
            client.components.FocusPanel,
          ],
          [
            'shell.overlay',
            { name: 'shell.overlay', id: 'dsh-deep-focus-toasts', order: 90 },
            client.components.Toasts,
          ],
          [
            'shell.overlay',
            { name: 'shell.overlay', id: 'dsh-deep-focus-lock', order: 100 },
            client.components.LockOverlay,
          ],
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
        ]

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
          }, 'dsh-deep-focus: polling, sound and sidebar lock')
        } catch (error) {
          /* store is defensive; keep the slots registered regardless */
        }

        registrations.forEach(function (entry) {
          try {
            ctx.effect(function () {
              const dispose = ctx.slots.inject(entry[0], function () {
                return ctx.slots.register(entry[1], entry[2])
              })
              return typeof dispose === 'function' ? dispose : undefined
            }, 'dsh-deep-focus: ' + entry[1].id)
          } catch (error) {
            /* never let one slot registration break the plugin row */
          }
        })
      },
    }

    return runtime
  },
})
