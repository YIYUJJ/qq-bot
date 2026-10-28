/** panel-state.mjs 回归测试：依赖校验 + 关键字段拼装。 运行：node lib/test-panel-state.mjs */
import { PANEL_STATE_DEPS, createPanelState } from './panel-state.mjs'

let pass = 0
const fails = []
const ok = (c, n) => {
  if (c) {
    pass += 1
    console.log('  PASS  ' + n)
  } else {
    fails.push(n)
    console.log('  FAIL  ' + n)
  }
}

// 缺依赖
let threw = ''
try {
  createPanelState({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(PANEL_STATE_DEPS.includes('rooms') && PANEL_STATE_DEPS.includes('stats'), '依赖清单关键项')

const deps = {
  CONFIG_FILE: 'C:/x/config.json',
  LOG_FILE: 'C:/x/bot.log',
  MEMORY_DIR: 'C:/x/memory',
  STICKERS_FILE: 'C:/x/stickers.json',
  config: { enabled: true, allowGroups: ['900001'] },
  facts: { 900001: [{ text: 'a', at: Date.now() }] },
  features: [{ id: 'games', enabled: true }],
  groupNames: new Map([['900001', '测试群']]),
  healthCache: { items: [], bad: [], warn: [] },
  log: () => {},
  roomSnapshot: (r) => ({ roomId: r.roomId, msgs: r.msgs.length }),
  rooms: new Map([['900001', { roomId: '900001', roomName: '测试群', msgs: [{ id: '1', text: 'hi' }], replyTimes: [], nameCache: new Map() }]]),
  stats: { msgsIn: 1, replies: 0 },
  stickers: { a: { url: 'http://x/a.png', subType: 1 } },
  usage: { total: 10, calls: 1, byDay: {} },
  usageView: () => ({ total: 10, calls: 1, days: [] }),
  version: 'test',
  DEFAULT_CONFIG: { enabled: false },
  publicMeta: () => ({ x: { label: 'x' } }),
  GROUPS: [{ id: 'reply', title: '回复' }],
  FEATURES: [{ id: 'games' }],
  ob: { status: { connected: true } },
}

const panelState = createPanelState(deps)
const s = panelState()
ok(s && typeof s === 'object', '返回对象')
ok(s.ok === true, 'ok=true')
ok(s.version !== undefined, '带 version')
ok(s.config && s.config.enabled === true, 'config 透传')
ok(Array.isArray(s.rooms), 'rooms 是数组')
ok(s.rooms.length === 1 && s.rooms[0].roomId === '900001', 'rooms 内容正确')
ok(s.stickers && typeof s.stickers.count === 'number', 'stickers 计数')
ok(s.usage && s.usage.total === 10, 'usage 透传')
ok(s.names && s.names.groups === 1, 'names.groups 计数')
ok(s.paths && typeof s.paths === 'object', 'paths 存在')
ok(Array.isArray(s.groups) && s.groups.length > 0, 'groups 非空')
ok(s.meta && Object.keys(s.meta).length > 0, 'meta 非空')

console.log('')
if (fails.length) {
  console.log(`❌ test-panel-state.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-panel-state.mjs 通过 ${pass} 项，失败 0 项`)
