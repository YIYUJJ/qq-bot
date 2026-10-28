/** tools-status.mjs 回归测试：两个只读工具的渲染（用假状态）。 运行：node lib/test-tools-status.mjs */
import { statusTools } from './tools-status.mjs'

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

const room = (over = {}) => ({
  roomId: '900001',
  roomName: '测试群',
  isGroup: true,
  allowed: true,
  msgs: [{ id: '1', text: '在吗', senderName: '张三', isSelf: false, ts: Date.now() }],
  replyTimes: [Date.now() - 1000],
  lastReplyAt: Date.now() - 120000,
  lastActivityAt: Date.now() - 60000,
  lastDecision: { reason: '被 @ 了' },
  msgSinceExtract: 3,
  msgSinceRelations: 10,
  nameCache: new Map(),
  ...over,
})

const deps = {
  connectInfo: () => 'WS：已连接\n账号：测试bot（1）',
  stats: { msgsIn: 2, replies: 1, skipped: 0, blocked: 0, llmCalls: 1, llmErrors: 0, sends: 1, pushed: 0, pushHits: 0, lastFirstTokenMs: 100, lastLatencyMs: 300 },
  config: { pushEnabled: true, replyProbability: 0.21, minReplyGapMs: 3000, maxRepliesPer10Min: 200, delayScale: 0.8, pollMs: 1000, quietHours: '', allowGroups: ['900001'] },
  push: { listening: true },
  rooms: new Map([['900001', room()]]),
  groupNames: new Map([['900001', '测试群'], ['900002', '另一个群']]),
  allowedHere: (r) => !!r.allowed,
  mustReply: () => false,
  factsOf: () => [{ text: 'x' }],
  cfgFor: () => ({ memoryExtract: true, memoryExtractEvery: 30, relationsEvery: 300 }),
  textOut: (t) => t,
}

const [status, roomsTool] = statusTools(deps)
ok(status.name === 'qqbot_status' && typeof status.execute === 'function', 'status 工具定义完整')
ok(roomsTool.name === 'qqbot_rooms', 'rooms 工具定义完整')

const s = await status.execute({})
ok(typeof s === 'string' && s.includes('QQ 机器人状态'), 'status 有标题')
ok(s.includes('闲聊 21%'), 'status 包含拟人参数')
ok(s.includes('群「测试群」'), 'status 列出活跃群')
ok(s.includes('记忆 1 条'), 'status 显示记忆条数')
ok(s.includes('另有 1 个群'), 'status 统计未活动群')

const r = await roomsTool.execute({})
ok(typeof r === 'string' && r.includes('测试群（900001）'), 'rooms 列出群与群号')
ok(r.includes('已授权'), 'rooms 标注授权状态')

// 空状态
const emptyDeps = { ...deps, rooms: new Map() }
const [s2, r2] = statusTools(emptyDeps)
ok((await s2.execute({})).includes('还没收到任何消息'), 'status 空状态提示')
ok((await r2.execute({})).includes('还没收到任何消息'), 'rooms 空状态提示')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-status.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-status.mjs 通过 ${pass} 项，失败 0 项`)
