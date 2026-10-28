/** tools-selftest.mjs 回归测试：链路回放与自检明细渲染。 运行：node lib/test-tools-selftest.mjs */
import { selftestTools } from './tools-selftest.mjs'

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

const stats = { replies: 0, lastFirstTokenMs: 120, lastLatencyMs: 300 }
const played = []
const mk = (over = {}) =>
  selftestTools({
    assertGroupAllowed: () => {},
    ob: {
      status: { self: { user_id: 1 } },
      call: async () => ({
        messages: [
          { user_id: 1, message_id: 1, raw_message: '我自己', message: [], time: Math.floor(Date.now() / 1000) },
          { user_id: 42, message_id: 2, raw_message: '别人说的', message: [{ type: 'text', data: { text: '别人说的' } }], time: Math.floor(Date.now() / 1000), sender: { user_id: 42, nickname: '张三' } },
        ],
      }),
    },
    normalizeEvent: (m) => ({
      id: m.message_id,
      roomId: '900001',
      text: m.raw_message,
      senderName: m.sender?.nickname || '',
      sender: m.user_id,
      ts: (m.time || 0) * 1000,
    }),
    roomState: () => ({ seen: new Set([2]), lastDecision: { reason: '被 @ 了' } }),
    stats,
    onEvent: async (ev) => {
      played.push(ev)
      stats.replies += 1
    },
    log: () => {},
    sleep: async () => {},
    cfgFor: () => ({ fastDebounceMs: 400 }),
    config: { delayScale: 0.8, streamSend: true },
    selfcheck: async () => ({
      items: [
        { level: 'ok', name: 'WS', text: '已连接' },
        { level: 'warn', name: '模型', text: '未配置', advice: '去面板选一个' },
        { level: 'bad', name: '白名单', text: '为空' },
      ],
      bad: ['白名单'],
      warn: ['模型'],
    }),
    textOut: (t) => t,
    ...over,
  })

const [selftest, selfcheck] = mk()

const r1 = await selftest.execute({ room: 'group:900001' })
ok(r1.includes('回放：张三: 别人说的'), '回放别人最新一条消息')
ok(r1.includes('✅ 已回复'), '回复成功判定')
ok(played.length === 1 && played[0].text === '别人说的', '确实调用了 onEvent')

// 没回复
stats.replies = 0
const [selftestNoReply] = mk({ onEvent: async () => {} })
const r2 = await selftestNoReply.execute({ room: '900001' })
ok(r2.includes('❌ 未回复'), '未回复时显示决策原因')

// 没有可回放消息
const [selftestEmpty] = mk({
  ob: { status: { self: { user_id: 1 } }, call: async () => ({ messages: [{ user_id: 1, raw_message: '我', message: [] }] }) },
})
let threw = false
try {
  await selftestEmpty.execute({ room: '900001' })
} catch {
  threw = true
}
ok(threw, '没有别人消息时抛错')

// selfcheck 渲染
const r3 = await selfcheck.execute({})
ok(r3.includes('✅ WS：已连接'), 'ok 项渲染')
ok(r3.includes('⚠️  模型：未配置') && r3.includes('→ 去面板选一个'), 'warn 项带建议')
ok(r3.includes('❌ 白名单：为空'), 'bad 项渲染')
ok(r3.includes('异常 1 项｜提醒 1 项'), '汇总计数')
ok(r3.includes('异常项：白名单'), '异常项列表')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-selftest.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-selftest.mjs 通过 ${pass} 项，失败 0 项`)
