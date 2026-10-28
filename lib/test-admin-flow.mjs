/** admin-flow.mjs 回归测试：规则命中/多动作/确认流程/执行动作。 运行：node lib/test-admin-flow.mjs */
import { ADMIN_FLOW_DEPS, createAdminFlow } from './admin-flow.mjs'

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
  createAdminFlow({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(ADMIN_FLOW_DEPS.includes('handleAdminCommand') === false && ADMIN_FLOW_DEPS.length >= 10, '依赖清单')

function build(over = {}) {
  const sent = []
  const overrides = {}
  const deps = {
    ob: { sendPrivate: async (id, text) => sent.push(['private', id, text]), sendGroupSegments: async () => {} },
    config: { adminCommands: true, adminQQ: ['1'], adminNL: false, adminMaxActions: 2, adminConfirmTtlMs: 120000, aliases: [], botName: 'bot' },
    log: () => {},
    generate: async () => ({ text: '生成的一句话' }),
    systemPrompt: () => '人设',
    roomState: (id) => ({ roomId: id, msgs: [], isGroup: true, replyTimes: [], nameCache: new Map() }),
    setRoomOverride: (id, patch) => {
      overrides[id] = { ...(overrides[id] || {}), ...patch }
      return { ok: true, applied: patch, rejected: {}, count: 1 }
    },
    roomOverrides: overrides,
    sendWithRetry: async (roomId, isGroup, kind, text) => {
      sent.push([roomId, kind, text])
      return { queued: false }
    },
    parseAdminCommand: (t) => (/说/.test(t) ? { action: 'say', target: { roomId: '900001', name: '测试群' }, text: '你好' } : null),
    describeAdminAction: (a) => `将执行 ${a.action}`,
    normalizePlannedActions: (list) => list,
    metrics: { inc: () => {}, observe: () => {}, event: () => {} },
    stats: { sends: 0 },
    sleep: async () => {},
    isAllowedGroup: () => true,
    ...over,
  }
  return { api: createAdminFlow(deps), sent, overrides }
}

// 非私聊 / 未开启：不处理
const a = build({ config: { adminCommands: false, adminQQ: ['1'], adminNL: false, adminMaxActions: 2, aliases: [], botName: 'bot' } })
ok((await a.api.handleAdminCommand({ isGroup: true, roomId: '900001' }, { text: '说：你好' })) === false, '群消息不走管理员流程')

// 非管理员
const b = build()
ok((await b.api.handleAdminCommand({ isGroup: false, roomId: '999' }, { text: '说：你好' })) === false, '非管理员私聊不处理')

// 管理员：规则命中 → 发确认
const c = build()
const handled = await c.api.handleAdminCommand({ isGroup: false, roomId: '1' }, { text: '在大肥鱼群说：你好' })
ok(handled === true, '管理员指令被消费')
ok(c.sent.some(([k]) => k === 'private'), '发出确认消息')

// 管理员：确认执行（回复"确认"）
const d = build()
await d.api.handleAdminCommand({ isGroup: false, roomId: '1' }, { text: '在大肥鱼群说：你好' })
const done = await d.api.handleAdminCommand({ isGroup: false, roomId: '1' }, { text: '确认' })
ok(done === true, '确认回复被消费')
ok(d.sent.some(([room]) => room === '900001'), '确认后真的执行发送')

// 取消
const e = build()
await e.api.handleAdminCommand({ isGroup: false, roomId: '1' }, { text: '在大肥鱼群说：你好' })
await e.api.handleAdminCommand({ isGroup: false, roomId: '1' }, { text: '取消' })
ok(true, '取消流程不抛错')

// replyAdmin
const f = build()
await f.api.replyAdmin('1', 'hello')
ok(f.sent.some(([kind, , text]) => kind === 'private' && text === 'hello'), 'replyAdmin 发私聊')

console.log('')
if (fails.length) {
  console.log(`❌ test-admin-flow.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-admin-flow.mjs 通过 ${pass} 项，失败 0 项`)
