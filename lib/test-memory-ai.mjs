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
    isGroupRoom: () => true,
    DATA_DIR: 'C:/x',
    whoHint: () => '某人',
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

// 提炼：新格式 QQ号|重要度|事实，who 只认记录里出现过的 QQ
const mkMsgs = (n, t0 = 1000) =>
  Array.from({ length: n }, (_, i) => ({ isSelf: false, sender: '42', senderName: '张三', ts: t0 + i, text: '消息' + i }))
const addedFull = []
const f1 = build({
  roomState: () => ({ msgs: mkMsgs(10) }),
  generate: async () => ({ text: '42|5|张三生日是3月5日\n99999|3|李四喜欢猫\n群|2|群里周五开黑' }),
  addFact: (roomId, text, at, extra) => {
    addedFull.push({ text, ...extra })
    return true
  },
})
const r5 = await f1.api.extractFacts('900001')
ok(r5.ok && r5.added === 3, '新格式提炼出 3 条')
ok(addedFull[0].who === '42' && addedFull[0].importance === 5 && addedFull[0].whoName === '张三', '解析出 who / 重要度 / 昵称')
ok(!addedFull[1].who, '记录里没出现的 QQ 号不采信')
ok(!addedFull[2].who && addedFull[2].importance === 2, '"群"不带 who')

// 提炼：游标推进 + 分批
let calls = 0
const room = { msgs: mkMsgs(130) }
const f2 = build({
  roomState: () => room,
  generate: async () => {
    calls += 1
    return { text: '无' }
  },
})
const r6 = await f2.api.extractFacts('900001')
ok(r6.batches === 3 && calls === 3, '130 条新消息分 3 批提炼')
ok(room.extractCursorTs === 1129, '游标推进到最后一条消息')
room.msgs.push(...mkMsgs(8, 5000))
calls = 0
await f2.api.extractFacts('900001')
ok(calls === 1, '第二次只处理游标之后的新消息')

// 提炼：第二批失败时保留第一批进度
let n3 = 0
const room3 = { msgs: mkMsgs(100) }
const f3 = build({
  roomState: () => room3,
  generate: async () => {
    n3 += 1
    if (n3 === 2) throw new Error('boom')
    return { text: '无' }
  },
})
const r7 = await f3.api.extractFacts('900001')
ok(r7.ok && r7.batches === 1 && room3.extractCursorTs === 1059, '中途失败保留已完成批次的进度')

// 检索：BM25 能按人名找回
const g = build({ factsOf: () => [{ text: '张三生日是3月5日', at: 1 }, { text: '群里周五开黑', at: 2 }] })
const hits2 = g.api.searchMemory('900001', '还记得张三生日吗', 2)
ok(hits2.length >= 1 && /张三生日/.test(hits2[0].text), 'BM25 检索命中正确事实（去掉"还记得"噪声）')

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
