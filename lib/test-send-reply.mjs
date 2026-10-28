/** send-reply.mjs 回归测试：白名单、分条、重试队列、补图。 运行：node lib/test-send-reply.mjs */
import { CREATESENDREPLY_DEPS, createSendReply } from './send-reply.mjs'

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
  createSendReply({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(CREATESENDREPLY_DEPS.length >= 12, '依赖清单（' + CREATESENDREPLY_DEPS.length + ' 项）')

function build(over = {}) {
  const sent = []
  const deps = {
    assertGroupAllowed: () => {},
    cfgFor: () => ({ maxLines: 2, splitChance: 0, delayScale: 0, stickerChance: 0, humanize: false, maxReplyChars: 300 }),
    config: { allowPrivate: [], adminQQ: [], dryRun: false },
    enqueueSend: async () => ({ queued: false }),
    log: () => {},
    maybeSendSticker: async () => false,
    metrics: { inc: () => {}, observe: () => {}, event: () => {} },
    normText: (t) => String(t).trim(),
    ob: {
      async sendGroup(groupId, text) {
        sent.push(['group', groupId, text])
        return { message_id: sent.length, data: { message_id: sent.length } }
      },
      async sendGroupSegments(groupId, segs) {
        sent.push(['segs', groupId, segs])
        return { message_id: sent.length, data: { message_id: sent.length } }
      },
      async sendPrivate(userId, text) {
        sent.push(['private', userId, text])
        return { message_id: sent.length, data: { message_id: sent.length } }
      },
    },
    sleep: async () => {},
    stats: { sends: 0 },
    cleanReply: (t) => String(t || '').trim(),
    gapMs: () => 0,
    shouldRetrySend: () => false,
    splitMessage: (t, n) => [t],
    ...over,
  }
  return { sendReply: createSendReply(deps), sent, deps }
}

const r = { roomId: '900001', isGroup: true, roomName: '测试群', lineTarget: 1, replyCharsCap: 0, lastStickerAt: 0, lastReplyAt: 0, replyTimes: [], repliedTexts: [] }
const a = build()
const out = await a.sendReply(r, { text: '你好', quoteTo: '', priority: 'at' })
ok(Array.isArray(out) && out.length >= 1, '返回已发送内容数组')
ok(a.sent.length >= 1, '确实调用了发送')
ok(a.deps.stats.sends >= 1, '发送计数 +1')
ok(r.lastReplyAt > 0, '更新 lastReplyAt')

// 非白名单私聊
const b = build()
let threw2 = false
try {
  await b.sendReply({ roomId: '123456', isGroup: false, roomName: '', lineTarget: 1, replyTimes: [], repliedTexts: [] }, { text: 'hi', priority: 'at' })
} catch {
  threw2 = true
}
ok(threw2, '私聊不在白名单抛错')

// 重试队列
const c = build({ ob: { async sendGroup() { throw new Error('ECONNRESET') }, async sendGroupSegments() { throw new Error('ECONNRESET') }, async sendPrivate() { throw new Error('ECONNRESET') } }, shouldRetrySend: () => true, enqueueSend: async () => ({ queued: true, error: 'ECONNRESET' }) })
const out2 = await c.sendReply({ roomId: '900001', isGroup: true, roomName: 'x', lineTarget: 1, lastReplyAt: 0, replyTimes: [], repliedTexts: [] }, { text: 'hi', priority: 'at' })
ok(Array.isArray(out2), '发送失败时仍返回数组（不抛错）')

// 空文本：不发
const d = build()
const out3 = await d.sendReply({ roomId: '900001', isGroup: true, roomName: 'x', lineTarget: 1, lastReplyAt: 0 }, { text: '   ', priority: 'at' })
ok(d.sent.length === 0, '空文本不发送')

console.log('')
if (fails.length) {
  console.log(`❌ test-send-reply.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-send-reply.mjs 通过 ${pass} 项，失败 0 项`)
