/** model-route.mjs 回归测试：对话模型解析、视觉模型选择/回退/缓存。 运行：node lib/test-model-route.mjs */
import { MODEL_ROUTE_DEPS, createModelRoute } from './model.mjs'

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
  createModelRoute({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(MODEL_ROUTE_DEPS.includes('ctx'), '依赖清单')

function build(over = {}) {
  let route = null
  const logs = []
  const deps = {
    config: { provider: 'p', model: 'm', visionProvider: '', visionModel: '' },
    ctx: { get: () => null },
    getVisionRoute: () => route,
    setVisionRoute: (v) => {
      route = v
    },
    log: (m) => logs.push(m),
    ...over,
  }
  return { api: createModelRoute(deps), logs, getRoute: () => route }
}

// resolveModel：配置齐全
const a = build()
ok(a.api.resolveModel().provider === 'p', '配置里读到 provider')
ok(a.api.resolveModel().model === 'm', '配置里读到 model')

// 配置为空 → 用 agent 默认
const b = build({
  config: { provider: '', model: '' },
  ctx: { get: (n) => (n === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'dp', model: 'dm' }) } : null) },
})
ok(b.api.resolveModel().provider === 'dp', '回退到 agent 默认模型')

// 都拿不到 → 抛错
const c = build({ config: { provider: '', model: '' } })
let t2 = false
try {
  c.api.resolveModel()
} catch (e) {
  t2 = /没有可用的模型路由/.test(String(e.message))
}
ok(t2, '都拿不到时抛错')

// 视觉：指定模型存在
const d = build({
  config: { visionProvider: 'vp', visionModel: 'vm' },
  ctx: {
    get: (n) =>
      n === 'llm'
        ? {
            listProviders: () => [{ id: 'vp' }],
            listModels: async () => [{ id: 'vm' }, { id: 'other', inputModalities: ['image'] }],
          }
        : null,
  },
})
const r1 = await d.api.resolveVisionRoute()
ok(r1.provider === 'vp' && r1.model === 'vm', '指定的视觉模型可直接用')

// 指定模型不存在 → 回退到支持图片的
const e = build({
  config: { visionProvider: 'vp', visionModel: 'nope' },
  ctx: {
    get: (n) =>
      n === 'llm'
        ? { listProviders: () => [{ id: 'vp' }], listModels: async () => [{ id: 'x' }, { id: 'vis', inputModalities: ['image'] }] }
        : null,
  },
})
const r2 = await e.api.resolveVisionRoute()
ok(r2.model === 'vis', '不存在时回退到支持图片的模型')
ok(e.logs.some((l) => l.includes('视觉模型回退')), '回退有日志')

// 缓存：第二次直接返回，不再调 LLM
let calls = 0
const f = build({
  config: { visionProvider: 'vp', visionModel: 'vm' },
  ctx: {
    get: (n) =>
      n === 'llm'
        ? { listProviders: () => (calls++, [{ id: 'vp' }]), listModels: async () => [{ id: 'vm' }] }
        : null,
  },
})
await f.api.resolveVisionRoute()
const before = calls
await f.api.resolveVisionRoute()
ok(calls === before, '第二次走缓存（不再查询模型列表）')

// 找不到 → 抛错
const g = build({
  config: { visionProvider: 'vp', visionModel: 'vm' },
  ctx: { get: (n) => (n === 'llm' ? { listProviders: () => [{ id: 'other' }], listModels: async () => [] } : null) },
})
// 查不到可用模型时：按配置原样回退（不抛错）
const r3 = await g.api.resolveVisionRoute()
ok(r3.provider === 'vp' && r3.model === 'vm', '查不到模型时仍按配置回退使用')

console.log('')
if (fails.length) {
  console.log(`❌ test-model-route.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-model-route.mjs 通过 ${pass} 项，失败 0 项`)
