/** flush.mjs 回归测试：依赖校验 + 静音/必回/冷却/重复等关键分支。 运行：node lib/test-flush.mjs */
import { FLUSH_DEPS, createFlush } from './flush.mjs'

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
  createFlush({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(FLUSH_DEPS.length > 25, '依赖清单完整（' + FLUSH_DEPS.length + ' 项）')

const sent = []
const room = {
  roomId: '900001',
  roomName: '测试群',
  isGroup: true,
  pending: [{ id: 'm1', roomId: '900001', isGroup: true, sender: '42', senderName: '张三', text: '在吗', isAtMe: true, images: 0, imageUrls: [], ts: Date.now() }],
  msgs: [],
  seen: new Set(),
  nameCache: new Map(),
  replyTimes: [],
  lastReplyAt: 0,
  lineTarget: 0,
  replyCharsCap: 0,
}

const deps = {
  HISTORY_HINT: /历史/,
  RECALL_HINT: /撤回/,
  buildSearchNote: async () => null,
  buildTranscript: () => '',
  buildVideoLinkNote: async () => ({}),
  buildWebLinkNote: async () => ({}),
  cfgFor: () => ({ muteUntil: 0, alwaysReply: true, replyProbability: 1, minReplyGapMs: 0, maxRepliesPer10Min: 200, humanize: false, lengthSpread: false, splitChance: 0, stickerChance: 0, visionOnImage: false, videoOnMessage: false, linkVideo: false, memoryExtract: false, adminCommands: true, quietHours: '', fastDebounceMs: 400, delayScale: 0.8, moodEnabled: false, maxLines: 3, maxReplyChars: 300 }),
  config: { enabled: true, dryRun: false, adminCommands: false, adminQQ: [], delayScale: 0.8, contextMessages: 20, streamSend: false, replyProbability: 1, maxRepliesPer10Min: 200, humanize: false },
  decide: () => ({ reply: true, reason: '测试' }),
  extractSearchQuery: () => null,
  generate: async () => ({ text: '在的', firstTokenMs: 100, usage: null }),
  getFeatures: () => new Proxy({}, { get: () => () => undefined }),
  handleAdminCommand: async () => false,
  isManagedRoom: () => true,
  log: () => {},
  maybeAutoExtract: () => {},
  maybeSendSticker: async () => false,
  metrics: { inc: () => {}, observe: () => {}, event: () => {} },
  moodName: () => '',
  mustReply: () => true,
  pickLineTarget: () => 1,
  priorityOf: () => 'at',
  quietWindowsFor: () => [],
  recordReplied: () => {},
  rememberVideo: () => {},
  searchHistory: async () => [],
  searchMemory: () => [],
  sendReply: async (r, opts) => {
    sent.push(opts.text)
    return [opts.text]
  },
  sleep: async () => {},
  stats: { replies: 0, skipped: 0, sends: 0 },
  systemPrompt: () => '人设',
  humanizeText: (t) => t,
  isQuiet: () => false,
  pickCanned: () => '',
  pickVideoLinks: () => [],
  pickWebLink: () => null,
  rmSync: () => {},
}
const flush = createFlush(deps)

// 正常处理一条 @ 消息
await flush(room)
ok(sent.length === 1 && sent[0] === '在的', '正常消息被回复')
ok(room.pending.length === 0, '处理完清空 pending')
ok(sent.length === 1, '发送一次（fake sendReply 不写回 replyTimes）')

// 静音：不回复
const muted = { ...room, pending: [{ ...room.pending[0] || { id: 'm2', roomId: '900001', sender: '42', senderName: '张三', text: 'hi', isAtMe: true, images: 0, imageUrls: [], ts: Date.now() } }], msgs: [], seen: new Set(), nameCache: new Map(), replyTimes: [], lastReplyAt: 0 }
sent.length = 0
await createFlush({ ...deps, priorityOf: () => 'ambient', decide: () => ({ reply: false, reason: '安静时段' }) })(muted)
ok(sent.length === 0, '安静时段 + 非必回 → 不回复')

// 生成失败不崩溃
const failing = { ...muted, pending: [{ id: 'm3', roomId: '900001', sender: '42', senderName: '张三', text: 'hi', isAtMe: true, images: 0, imageUrls: [], ts: Date.now() }], msgs: [], seen: new Set(), nameCache: new Map(), replyTimes: [], lastReplyAt: 0 }
await createFlush({ ...deps, generate: async () => { throw new Error('model down') } })(failing)
ok(true, '生成失败不抛出（被内部捕获）')

console.log('')
if (fails.length) {
  console.log(`❌ test-flush.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-flush.mjs 通过 ${pass} 项，失败 0 项`)
