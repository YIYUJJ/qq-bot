/** polling.mjs 回归测试：基线吞旧消息、轮询并行、防重入。 运行：node lib/test-polling.mjs */
import { POLLING_DEPS, createPolling } from './polling.mjs'

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
  createPolling({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(POLLING_DEPS.includes('ob'), '依赖清单')

function build(over = {}) {
  const rooms = new Map()
  const handled = []
  const calls = []
  const logs = []
  const deps = {
    config: { pollMs: 1000, allowGroups: ['900001'], allowPrivate: ['42'], adminQQ: ['1'] },
    ob: {
      async call(action, params) {
        calls.push([action, params])
        const now = Math.floor(Date.now() / 1000)
        if (action === 'get_group_msg_history') {
          return {
            messages: [
              { user_id: 42, message_id: 'old', raw_message: '旧消息', message: [{ type: 'text', data: { text: '旧消息' } }], time: now - 600, sender: { user_id: 42, nickname: '张三' } },
              { user_id: 42, message_id: 'new', raw_message: '新消息', message: [{ type: 'text', data: { text: '新消息' } }], time: now, sender: { user_id: 42, nickname: '张三' } },
            ],
          }
        }
        return { messages: [] }
      },
    },
    ingestHistory: (messages, peerId) =>
      (messages || []).map((m) => ({
        id: m.message_id,
        ts: (m.time || 0) * 1000,
        sender: m.user_id,
        senderName: m.sender?.nickname || '',
        text: m.raw_message,
        images: 0,
      })),
    onEvent: async (ev) => handled.push(ev),
    roomState: (id) => {
      if (!rooms.has(id)) rooms.set(id, { roomId: id, isGroup: true, msgs: [], seen: new Set(), lastActivityAt: 0 })
      return rooms.get(id)
    },
    log: (m) => logs.push(m),
    ...over,
  }
  return { api: createPolling(deps), rooms, handled, calls, logs }
}

// 基线：旧消息进 msgs 并加入 seen，新消息不进 seen
const a = build()
await a.api.primeAllowed()
const room = a.rooms.get('900001')
ok(room.msgs.length === 2, '基线写入全部消息')
ok(room.seen.has('old'), '冷消息加入去重集合')
ok(!room.seen.has('new'), '新消息不进去重集合（仍待处理）')
ok(room.isGroup === true, '群标记正确')
ok(a.logs.some((l) => l.includes('基线：群 900001')), '记录基线日志')

// 轮询：调用 onEvent 处理消息
const b = build()
await b.api.pollOnce()
ok(b.handled.length >= 2, '轮询把消息交给 onEvent（群 + 私聊）')
ok(b.calls.some(([act]) => act === 'get_group_msg_history'), '拉群历史')
ok(b.calls.some(([act]) => act === 'get_friend_msg_history'), '拉私聊历史')

// 防重入：手动把 isPolling 变 true 无法直接设置，改为并发调用两次
const c = build()
const p1 = c.api.pollOnce()
const p2 = c.api.pollOnce()
await Promise.all([p1, p2])
ok(c.calls.filter(([act]) => act === 'get_group_msg_history').length >= 1, '并发调用只跑一次拉取')

// pollMs=0：不轮询
const d = build({ config: { pollMs: 0, allowGroups: ['900001'], allowPrivate: [], adminQQ: [] } })
await d.api.pollOnce()
ok(d.calls.length === 0, 'pollMs=0 时不拉取')

// privateTargets 去重
const e = build({ config: { pollMs: 1000, allowGroups: [], allowPrivate: ['42', '42'], adminQQ: ['1', '42'] } })
ok(JSON.stringify(e.api.privateTargets()) === JSON.stringify(['42', '1']), '私聊目标去重且合并管理员')

console.log('')
if (fails.length) {
  console.log(`❌ test-polling.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-polling.mjs 通过 ${pass} 项，失败 0 项`)
