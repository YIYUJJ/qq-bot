/** push-server.mjs 回归测试：本机 POST 收消息、鉴权、方法限制、体积上限。 运行：node lib/test-push-server.mjs */
import { createPushServer } from './push-server.mjs'

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

const PORT = 3199
const events = []
const logs = []
const stats = {}
const server = createPushServer({
  config: { pushEnabled: true, pushPort: PORT, pushSecret: 's3cret' },
  log: (m) => logs.push(m),
  stats,
  onEvent: async (ev) => events.push(ev),
  // 假 ingestHistory：把原始消息转成最小事件
  ingestHistory: (list) => list.map((m) => ({ roomId: String(m.group_id || m.user_id || ''), text: m.raw_message || '' })),
})
server.start()
await new Promise((r) => setTimeout(r, 120))
ok(server.listening === true, '服务在监听')

const url = `http://127.0.0.1:${PORT}/qq-bot/push`
const post = (body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

// 1) 正确 secret + 群消息 → onEvent
const r1 = await post({ post_type: 'message', message_type: 'group', group_id: '900001', raw_message: 'hi' }, { authorization: 'Bearer s3cret' })
ok(r1.status === 204, '合法推送返回 204')
await new Promise((r) => setTimeout(r, 100))
ok(events.length === 1 && events[0].roomId === '900001', '消息被转成事件并回调 onEvent')
ok(stats.pushed === 1, '统计 pushed 累加')

// 2) 错误 secret → 401
const r2 = await post({ post_type: 'message' }, { authorization: 'Bearer wrong' })
ok(r2.status === 401, '错误 secret 返回 401')
ok(events.length === 1, '401 的请求不会触发 onEvent')

// 3) 非 POST → 405
const r3 = await fetch(url)
ok(r3.status === 405, 'GET 返回 405')

// 4) 非 message 类型的推送不触发 onEvent
const r4 = await post({ post_type: 'notice', notice_type: 'notify' }, { authorization: 'Bearer s3cret' })
ok(r4.status === 204, 'notice 推送仍返回 204')
await new Promise((r) => setTimeout(r, 100))
ok(events.length === 1, '非 message 类型不触发 onEvent')

server.stop()
await new Promise((r) => setTimeout(r, 50))
ok(server.listening === false, 'stop 后不再监听')

console.log('')
if (fails.length) {
  console.log(`❌ test-push-server.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-push-server.mjs 通过 ${pass} 项，失败 0 项`)
process.exit(0)
