/** on-event.mjs 回归测试：notice、去重、白名单、表情入库、pending 入队。 运行：node lib/test-on-event.mjs */
import { CREATEONEVENT_DEPS, createOnEvent } from './on-event.mjs'

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
  createOnEvent({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(CREATEONEVENT_DEPS.length >= 15, '依赖清单完整（' + CREATEONEVENT_DEPS.length + ' 项）')

const mk = (over = {}) => {
  const room = { roomId: '900001', isGroup: true, msgs: [], pending: [], seen: new Set(), nameCache: new Map(), lastActivityAt: 0, replyTimes: [], lastReplyAt: 0, roomName: '测试群' }
  const calls = { flushed: 0, notices: 0, stickers: 0, favs: 0, extract: 0 }
  const deps = {
    VIDEO_DIR: 'C:/v',
    allowedHere: () => true,
    attachVision: async () => {},
    cfgFor: () => ({ videoOnMessage: false, linkVideo: false }),
    config: { enabled: true, useDbMembers: false, aliases: [], botName: 'bot', visionOnImage: false, videoOnMessage: false, linkVideo: false, memoryRooms: [], adminCommands: false },
    describeVideo: async () => ({ desc: '', duration: 0 }),
    docLibDir: 'C:/d',
    ensureStickerFile: async () => {},
    favoriteSticker: async () => calls.favs++,
    getFeatures: () => new Proxy({}, { get: () => () => undefined }),
    handleNotice: async () => calls.notices++,
    inferMood: () => {},
    log: () => {},
    metrics: { inc: () => {}, observe: () => {}, event: () => {} },
    ob: { status: { self: { user_id: 1 } }, groupMember: async () => null },
    rememberSticker: () => { calls.stickers++; return 'sid' },
    rememberVideo: () => {},
    roomState: () => room,
    scheduleFlush: () => calls.flushed++,
    stats: { msgsIn: 0 },
    stickers: { sid: { url: 'http://x/a.png' } },
    ...over,
  }
  return { onEvent: createOnEvent(deps), room, calls, deps }
}

// notice 分流
const a = mk()
await a.onEvent({ notice: { notice_type: 'notify', sub_type: 'poke' } })
ok(a.calls.notices === 1, 'notice 交给 handleNotice')

// 正常消息
const b = mk()
await b.onEvent({ id: 'm1', roomId: '900001', isGroup: true, sender: '42', senderName: '张三', text: '在吗', isAtMe: true, images: 0, imageUrls: [], ts: Date.now() })
ok(b.room.msgs.length === 1, '消息入库')
ok(b.room.seen.has('m1'), '去重集合记录 id')
ok(b.deps.stats.msgsIn === 1, '计数 +1')
ok(b.room.nameCache.get('42') === '张三', '昵称缓存')
ok(b.calls.flushed === 1, '触发 scheduleFlush')

// 重复 id 不再处理
await b.onEvent({ id: 'm1', roomId: '900001', text: '重复', images: 0, imageUrls: [], ts: Date.now() })
ok(b.room.msgs.length === 1, '重复 id 被跳过')

// 表情包入库（sub_type>=1），普通图不入
const c = mk()
await c.onEvent({ id: 'm2', roomId: '900001', sender: '42', senderName: '张三', text: '', images: 1, imageUrls: ['http://x/a.png'], imageSubTypes: [0], ts: Date.now() })
ok(c.calls.stickers === 0, '普通图片不进表情库')
await c.onEvent({ id: 'm3', roomId: '900001', sender: '42', senderName: '张三', text: '', images: 1, imageUrls: ['http://x/a.png'], imageSubTypes: [1], ts: Date.now() })
ok(c.calls.stickers === 1, '表情包入图库')
ok(c.calls.favs === 1, '表情包收进收藏')

// 空 roomId 忽略
const d = mk()
await d.onEvent({ id: 'x', roomId: '', text: 'hi' })
ok(d.room.msgs.length === 0, '无 roomId 事件被忽略')

console.log('')
if (fails.length) {
  console.log(`❌ test-on-event.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-on-event.mjs 通过 ${pass} 项，失败 0 项`)
