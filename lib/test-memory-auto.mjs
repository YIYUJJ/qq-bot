/** memory-auto.mjs 回归测试：托管校验 + 提炼/画像/摘要/关系的触发条件。 运行：node lib/test-memory-auto.mjs */
import { CREATEMAYBEAUTOEXTRACT_DEPS, createMaybeAutoExtract } from './memory-auto.mjs'

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
  createMaybeAutoExtract({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(CREATEMAYBEAUTOEXTRACT_DEPS.includes('extractFacts'), '依赖清单')

function build(over = {}) {
  const calls = []
  const deps = {
    cfgFor: () => ({ memoryExtract: true, memoryExtractEvery: 5, profileEvery: 0, relationsEvery: 50, relationsCooldownMs: 3600000, memorySummaryEvery: 80 }),
    extractFacts: async () => {
      calls.push('extract')
      return { ok: true, added: 2 }
    },
    isManagedRoom: () => true,
    memDirOf: () => 'mem/900001',
    readRoomMemory: () => ({ facts: [], meta: {} }),
    log: () => {},
    updateProfile: async () => {
      calls.push('profile')
      return { ok: true, text: '画像' }
    },
    updateRelations: async () => {
      calls.push('relations')
      return { ok: true, text: '关系' }
    },
    updateSummary: async () => {
      calls.push('summary')
      return { ok: true, text: '摘要' }
    },
    ...over,
  }
  return { run: createMaybeAutoExtract(deps), calls }
}

const mkRoom = (over = {}) => ({ roomId: '900001', isGroup: true, roomName: '测试群', msgSinceExtract: 5, msgSinceRelations: 20, msgs: [], ...over })

// 未托管：什么都不做
const a = build({ isManagedRoom: () => false })
a.run(mkRoom())
ok(a.calls.length === 0, '未托管会话不触发任何分析')

// 达到提炼阈值
const b = build()
b.run(mkRoom())
await new Promise((r) => setTimeout(r, 50))
ok(b.calls.includes('extract'), '达到阈值触发提炼')

// 提炼关闭
const c = build({ cfgFor: () => ({ memoryExtract: false, memoryExtractEvery: 5, profileEvery: 10, relationsEvery: 20 }) })
c.run(mkRoom())
await new Promise((r) => setTimeout(r, 50))
ok(!c.calls.includes('extract'), '关闭自动提炼时不触发')

// 未达阈值
const d = build()
d.run(mkRoom({ msgSinceExtract: 1, msgSinceRelations: 1 }))
await new Promise((r) => setTimeout(r, 50))
ok(d.calls.length === 0, '未达阈值不触发')

// 关系分析（群）
const e = build()
e.run(mkRoom({ msgSinceExtract: 0, msgSinceRelations: 50 }))
await new Promise((r) => setTimeout(r, 50))
ok(e.calls.includes('relations'), '群达到关系阈值触发关系分析')

console.log('')
if (fails.length) {
  console.log(`❌ test-memory-auto.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-memory-auto.mjs 通过 ${pass} 项，失败 0 项`)
