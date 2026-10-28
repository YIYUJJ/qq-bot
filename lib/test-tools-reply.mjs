/** tools-reply.mjs 回归测试：say（白名单/演练/重发队列）与 ask（生成+发送）。 运行：node lib/test-tools-reply.mjs */
import { replyTools } from './tools-reply.mjs'

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

const rooms = new Map([['900001', { roomId: '900001', roomName: '测试群', msgs: [{ text: '最近一句' }], lastReplyAt: 0 }]])
const sent = []
const stats = { sends: 0 }
const cfg = { dryRun: false, contextMessages: 5 }

const mk = (over = {}) =>
  replyTools({
    assertGroupAllowed: (id) => {
      if (id !== '900001') throw new Error('不在白名单')
    },
    roomState: (id) => rooms.get(id) || { roomId: id, msgs: [] },
    config: cfg,
    sendWithRetry: async (...args) => {
      sent.push(args)
      return { queued: false }
    },
    stats,
    buildSearchNote: async () => null,
    buildTranscript: () => '（上下文）',
    generate: async () => ({ text: '生成的话', firstTokenMs: 120, usage: { inputTokens: 10, outputTokens: 5 } }),
    systemPrompt: () => '人设',
    sendReply: async (r, opts) => {
      sent.push(['reply', r.roomId, opts])
      return ['生成的话']
    },
    log: () => {},
    textOut: (t) => t,
    ...over,
  })

const [say, ask] = mk()

// say 正常
const s1 = await say.execute({ room: 'group:900001', text: '你好' })
ok(s1.includes('已发送到 900001') && stats.sends === 1, 'say 发送并计数')
ok(rooms.get('900001').lastReplyAt > 0, 'say 更新 lastReplyAt')

// say 空文本
let threw = false
try {
  await say.execute({ room: '900001', text: '  ' })
} catch {
  threw = true
}
ok(threw, 'say 空文本抛错')

// say 非白名单
threw = false
try {
  await say.execute({ room: '9999999999', text: 'hi' })
} catch {
  threw = true
}
ok(threw, 'say 非白名单抛错')

// say 演练
const [sayDry] = mk({ config: { ...cfg, dryRun: true } })
ok((await sayDry.execute({ room: '900001', text: 'hi' })).includes('[演练]'), 'say 演练不发送')

// say 重发队列
const [sayQueued] = mk({ sendWithRetry: async () => ({ queued: true, error: 'net down' }) })
ok((await sayQueued.execute({ room: '900001', text: 'hi' })).includes('重发队列'), 'say 入队提示')

// ask：使用 prompt
const a1 = await ask.execute({ room: '900001', prompt: '在吗' })
ok(a1.includes('首字 120ms') && a1.includes('已发：生成的话'), 'ask 返回耗时与发送内容')

// ask：不传 prompt 用最近消息
sent.length = 0
await ask.execute({ room: '900001' })
ok(sent.length === 1, 'ask 使用最近一条消息')

// ask：带 @
sent.length = 0
await ask.execute({ room: '900001', prompt: 'hi', at: '42' })
const replyCall = sent.find((x) => x[0] === 'reply')
ok(replyCall && replyCall[2].atUser === '42', 'ask 传递 at 参数')

// ask：联网结果进入提示词
let captured = ''
const [, askSearch] = mk({
  buildSearchNote: async () => ({ text: '结果内容', query: '天气', count: 3, ms: 50 }),
  generate: async (opts) => {
    captured = opts.user
    return { text: '转述结果', firstTokenMs: 100, usage: null }
  },
})
const a2 = await askSearch.execute({ room: '900001', prompt: '天气如何' })
ok(captured.includes('结果内容') && a2.includes('联网 3 条'), 'ask 把联网结果交给模型')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-reply.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-reply.mjs 通过 ${pass} 项，失败 0 项`)
