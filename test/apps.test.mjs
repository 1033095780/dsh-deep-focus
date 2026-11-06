import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addAppMs,
  appsToRecord,
  appsToRows,
  appsTotal,
  friendlyAppName,
  mergeAppMs,
  normalizeAppKey,
  normalizedExeName,
} from '../src/host/apps.js'

test('executable names normalize to stable keys', () => {
  assert.equal(normalizedExeName('chrome.exe'), 'chrome')
  assert.equal(normalizedExeName('  WeChatAppEx '), 'WeChatAppEx')
  assert.equal(normalizedExeName('DeepSeek Harness'), 'DeepSeek Harness')
  assert.equal(normalizedExeName(''), '')
  assert.equal(normalizedExeName(42), '')
  assert.equal(normalizeAppKey('Chrome.EXE'), 'chrome')
  assert.equal(normalizeAppKey('msedge'), 'msedge')
  assert.equal(normalizeAppKey(''), '')
})

test('friendly names follow the v2 mapping', () => {
  const cases = {
    chrome: '浏览器',
    'google chrome': '浏览器',
    msedge: '浏览器',
    firefox: '浏览器',
    qq: 'QQ',
    wechat: '微信',
    WeChatAppEx: '微信',
    Code: 'VS Code',
    Cursor: 'Cursor',
    'DeepSeek Harness': 'DeepSeek Harness',
    WindowsTerminal: '终端',
    pwsh: '终端',
    powershell: '终端',
    explorer: '资源管理器',
    notion: 'Notion',
    feishu: '飞书',
    dingtalk: '钉钉',
    spotify: 'Spotify',
    bilibili: '哔哩哔哩',
    vlc: 'VLC',
    qqmusic: 'QQ音乐',
    QQMusic: 'QQ音乐',
    cloudmusic: '网易云音乐',
    'NetEase Cloud Music': '网易云音乐',
    wps: 'WPS',
  }
  for (const [raw, expected] of Object.entries(cases)) {
    assert.equal(friendlyAppName(raw), expected, raw)
  }
  assert.equal(friendlyAppName('sublime_text'), 'sublime_text')
  assert.equal(friendlyAppName('SomeApp.exe'), 'SomeApp')
  assert.equal(friendlyAppName(''), '')
  // Legacy mojibake records must never be rendered as replacement characters.
  assert.equal(friendlyAppName('xtitclient_x64_\uFFFD\uFFFD\uFFFD\uFFFDqmt'), 'xtitclient_x64…')
  assert.equal(friendlyAppName('\uFFFD\uFFFD'), '未知应用')
  assert.equal(friendlyAppName('a\uFFFD'), '未知应用')
})

test('app milliseconds accumulate into a map', () => {
  const apps = new Map()
  addAppMs(apps, 'chrome', 5000)
  addAppMs(apps, 'chrome.exe', 3000)
  addAppMs(apps, 'Code', 2000)
  addAppMs(apps, '', 9999)
  addAppMs(apps, 'vlc', -5)
  assert.equal(apps.get('chrome'), 8000)
  assert.equal(apps.get('code'), 2000)
  assert.equal(apps.size, 2)
  assert.equal(appsTotal(apps), 10_000)
  assert.equal(appsTotal(new Map()), 0)
})

test('mergeAppMs accepts a stored object and a map', () => {
  const apps = new Map()
  mergeAppMs(apps, { chrome: 3000, code: 1000, bad: 0, worse: 'x' })
  mergeAppMs(apps, new Map([['chrome', 2000], ['vlc', 500]]))
  assert.equal(apps.get('chrome'), 5000)
  assert.equal(apps.get('code'), 1000)
  assert.equal(apps.get('vlc'), 500)
  assert.equal(apps.has('bad'), false)
  assert.equal(apps.has('worse'), false)
})

test('rows are sorted, named, rounded and capped', () => {
  const apps = new Map([['code', 2500.4], ['chrome', 7000], ['zeta', 2500], ['zero', 0]])
  const rows = appsToRows(apps)
  assert.deepEqual(rows.map((row) => row.id), ['chrome', 'code', 'zeta'])
  assert.equal(rows[0].name, '浏览器')
  assert.equal(rows[1].name, 'VS Code')
  assert.equal(rows[1].ms, 2500)
  assert.equal(rows[2].name, 'zeta')
  assert.equal(appsToRows(apps, { limit: 2 }).length, 2)
  assert.deepEqual(appsToRows(new Map()), [])
})

test('record form keeps positive rounded values', () => {
  const record = appsToRecord(new Map([['chrome', 3000.6], ['zero', 0], ['negative', -1]]))
  assert.deepEqual(record, { chrome: 3001 })
})
