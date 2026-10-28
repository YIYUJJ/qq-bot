/** ingest.mjs 回归测试：群/私聊归一、自己消息标记、脏数据跳过。 运行：node lib/test-ingest.mjs */
import { createIngest } from './ingest.mjs'
import { normalizeEvent } from './onebot.mjs'

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

const ingest = createIngest({ normalizeEvent, getSelfId: () => 999 })

// 群消息
const [g] = ingest([
  {
    post_type: 'message',
    message_type: 'group',
    group_id: 123456,
    user_id: 42,
    message_id: 7,
    raw_message: '在吗',
    time: Math.floor(Date.now() / 1000),
    sender: { user_id: 42, nickname: '张三', card: '张三' },
    message: [{ type: 'text', data: { text: '在吗' } }],
    self_id: 999,
  },
])
ok(g && g.roomId === '123456', '群消息 roomId 正确')
ok(g && g.isGroup === true, '群消息 isGroup=true')
ok(g && g.text === '在吗', '群消息文本正确')
ok(g && g.isSelf === false, '别人的消息 isSelf=false')

// 私聊（peerId 覆盖 roomId）
const [p] = ingest(
  [
    {
      post_type: 'message',
      message_type: 'private',
      user_id: 42,
      message_id: 8,
      raw_message: '私聊内容',
      time: Math.floor(Date.now() / 1000),
      sender: { user_id: 42, nickname: '张三' },
      message: [{ type: 'text', data: { text: '私聊内容' } }],
      self_id: 999,
    },
  ],
  '900001',
)
ok(p && p.roomId === '900001', '私聊 roomId 用 peerId 覆盖')
ok(p && p.isGroup === false, '私聊 isGroup=false')

// 自己发的私聊
const [me] = ingest(
  [
    {
      post_type: 'message',
      message_type: 'private',
      user_id: 999,
      message_id: 9,
      raw_message: '我自己',
      time: Math.floor(Date.now() / 1000),
      sender: { user_id: 999, nickname: '我' },
      message: [{ type: 'text', data: { text: '我自己' } }],
      self_id: 999,
    },
  ],
  '900001',
)
ok(me && me.isSelf === true, '自己发的私聊被标记 isSelf')

// 脏数据不影响整批
const batch = ingest([null, { bad: true }, { post_type: 'message', message_type: 'group', group_id: 1, user_id: 2, message: [], raw_message: 'ok', time: Math.floor(Date.now() / 1000) }])
ok(Array.isArray(batch), '脏数据不会抛错')
ok(batch.every((x) => x.roomId), '输出都带 roomId')

console.log('')
if (fails.length) {
  console.log(`❌ test-ingest.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-ingest.mjs 通过 ${pass} 项，失败 0 项`)
