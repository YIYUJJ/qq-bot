/** model.mjs 回归测试：generate/analyze 的流式聚合、失败处理、关键词/人名提示。 运行：node lib/test-model.mjs */
import { MODEL_DEPS, createModel } from './model.mjs'

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
  createModel({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(MODEL_DEPS.includes('metrics'), '依赖清单')

function build(over = {}) {
  const usage = []
  const stats = { llmCalls: 0, llmErrors: 0, lastFirstTokenMs: 0, lastLatencyMs: 0 }
  const deps = {
    config: { temperature: 0.8, maxTokens: 300, streamSend: true, adminQQ: [], allowGroups: [] },
    llm: {
      async *stream() {
        yield { type: 'text-delta', text: '你好' }
        yield { type: 'text-delta', text: '呀' }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
        yield { type: 'finish', reason: 'stop' }
      },
    },
    log: () => {},
    metrics: { inc: () => {}, observe: () => {}, event: () => {} },
    noteUsage: (u) => usage.push(u),
    resolveModel: () => ({ provider: 'p', model: 'm' }),
    stats,
    track: (t) => t,
    untrack: () => {},
    HIST_STOP: new Set(['的', '了']),
    createUserMessage: (input) => ({ ...input, role: 'user' }),
    ...over,
  }
  return { api: createModel(deps), usage, stats }
}

// generate 流式聚合
const a = build()
const r = await a.api.generate({ system: 's', user: 'u' })
ok(r.text === '你好呀', 'generate 聚合文本')
ok(r.firstTokenMs >= 0, '返回首字耗时')
ok(a.usage.length === 1, 'noteUsage 被调用')
ok(a.stats.llmCalls >= 1, 'llmCalls 计数')

// 模型抛错
const b = build({
  llm: {
    async *stream() {
      throw new Error('provider down')
    },
  },
})
let threw2 = false
try {
  await b.api.generate({ system: 's', user: 'u' })
} catch {
  threw2 = true
}
ok(threw2, '模型异常时 generate 抛错（由上层兜）')
ok(b.stats.llmErrors >= 1, 'llmErrors 计数')

// analyze：结构化输出
const c = build({
  llm: {
    async *stream() {
      yield { type: 'text-delta', text: '分析结果' }
      yield { type: 'finish', reason: 'stop' }
    },
  },
})
const r2 = await c.api.analyze('system', 'user')
ok(r2 && typeof r2 === 'object', 'analyze 返回对象')
ok(r2.text === '分析结果', 'analyze 文本正确')

// analyze：模型返回空
const d = build({
  llm: {
    async *stream() {
      yield { type: 'finish', reason: 'length' }
    },
  },
})
const r3 = await d.api.analyze('system', 'user')
ok(r3.text === '', '空输出时 text 为空')

// keywordsOf：去停用词
const e = build()
const kws = e.api.keywordsOf('我想吃白饭和红烧肉还有可乐')
ok(Array.isArray(kws), 'keywordsOf 返回数组')
ok(!kws.includes('的'), '停用词被过滤')

// whoHint
const f = build()
const hint = f.api.whoHint({ isGroup: false, roomId: '999' })
ok(typeof hint === 'string', 'whoHint 返回字符串')

console.log('')
if (fails.length) {
  console.log(`❌ test-model.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-model.mjs 通过 ${pass} 项，失败 0 项`)
