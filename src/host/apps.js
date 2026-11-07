/**
 * Per-application usage helpers: friendly names for foreground executables and the
 * aggregation rows the API returns. Keys are stable lowercase executable names.
 */

/** Friendly display names, keyed by lowercase executable / app name. */
const APP_NAMES = new Map(Object.entries({
  chrome: '浏览器',
  'google chrome': '浏览器',
  msedge: '浏览器',
  'microsoft edge': '浏览器',
  firefox: '浏览器',
  safari: '浏览器',
  qq: 'QQ',
  wechat: '微信',
  wechatappex: '微信',
  weixin: '微信',
  code: 'VS Code',
  cursor: 'Cursor',
  'deepseek harness': 'DeepSeek Harness',
  windowsterminal: '终端',
  pwsh: '终端',
  powershell: '终端',
  explorer: '资源管理器',
  notion: 'Notion',
  feishu: '飞书',
  lark: '飞书',
  dingtalk: '钉钉',
  spotify: 'Spotify',
  bilibili: '哔哩哔哩',
  vlc: 'VLC',
  qqmusic: 'QQ音乐',
  cloudmusic: '网易云音乐',
  neteasecloudmusic: '网易云音乐',
  'netease cloud music': '网易云音乐',
  wps: 'WPS',
}))

/** Trim a raw executable/app name; drop a trailing `.exe` so `chrome.exe` and `chrome` agree. */
export function normalizedExeName(raw) {
  if (typeof raw !== 'string') return ''
  let name = raw.trim()
  if (name.length === 0) return ''
  if (name.toLowerCase().endsWith('.exe')) name = name.slice(0, -4)
  return name
}

/** Stable lowercase key used in storage and `/apps` (`''` when there is no name). */
export function normalizeAppKey(raw) {
  const name = normalizedExeName(raw)
  return name.length === 0 ? '' : name.toLowerCase()
}

/** Friendly name for a raw executable/app name; unknown names keep their own spelling. */
export function friendlyAppName(raw) {
  const name = normalizedExeName(raw)
  if (name.length === 0) return ''
  // v0.4.26: records written before the base64 fix may contain U+FFFD replacement
  // characters (UTF-8 decoding of a GBK byte stream). Those are unrecoverable, so
  // never render the garbage: keep the readable ASCII prefix, else a generic label.
  if (/[\u0000-\u001F\uFFFD]/.test(name)) {
    const prefix = name.split(/[\u0000-\u001F\uFFFD]/)[0].replace(/[_\-\s.]+$/, '')
    return prefix.length >= 3 ? prefix + '…' : '未知应用'
  }
  return APP_NAMES.get(name.toLowerCase()) ?? name
}

/** Rows for `/apps` are derived via `appsToRows`; foreground-DSH detection uses the raw name. */
const DSH_APP_NAMES = new Set(['deepseek harness', 'dsh'])

/**
 * Whether a sampler foreground name is the DeepSeek Harness process itself.
 * Strict on purpose: only the exact app name (any separator) or the `dsh` CLI /
 * a name led by the `dsh` token counts; other apps must never match.
 */
export function isDshForegroundName(raw) {
  const key = normalizeAppKey(raw)
  if (key.length === 0) return false
  const canonical = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (DSH_APP_NAMES.has(canonical)) return true
  return canonical.startsWith('dsh ')
}

/** Add one app's milliseconds into a `Map<id, ms>` accumulator. */
export function addAppMs(target, rawName, ms) {
  if (!(target instanceof Map)) return target
  const id = normalizeAppKey(rawName)
  if (id.length === 0 || !Number.isFinite(ms) || ms <= 0) return target
  target.set(id, (target.get(id) ?? 0) + ms)
  return target
}

/** Merge an app-ms map (or plain object from a stored line) into `target`. */
export function mergeAppMs(target, source) {
  if (!(target instanceof Map) || source === null || typeof source !== 'object') return target
  const entries = source instanceof Map ? source.entries() : Object.entries(source)
  for (const [id, ms] of entries) {
    if (typeof id !== 'string' || id.length === 0) continue
    if (!Number.isFinite(ms) || ms <= 0) continue
    target.set(id, (target.get(id) ?? 0) + ms)
  }
  return target
}

/** Sum of all tracked app milliseconds. */
export function appsTotal(apps) {
  if (!(apps instanceof Map)) return 0
  let total = 0
  for (const ms of apps.values()) if (Number.isFinite(ms) && ms > 0) total += ms
  return total
}

/**
 * Sorted API rows `[{id, name, ms}]`, largest first, optionally capped.
 * Friendly names are resolved here so a mapping update also fixes older data.
 */
export function appsToRows(apps, { limit = 0 } = {}) {
  if (!(apps instanceof Map)) return []
  const rows = []
  for (const [id, ms] of apps.entries()) {
    if (!Number.isFinite(ms) || ms <= 0) continue
    rows.push({ id, name: friendlyAppName(id), ms: Math.round(ms) })
  }
  rows.sort((left, right) => right.ms - left.ms || left.id.localeCompare(right.id))
  return limit > 0 ? rows.slice(0, limit) : rows
}

/** Rounded `{id: ms}` object ready to store in a usage line (drops non-positive values). */
export function appsToRecord(apps) {
  const record = {}
  if (!(apps instanceof Map)) return record
  for (const [id, ms] of apps.entries()) {
    const rounded = Math.round(ms)
    if (Number.isFinite(rounded) && rounded > 0) record[id] = rounded
  }
  return record
}
