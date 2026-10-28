/**
process.exit(0)

// 图库：普通图片（sub_type=0）不能进表情库；真表情（sub_type=1）才收
const stickerFile = join(home, 'qq-bot', 'stickers.json')
const countStickers = () => {
  try {
    return Object.keys(JSON.parse(readFileSync(stickerFile, 'utf8'))).length
  } catch {
    return 0
  }
}
const before = countStickers()
fakeOb.emit({ id: 'it-img-0', roomId: '900001', isGroup: true, sender: '44', senderName: '拍照的', text: '', isAtMe: false, images: 1, imageUrls: ['http://fake/photo.jpg'], imageSubTypes: [0], isSelf: false, ts: Date.now() })
await new Promise((r) => setTimeout(r, 200))
ok(countStickers() === before, '普通图片不进表情库')
fakeOb.emit({ id: 'it-img-1', roomId: '900001', isGroup: true, sender: '44', senderName: '发表情的', text: '', isAtMe: false, images: 1, imageUrls: ['http://fake/meme.jpg'], imageSubTypes: [1], isSelf: false, ts: Date.now() })
await new Promise((r) => setTimeout(r, 300))
ok(countStickers() > before, '真表情包会收进图库')
/**
 * 集成测试：真实 apply() + 假 OneBot + 假 LLM。
 * 验证「收到 @ 消息 → 调模型 → 发回复」整条链路，不依赖 SnowLuma / 模型厂商。
 *
 * 运行：node lib/test-integration.mjs
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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

const home = mkdtempSync(join(tmpdir(), 'qqbot-it-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'qq-bot'), { recursive: true })
writeFileSync(
  join(home, 'qq-bot', 'config.json'),
  JSON.stringify(
    {
      enabled: true,
      snowlumaHome: join(home, 'snowluma-empty'),
      provider: 'fake',
      model: 'fake-model',
      allowGroups: ['900001', '900002'],
      allowPrivate: [],
      adminQQ: [],
      memoryRooms: ['900001', '900002'],
      pushEnabled: false,
      pollMs: 0,
      replyProbability: 1,
      debounceMs: 50,
      minReplyGapMs: 0,
      stickerChance: 0,
      useDbMembers: false,
      humanize: false,
      lengthSpread: false,
      voiceReply: false,
      webSearch: false,
      visionOnImage: true,
      visionProvider: 'fake',
      visionModel: 'fake-model',
      visionWaitMs: 2500,
      videoOnMessage: false,
    },
    null,
    2,
  ),
  'utf8',
)

// 每群覆盖：900002 关掉自动回复（插件启动时读取，所以要写在前边）
writeFileSync(
  join(home, 'qq-bot', 'rooms.json'),
  JSON.stringify({ '900002': { replyProbability: 0, alwaysReply: false } }),
  'utf8',
)

const sent = []
const handlers = []
const fakeOb = {
  status: { connected: true, wsUrl: 'ws://fake', httpUrl: 'http://fake', reconnects: 0, self: { user_id: 1, nickname: '测试bot' } },
  onEvent(cb) {
    handlers.push(cb)
  },
  emit(ev) {
    for (const cb of handlers) cb(ev)
  },
  async start() {
    return { ok: true, http: { url: 'http://fake' }, ws: { url: 'ws://fake' }, self: { user_id: 1, nickname: '测试bot' } }
  },
  stop() {},
  async call() {
    return { status: 'ok', data: [] }
  },
  async health() {
    return { ok: true, status: 'ok' }
  },
  async groups() {
    return []
  },
  async groupMembers() {
    return []
  },
  async groupMember() {
    return null
  },
  async sendGroup(groupId, text) {
    sent.push({ kind: 'group', groupId, text })
    return { message_id: sent.length }
  },
  async sendPrivate(userId, text) {
    sent.push({ kind: 'private', userId, text })
    return { message_id: sent.length }
  },
  async sendGroupSegments(groupId, segments) {
    sent.push({ kind: 'groupSeg', groupId, text: segments.map((s) => s?.data?.text || '').join('') })
    return { message_id: sent.length }
  },
  async sendPoke() {
    return { ok: true }
  },
  async sendGroupReply(groupId, messageId, text) {
    sent.push({ kind: 'reply', groupId, text })
    return { message_id: sent.length }
  },
}

const visionRequests = []
const llm = {
  async *stream(opts) {
    const hasImage = (opts?.messages || []).some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === 'image'))
    if (hasImage) {
      visionRequests.push(opts)
      yield { type: 'text-delta', text: '一张纯白色的测试图' }
      yield { type: 'finish', reason: 'stop' }
      return
    }
    yield { type: 'text-delta', text: '在的' }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }
    yield { type: 'finish', reason: 'stop' }
  },
  listProviders: () => [{ id: 'fake' }],
  listModels: async () => [{ id: 'fake-model' }],
}

const registered = []
const fakeCtx = {
  effect(fn) {
    const d = fn()
    return typeof d === 'function' ? d : () => {}
  },
  get(name) {
    if (name === 'llm') return llm
    if (name === 'attachments') return { saveImages: async (arr) => arr.map((a, i) => ({ id: 'att-' + i, mediaType: a.mediaType })) }
    return null
  },
  llm,
  tools: { register: (t) => registered.push(t) },
  logger: console,
}

const mod = await import('./index.js')
let dispose = null
try {
  dispose = mod.apply(fakeCtx, { __test: { onebot: fakeOb, llm } })
} catch (e) {
  ok(false, 'apply 不抛错：' + (e?.message || e))
}
ok(registered.length > 20, '工具注册成功（' + registered.length + ' 个）')

// 等 start() 完成、基线建立
await new Promise((r) => setTimeout(r, 300))
ok(handlers.length === 1, '插件订阅了消息事件')

// 注入一条 @ 消息
fakeOb.emit({
  id: 'it-msg-1',
  roomId: '900001',
  isGroup: true,
  sender: '42',
  senderName: '测试用户',
  text: '@测试bot 在吗',
  isAtMe: true,
  images: 0,
  imageUrls: [],
  isSelf: false,
  ts: Date.now(),
})

// 等回复（最多 4 秒）
const deadline = Date.now() + 4000
while (Date.now() < deadline && !sent.length) await new Promise((r) => setTimeout(r, 50))
ok(sent.length > 0, '收到消息后发送了回复')
if (sent.length) {
  const text = sent.map((s) => s.text || '').join(' ')
  ok(/在的/.test(text), '回复内容来自模型输出（' + JSON.stringify(text).slice(0, 60) + '）')
  ok(String(sent[0].groupId) === '900001', '发到了正确的群')
}

// 白名单外：不应该有回复
sent.length = 0
fakeOb.emit({
  id: 'it-msg-2',
  roomId: '999999',
  isGroup: true,
  sender: '43',
  senderName: '路人',
  text: '@测试bot 你好',
  isAtMe: true,
  images: 0,
  imageUrls: [],
  isSelf: false,
  ts: Date.now(),
})
await new Promise((r) => setTimeout(r, 300))
ok(sent.length === 0, '白名单外的群不回复')

// 图库：普通图片（sub_type=0）不能进表情库；真表情（sub_type=1）才收
const stickerFile = join(home, 'qq-bot', 'stickers.json')
const countStickers = () => {
  try {
    return Object.keys(JSON.parse(readFileSync(stickerFile, 'utf8'))).length
  } catch {
    return 0
  }
}
const before = countStickers()
fakeOb.emit({
  id: 'it-img-0', roomId: '900001', isGroup: true, sender: '44', senderName: '拍照的',
  text: '', isAtMe: false, images: 1, imageUrls: ['http://fake/photo.jpg'], imageSubTypes: [0],
  isSelf: false, ts: Date.now(),
})
await new Promise((r) => setTimeout(r, 250))
ok(countStickers() === before, '普通图片不进表情库')

fakeOb.emit({
  id: 'it-img-1', roomId: '900001', isGroup: true, sender: '44', senderName: '发表情的',
  text: '', isAtMe: false, images: 1, imageUrls: ['http://fake/meme.jpg'], imageSubTypes: [1],
  isSelf: false, ts: Date.now(),
})
await new Promise((r) => setTimeout(r, 3600))
ok(countStickers() > before, '真表情包会收进图库')

// 每群覆盖：config 里给 900002 预置了 replyProbability=0 + alwaysReply=false → 不回复
sent.length = 0
fakeOb.emit({
  id: 'it-msg-3', roomId: '900002', isGroup: true, sender: '45', senderName: '路人乙',
  text: '随便聊聊', isAtMe: false, images: 0, imageUrls: [], isSelf: false, ts: Date.now(),
})
await new Promise((r) => setTimeout(r, 400))
ok(sent.length === 0 || !((sent[0] || {}).text || '').includes('在的'), '每群覆盖生效（关闭后不回复）')

// 提醒：一句话建提醒 → 落到 reminders.json（走真实解析路径）
sent.length = 0
fakeOb.emit({
  id: 'it-remind-1', roomId: '900001', isGroup: true, sender: '47', senderName: '要提醒的',
  text: '提醒我 3 分钟后 喝水', isAtMe: true, images: 0, imageUrls: [], isSelf: false, ts: Date.now(),
})
await new Promise((r) => setTimeout(r, 600))
const remindersFile = join(home, 'qq-bot', 'reminders.json')
let reminders = []
try {
  reminders = JSON.parse(readFileSync(remindersFile, 'utf8'))
} catch {
  reminders = []
}
ok(Array.isArray(reminders) && reminders.length === 1, '提醒被写入 reminders.json')
if (reminders.length) {
  ok(String(reminders[0].text || '').includes('喝水'), '提醒内容正确：' + JSON.stringify(reminders[0].text).slice(0, 40))
  ok(Number(reminders[0].at) > Date.now(), '提醒时间在未来')
}

// 拍一拍：notice 事件走 handleNotice（不应抛错，且会拍回去）
const pokes = []
fakeOb.sendPoke = async (p) => {
  pokes.push(p)
  return { ok: true }
}
fakeOb.emit({
  id: 'it-poke-1', roomId: '900001', isGroup: true, sender: '48', senderName: '爱拍的',
  text: '', isAtMe: false, images: 0, imageUrls: [], isSelf: false, ts: Date.now(),
  notice: { notice_type: 'notify', sub_type: 'poke', user_id: '48', target_id: '1', group_id: '900001' },
})
await new Promise((r) => setTimeout(r, 400))
ok(pokes.length > 0, '被拍一拍会拍回去（handleNotice 正常执行）')

// 识图链路：本地图床 + 假 attachments + 假视觉模型 → 图片确实进了模型请求
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const imgServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'image/png' })
  res.end(pngBytes)
})
await new Promise((resolve) => imgServer.listen(0, '127.0.0.1', resolve))
const imgPort = imgServer.address().port
sent.length = 0
fakeOb.emit({
  id: 'it-img-vision', roomId: '900001', isGroup: true, sender: '46', senderName: '发图的',
  text: '看看这张图', isAtMe: true, images: 1, imageUrls: [`http://127.0.0.1:${imgPort}/a.png`],
  imageSubTypes: [0], isSelf: false, ts: Date.now(),
})
await new Promise((r) => setTimeout(r, 2500))
ok(visionRequests.length > 0, '识图请求发给了视觉模型（含 image 内容）')
if (visionRequests.length) {
  const content = visionRequests[0].messages[0].content
  ok(content.some((c) => c.type === 'image' && c.attachment?.id), '视觉请求里带附件引用')
}
imgServer.close()

try {
  dispose?.()
} catch {
  /* ignore */
}
try {
  rmSync(home, { recursive: true, force: true })
} catch {
  /* ignore */
}

console.log('')
if (fails.length) {
  console.log(`❌ test-integration.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-integration.mjs 通过 ${pass} 项，失败 0 项`)
process.exit(0)
