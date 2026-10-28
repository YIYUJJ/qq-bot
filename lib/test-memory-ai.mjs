/** memory-ai.mjs 回归测试：提炼、检索、关系分析的依赖与分支。 运行：node lib/test-memory-ai.mjs */
import { CREATEMEMORYAI_DEPS, createMemoryAi } from './memory-ai.mjs'

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

let threw = ''
try {
  createMemoryAi({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(CREATEMEMORYAI_DEPS.includes('generate'), '依赖清单')

function build(over = {}) {
  const added = []
  const writes = []
  const deps = {
    generate: async () => ({ text: '- 主人喜欢白饭\n- 主人有点懒' }),
    roomState: () => ({ msgs: Array.from({ length: 10 }, (_, i) => ({ isSelf: false, senderName: '张三', text: '消息' + i })) }),
    factsOf: () => [{ text: '旧事实' }],
    addFact: (roomId, text) => {
      added.push(text)
      return true
    },
    memDirOf: () => 'mem/900001',
    log: () => {},
    config: { memoryExtractEvery: 30, relationsEvery: 300 },
    readArchive: () => [],
    roomTextOf: () => ({ profile: '', summary: '', relations: '' }),
    invalidateRoomText: () => {},
    keywordsOf: (t) => String(t).split(/\s+/).filter(Boolean),
    isManagedRoom: () => true,
    analyze: () => ({ nodes: [], edges: [] }),
    buildRelationGraph: () => ({ nodes: [{ id: '1', name: '张三', msgs: 3 }], edges: [] }),
    graphPath: (dir) => dir + '/graph.json',
    normalizeEvent: (m) => m,
    ob: { call: async () => ({ messages: [] }) },
    patchMeta: (dir, patch) => writes.push(patch),
    relationsPath: (dir) => dir + '/relations.md',
    writeJson: (f, v) => writes.push([f, v]),
    writeTextSafe: (f, t) => writes.push([f, t]),
    ...over,
  }
  return { api: createMemoryAi(deps), added, writes }
}

// 提炼：消息太少
const a = build({ roomState: () => ({ msgs: [] }) })
const r1 = await a.api.extractFacts('900001')
ok(r1.ok === false && /消息太少/.test(r1.error), '消息太少不提炼')

// 提炼：正常
const b = build()
const r2 = await b.api.extractFacts('900001')
ok(r2.ok === true && r2.added === 2, '提炼出 2 条')
ok(b.added.includes('主人喜欢白饭'), '调用了 addFact')

// 提炼：模型输出「无」
const c = build({ generate: async () => ({ text: '无' }) })
const r3 = await c.api.extractFacts('900001')
ok(r3.ok === true && r3.added === 0, '模型说无时不添加')

// 检索：命中
const d = build()
d.api.factsOf = () => [] // 不生效，模块内部用的是注入的
const hits = d.api.searchMemory('900001', '白饭', 5)
ok(Array.isArray(hits), 'searchMemory 返回数组')

// 关系分析：正常
const e = build()
const r4 = await e.api.updateRelations({ roomId: '900001', isGroup: true, msgs: Array.from({ length: 40 }, (_, i) => ({ isSelf: false, senderName: '张三', sender: '42', text: '消息' + i })) })
ok(r4 && typeof r4 === 'object', 'updateRelations 返回对象')

console.log('')
if (fails.length) {
  console.log(`❌ test-memory-ai.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-memory-ai.mjs 通过 ${pass} 项，失败 0 项`)
