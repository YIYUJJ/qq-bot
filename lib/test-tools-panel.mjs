/** tools-panel.mjs 回归测试：面板字段自检 + 底层自测的容错。 运行：node lib/test-tools-panel.mjs */
import { panelTools } from './tools-panel.mjs'

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

const fullState = () => ({
  ok: true,
  at: Date.now(),
  version: 't',
  config: {},
  defaults: {},
  meta: { a: 1, b: 2 },
  groups: [{ id: 'reply' }],
  features: [{ id: 'x' }, { id: 'y' }],
  stats: {},
  connection: {},
  health: { bad: [], warn: [] },
  usage: { total: 100, calls: 2 },
  rooms: [{}, {}],
  stickers: { count: 5 },
  names: { groups: 3 },
  paths: {},
})

const mk = (over = {}) =>
  panelTools({
    panelState: fullState,
    pickCanned: () => '在呢',
    normText: (s) => String(s).replace(/[\s，。！？]/g, ''),
    detectTrigger: () => 'at',
    config: { aliases: ['鲸鱼'], allowGroups: ['900001'], pokeOnMe: true, pokeBack: true, pokeChance: 0.9, pokeOnReply: 0.1, memoryRooms: [] },
    decide: () => ({ reason: '通过' }),
    selfcheck: async () => ({ items: [{}, {}], bad: [], warn: [] }),
    usageView: () => ({ total: 100, calls: 2 }),
    isManagedRoom: () => false,
    memDirOf: () => '',
    addFact: () => true,
    factsOf: () => [{}],
    facts: {},
    rmSync: () => {},
    searchHistory: async () => [{}, {}],
    extractSearchQuery: () => '查询',
    sensitiveQuery: () => '',
    resolveVisionRoute: async () => ({ provider: 'p', model: 'm' }),
    ob: { groupMembers: async () => [{ card: 'a' }, {}] },
    stickers: { k1: { url: 'http://x/1.png' } },
    tailLines: () => 'a\nb\nc',
    logFile: 'bot.log',
    configKeys: ['aliases', 'allowGroups'],
    applyConfigPatch: (patch) => ({ ok: true, applied: patch, rejected: {} }),
    textOut: (t) => t,
    ...over,
  })

const [panel, ops] = mk()

// 面板：字段齐全
const p1 = await panel.execute({})
ok(p1.includes('✅ 字段齐全'), '字段齐全判定')
ok(p1.includes('meta 2 项 / groups 1 组 / features 2 个开关'), '计数渲染')
ok(p1.includes('rooms 2 个'), 'rooms 计数')

// 面板：缺字段
const [panelMissing] = mk({ panelState: () => ({ ok: true, meta: {}, groups: [], features: [], rooms: [], stickers: { count: 0 }, names: { groups: 0 }, usage: { total: 0, calls: 0 }, health: null }) })
const p2 = await panelMissing.execute({})
ok(p2.includes('❌ 缺字段'), '缺字段判定')

// 底层自测：全部通过
const o1 = await ops.execute({})
ok(o1.startsWith('== 面板/功能底层自测 =='), '有标题')
ok(o1.includes('✅ 敷衍短句'), '同步项通过')
ok(o1.includes('✅ 自检'), '异步项通过')
ok(o1.includes('✅ 长期记忆'), '记忆自测执行')
ok(o1.includes('✅ 视觉路由'), '视觉路由')
ok(o1.includes('✅ 配置导入'), '配置导入')

// 底层自测：部分依赖抛错时不整体失败
const [, opsBroken] = mk({
  pickCanned: () => {
    throw new Error('boom')
  },
  selfcheck: async () => {
    throw new Error('check-fail')
  },
})
const o2 = await opsBroken.execute({})
ok(o2.includes('❌ 敷衍短句：boom'), '同步异常被捕获并标注')
ok(o2.includes('❌ 自检：check-fail'), '异步异常被捕获并标注')
ok(o2.includes('✅ 文本归一'), '其它项继续执行')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-panel.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-panel.mjs 通过 ${pass} 项，失败 0 项`)
