/** room-snapshot.mjs 回归测试：字段、缓存命中、依赖校验。 运行：node lib/test-room-snapshot.mjs */
import { ROOM_SNAPSHOT_DEPS, createRoomSnapshot } from './room-snapshot.mjs'

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
  createRoomSnapshot({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(ROOM_SNAPSHOT_DEPS.includes('factsOf'), '依赖清单')

const now = Date.now()
const room = {
  roomId: '900001',
  roomName: '测试群',
  isGroup: true,
  msgs: [
    { ts: now - 5000, isSelf: false, senderName: '张三', text: '在吗' },
    { ts: now - 1000, isSelf: true, senderName: 'bot', text: '在的' },
  ],
  replyTimes: [now - 1000, now - 400000, now - 900000],
  lastReplyAt: now - 1000,
  lastActivityAt: now,
  lastDecision: { at: now, reason: '被 @ 了' },
  nameCache: new Map(),
}

const cache = new Map()
const deps = {
  factsOf: () => [{ text: 'a' }, { text: 'b' }],
  countOverrides: () => 3,
  roomOverrideOf: () => ({ replyProbability: 0.5 }),
  allowedHere: () => true,
  cfgFor: () => ({ memoryExtractEvery: 30, memoryExtract: true }),
  config: { maxRepliesPer10Min: 200 },
  panelRoomCache: cache,
}
const roomSnapshot = createRoomSnapshot(deps)

const s = roomSnapshot(room)
ok(s.roomId === '900001' && s.roomName === '测试群', '基础字段')
ok(s.msgs === 2 && s.facts === 2, '消息/事实计数')
ok(s.overrideCount === 3, '覆盖计数')
ok(s.policy.replies10m === 2, '10 分钟回复计数（只算窗口内）')
ok(s.policy.maxRepliesPer10Min === 200, '上限来自 config')
ok(s.memory.auto === true && s.memory.every === 30, '记忆配置')
ok(Array.isArray(s.recent) && s.recent.length === 2, '最近消息')
ok(s.recent[1].who === '我', '自己消息显示"我"')

// 缓存：同一状态第二次返回同一对象
const s2 = roomSnapshot(room)
ok(s2 === s, '状态未变时命中缓存（同一对象）')

// 状态变化 → 重新构建
room.msgs.push({ ts: now, isSelf: false, senderName: '李四', text: '新消息' })
const s3 = roomSnapshot(room)
ok(s3 !== s && s3.msgs === 3, '状态变化后重建')

// 未授权
const denied = createRoomSnapshot({ ...deps, allowedHere: () => false })(room)
ok(denied.allowed === false, '未授权标记')

console.log('')
if (fails.length) {
  console.log(`❌ test-room-snapshot.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-room-snapshot.mjs 通过 ${pass} 项，失败 0 项`)
