/** tools-memory.mjs 回归测试：托管校验 + 增删改查 + show/graph。 运行：node lib/test-tools-memory.mjs */
import { memoryTools } from './tools-memory.mjs'

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

let factsMap = { 900001: [{ text: '主人喜欢白饭', at: Date.now() }] }
const writes = []
const norm = (t) => String(t || '').trim().toLowerCase()
const mk = () =>
  memoryTools({
    config: { memoryRooms: ['900001'] },
    isManagedRoom: (id) => id === '900001',
    cfgFor: () => ({ memoryExtract: true }),
    roomState: (id) => ({ roomId: id, msgs: [] }),
    facts: factsMap,
    factsOf: (id) => factsMap[id] || [],
    loadFacts: (id) => [...(factsMap[id] || [])],
    factNorm: norm,
    addFact: (id, text) => {
      if (!text) return false
      factsMap[id] = factsMap[id] || []
      if (factsMap[id].some((f) => norm(f.text) === norm(text))) return false
      factsMap[id].push({ text, at: Date.now() })
      return true
    },
    delFact: (id, text) => {
      const before = (factsMap[id] || []).length
      factsMap[id] = (factsMap[id] || []).filter((f) => norm(f.text) !== norm(text))
      return factsMap[id].length < before
    },
    writeRoomFacts: (dir, list) => writes.push([dir, list.length]),
    memDirOf: (id) => (id === '900001' ? 'mem/900001' : ''),
    readRoomText: () => ({ profile: '画像内容', summary: '摘要内容', relations: '关系内容' }),
    readJson: () => ({ nodes: [{ id: '1', name: '张三', msgs: 10 }], edges: [{ a: '1', b: '1', w: 3 }] }),
    graphPath: (dir) => dir + '/graph.json',
    updateProfile: async () => ({ ok: true, text: '新画像' }),
    updateSummary: async () => ({ ok: true, text: '新摘要' }),
    updateRelations: async () => ({ ok: true, text: '新关系' }),
    extractFacts: async () => ({ ok: true, added: 2, lines: ['A', 'B'] }),
    searchMemory: () => [{ kind: 'fact', text: '旧记忆' }],
    exportMemory: () => ({ ok: true, files: { a: 1, b: 2 }, file: 'out.zip' }),
    textOut: (t) => t,
  })[0]

const tool = mk()

// 未托管
ok((await tool.execute({ room: '900002' })).includes('不在记忆托管名单'), '未托管提示')

// 列表
ok((await tool.execute({ room: '900001' })).includes('主人喜欢白饭'), '列出记忆')

// 新增 / 重复
ok((await tool.execute({ room: '900001', action: 'add', text: '喜欢吃辣' })) === '已记下', '新增记忆')
ok((await tool.execute({ room: '900001', action: 'add', text: '喜欢吃辣' })) === '已存在（归一化后重复）', '重复记忆提示')

// 删除
ok((await tool.execute({ room: '900001', action: 'del', text: '喜欢吃辣' })) === '已删除', '删除记忆')
ok((await tool.execute({ room: '900001', action: 'del', text: '不存在' })) === '没找到这条', '删除不存在提示')

// 修改
const up = await tool.execute({ room: '900001', action: 'update', old: '主人喜欢白饭', text: '主人爱吃面' })
ok(up.includes('已修改') && factsMap['900001'][0].text === '主人爱吃面', '修改记忆生效')
ok((await tool.execute({ room: '900001', action: 'update', old: 'nope', text: 'x' })) === '没找到这条记忆', '修改不存在的记忆')

// 清空
ok((await tool.execute({ room: '900001', action: 'clear' })).includes('已清空'), '清空记忆')

// 提炼/画像/摘要/关系
ok((await tool.execute({ room: '900001', action: 'extract' })).includes('提炼出 2 条'), '提炼')
ok((await tool.execute({ room: '900001', action: 'profile' })) === '新画像', '画像')
ok((await tool.execute({ room: '900001', action: 'summary' })) === '新摘要', '摘要')
ok((await tool.execute({ room: '900001', action: 'relations' })) === '新关系', '关系')

// 搜索/导出/关系图/show
ok((await tool.execute({ room: '900001', action: 'search', text: '旧' })).includes('旧记忆'), '搜索')
ok((await tool.execute({ room: '900001', action: 'export' })).includes('已导出 2 个文件'), '导出')
ok((await tool.execute({ room: '900001', action: 'graph' })).includes('张三'), '关系图')
const show = await tool.execute({ room: '900001', action: 'show' })
ok(show.includes('画像（') && show.includes('摘要（'), 'show 汇总')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-memory.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-memory.mjs 通过 ${pass} 项，失败 0 项`)
