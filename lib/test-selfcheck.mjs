/** selfcheck.mjs 回归测试：各项检查的分支与 health 回写。 运行：node lib/test-selfcheck.mjs */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SELFCHECK_DEPS, createSelfcheck } from './selfcheck.mjs'

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
  createSelfcheck({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(SELFCHECK_DEPS.includes('ob'), '依赖清单')

function build(over = {}) {
  let health = null
  const deps = {
    ob: {
      status: { connected: true, reconnects: 0, self: { user_id: 1, nickname: 'bot' } },
      health: async () => ({ http: true, ws: true, self: { user_id: 1, nickname: 'bot' } }),
    },
    config: { allowGroups: ['900001'], pollMs: 1000, provider: 'p', model: 'm' },
    groupNames: new Map([['900001', '测试群']]),
    resolveModel: () => ({ provider: 'p', model: 'm' }),
    getLlm: () => ({ listModels: async () => [{ id: 'm' }] }),
    logFile: join(tmpdir(), 'qqbot-selfcheck.log'),
    getHealth: () => health,
    setHealth: (h) => {
      health = h
    },
    ...over,
  }
  return { run: createSelfcheck(deps), getHealth: () => health }
}

// 全绿
const a = build()
const h1 = await a.run()
ok(h1.items.length >= 6, '检查项数量')
ok(h1.bad.length === 0, '全绿时没有 bad')
ok(h1.items.find((i) => i.name === 'WS 连接').level === 'ok', 'WS 连接 ok')
ok(h1.items.find((i) => i.name === '白名单群').text.includes('测试群'), '白名单显示群名')
ok(h1.items.find((i) => i.name === '模型路由').level === 'ok', '模型路由 ok')
ok(a.getHealth() === h1, 'health 被回写（同一对象）')

// WS 断开 + 无白名单
const b = build({
  ob: { status: { connected: false, lastError: 'ECONNREFUSED' }, health: async () => ({ http: false, error: 'refused' }) },
  config: { allowGroups: [], pollMs: 0, provider: '', model: '' },
})
const h2 = await b.run()
ok(h2.items.find((i) => i.name === 'WS 连接').level === 'bad', 'WS 断开 → bad')
ok(h2.items.find((i) => i.name === '白名单群').level === 'warn', '无白名单 → warn')
ok(h2.items.find((i) => i.name === '收消息通路').level === 'bad', '无轮询且未连接 → bad')
ok(h2.items.find((i) => i.name === '模型路由').level === 'warn', '未显式配置模型 → warn')
ok(h2.bad.length >= 2, '汇总 bad 项')

// 模型列表里没有目标模型
const c = build({ getLlm: () => ({ listModels: async () => [{ id: 'other' }] }) })
const h3 = await c.run()
const mr = h3.items.find((i) => i.name === '模型路由')
ok(mr.level === 'bad' && mr.text.includes('不在该 provider'), '模型不存在 → bad 且说明原因')
ok(String(mr.advice).includes('other'), '给出可用模型建议')

// provider 没有模型
const d = build({ getLlm: () => ({ listModels: async () => [] }) })
const h4 = await d.run()
ok(h4.items.find((i) => i.name === '模型路由').level === 'bad', 'provider 无模型 → bad')

// 日志不可写
const e = build({ logFile: 'Z:/not-exist/bot.log' })
const h5 = await e.run()
const logItem = h5.items.find((i) => i.name === '日志可写')
ok(logItem.level === 'bad', '日志不可写 → bad')

console.log('')
if (fails.length) {
  console.log(`❌ test-selfcheck.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-selfcheck.mjs 通过 ${pass} 项，失败 0 项`)
