/**
 * "语义检索每次都用上"的四处修改：回归测试（用假向量模型，不下载真模型）。
 *   1. 启动预热：加载模型 + 补齐记忆向量；改语义设置会重新预热
 *   2. 记忆一写入就补向量；同一会话建索引串行、不重复算
 *   3. 主动说话 / 跟进 / 管理员遥控 / 面板生成 都先按当前话题算查询向量
 *   4. 翻旧账（长期记忆 + 聊天原文）按意思找
 * 运行：node lib/test-semantic-everywhere.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createEmbedder } from './embed.mjs'
import { createMemoryStore } from './memory-store.mjs'
import { createMemPlus } from './memory-plus.mjs'
import { createMemoryAi, CREATEMEMORYAI_DEPS } from './memory-ai.mjs'
import { openChatLog } from './chat-log.mjs'
import { readArchive, writeTextSafe, summaryPath } from './memory.mjs'
import { createScheduler } from './scheduler.mjs'
import { createAdminFlow } from './admin-flow.mjs'
import { createConfigStore, SEMANTIC_KEYS } from './config-store.mjs'
import { DEFAULT_CONFIG, BOOLEAN, NUMERIC, LIST, CONFIG_META, validateConfig } from './schema.mjs'

let pass = 0
const fails = []
const ok = (c, n) => {
  if (c) { pass += 1; console.log('  PASS  ' + n) } else { fails.push(n); console.log('  FAIL  ' + n) }
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))

/* ── 假向量模型：同一概念组的词得到相近的向量 ── */
const GROUPS = [['猫', '喵', '布偶'], ['驾照', '科目', '倒车'], ['火锅', '辣'], ['生日', '蛋糕'], ['减肥', '撸串', '瘦']]
function fakeVec(text) {
  const v = GROUPS.map((g) => (g.some((w) => text.includes(w)) ? 1 : 0))
  v.push(0.15)
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return v.map((x) => x / n)
}
const counters = { loads: 0, embeds: 0, disposed: 0 }
const fakeTransformers = {
  env: {},
  pipeline: async () => {
    counters.loads += 1
    const pipe = async (texts) => {
      counters.embeds += texts.length
      return { tolist: () => texts.map(fakeVec) }
    }
    pipe.tokenizer = {}
    pipe.dispose = async () => { counters.disposed += 1 }
    return pipe
  },
}
const importer = (m) => (m === '@huggingface/transformers' ? Promise.resolve(fakeTransformers) : import(m))

const tmp = mkdtempSync(join(tmpdir(), 'qqbot-semall-'))
let db = null
try {
  const config = {
    memoryRooms: ['9'], allowGroups: ['9'], allowPrivate: [], adminQQ: [], enabled: true,
    semanticSearch: true, semanticModel: 'Xenova/bge-base-zh-v1.5', semanticThreads: 2, keywordBonus: 0,
    chatLogEnabled: true, restoreContext: 0, memoryReinforce: false, factsKeep: 150,
  }
  const rooms = new Map()
  const store = createMemoryStore({ config, rooms, groupNames: new Map(), facts: {}, memoryDir: join(tmp, 'mem'), log: () => {}, keywordsOf: () => [] })
  const emb = createEmbedder({ config, log: () => {}, memDirOf: store.memDirOf, dataDir: tmp, importer })
  db = await openChatLog(join(tmp, 'chatlog.db'))

  /* ── 1. 向量模型：懒加载、换线程数要重载、建索引串行不重复 ── */
  ok(!emb.isReady(), '没加载前 isReady=false')
  ok((await emb.queryVec('猫')) === null && (await tick(), counters.loads === 1), '没加载时查询返回 null，并在后台触发加载')
  await emb.ensure()
  ok(emb.isReady() && counters.loads === 1, '加载一次就好')
  config.semanticThreads = 4
  ok(!emb.isReady(), '改了线程数：需要重新加载')
  await emb.ensure()
  ok(counters.loads === 2 && counters.disposed === 1, '重新加载并释放旧模型')

  /* ── 2. 写入钩子 ── */
  const changed = []
  store.setOnChange((rid) => changed.push(rid))
  const f1 = store.addFact('9', '小王养了一只橘猫')
  store.updateFact('9', f1.id, { text: '小王养了一只橘猫，叫橘子' })
  store.deleteFactById('9', store.addFact('9', '临时记一下').id)
  ok(changed.length === 4 && changed.every((x) => x === '9'), '增 / 改 / 删 都会通知写入钩子')

  // 并发建索引不重复算
  const before = counters.embeds
  const texts = ['甲甲甲', '乙乙乙', '丙丙丙']
  await Promise.all([emb.indexTexts('9', texts), emb.indexTexts('9', texts)])
  ok(counters.embeds - before === 3, '同一会话并发建索引：每条只算一次')

  /* ── 3. memory-plus：预热 / 写入即补 / 按话题算查询向量 ── */
  const room = { roomId: '9', roomName: '测试群', isGroup: true, msgs: [], seen: new Set(), lastActivityAt: 0 }
  rooms.set('9', room)
  const mp = createMemPlus({
    config, cfgFor: () => ({ personCards: false, dailySummaryDays: 0, followUp: false, archiveSearch: true }), log: () => {},
    generate: async () => ({ text: '嗯' }), memDirOf: store.memDirOf, isManagedRoom: store.isManagedRoom, factsOf: store.factsOf,
    factsAbout: store.factsAbout, dueFacts: store.dueFacts, markFollowed: store.markFollowed, rooms, allowedHere: () => true,
    sendReply: async () => [], isQuiet: () => false, quietWindowsFor: () => [], systemPrompt: () => 'SYS',
    buildTranscript: () => '', humanizeText: (t) => t, getChatLog: () => db, getEmbedder: () => emb,
  })
  store.setOnChange((rid) => mp.onFactsChanged(rid))
  store.setSemanticScorer((rid, t) => emb.scores(rid, rooms.get(String(rid))?.semVec || null, t))
  store.addFact('9', '小美下周三要考科目二')
  store.addFact('9', '老王特别能吃辣')
  store.addFact('9', '阿琳的生日是三月十二号')
  writeTextSafe(summaryPath(store.memDirOf('9')), '大家聊了火锅\n阿杰说要减肥')
  const w = await mp.warmUp()
  const st = mp.status('9').semantic
  ok(w.ok && st.memoryMissing === 0 && st.memoryTotal === mp.memoryTexts('9').length, '预热后全部记忆（事实 + 归档 + 摘要）都有向量')
  ok(mp.memoryTexts('9').some((t) => t === '阿杰说要减肥') && readArchive(store.memDirOf('9')).length > 0, '记忆文本包含摘要行和归档')

  store.addFact('9', '小周养了一只布偶')
  await tick(30)
  ok(emb.missingCount('9', mp.memoryTexts('9')) === 0, '新记忆一写入就补好向量')

  room.msgs.push({ text: '今晚吃啥', isSelf: false, sender: '1' })
  await mp.prepareSemantic(room, '那只喵最近胖了没')
  const want = await emb.queryVec('那只喵最近胖了没')
  ok(JSON.stringify(room.semVec) === JSON.stringify(want), '给了话题就按话题算查询向量（不是最近的聊天）')
  const picked = store.pickFacts(room, 1)
  ok(picked.length === 1 && /猫|布偶/.test(picked[0].text), '挑记忆按语义：问"喵"挑到猫的记忆')
  await mp.prepareSemantic(room)
  ok(JSON.stringify(room.semVec) === JSON.stringify(await emb.queryVec('今晚吃啥')), '不给话题时用最近的聊天')

  // 模型没好：不等，触发预热
  config.semanticThreads = 3
  const r2 = { roomId: '9', msgs: [] }
  await mp.prepareSemantic(r2, '猫')
  ok(r2.semVec === null, '模型没好时这次先不用语义（不拖慢回复）')
  await tick(30)
  ok(emb.isReady(), '同时在后台把模型重新加载好了')

  /* ── 4. 翻旧账按意思找 ── */
  const old = Date.now() - 86400000
  const msgs = [
    { id: 'a1', ts: old, sender: '1', senderName: '小王', text: '我家橘猫今天又拆家了' },
    { id: 'a2', ts: old + 1, sender: '2', senderName: '老王', text: '晚上去吃重庆火锅吧' },
    { id: 'a3', ts: old + 2, sender: '3', senderName: '小美', text: '倒车入库终于过了' },
  ]
  for (const m of msgs) mp.archiveMsg(room, m)
  await mp.kickBackfill()
  ok(db.vecCount('9', emb.modelName()) === 3, '聊天原文在后台补好了向量')
  const qv = await emb.queryVec('那只喵后来怎么样')
  const sem = mp.searchArchive('9', '那只喵后来怎么样', 2, { vec: qv })
  ok(sem.length >= 1 && sem[0].text.includes('橘猫') && sem[0].by === '语义', '原文：换个说法（喵↔猫）也能翻到')
  ok(mp.searchArchive('9', '那只喵后来怎么样', 2, { vec: null }).every((h) => !h.text.includes('橘猫')), '对照：只靠关键词翻不到')
  db.updateText('9', { id: 'a2', text: '晚上去吃重庆火锅吧[图片：一锅红油]' })
  ok(db.vecCount('9', emb.modelName()) === 2, '原文改了（补上识图描述）旧向量作废')
  await mp.kickBackfill()
  ok(db.vecCount('9', emb.modelName()) === 3, '后台重新补上')

  // 长期记忆翻旧账
  const aiDeps = Object.fromEntries(CREATEMEMORYAI_DEPS.map((k) => [k, () => {}]))
  Object.assign(aiDeps, { isManagedRoom: store.isManagedRoom, memDirOf: store.memDirOf, factsOf: store.factsOf, readArchive, roomTextOf: store.roomTextOf, config })
  const ai = createMemoryAi(aiDeps)
  const rv = await mp.queryVecFor('驾照的事咋样了')
  const hits = ai.searchMemory('9', '驾照的事咋样了', 2, { semScore: (t) => mp.semScores('9', rv, t) })
  ok(hits.length >= 1 && hits[0].text.includes('科目二'), '长期记忆：按意思翻到（驾照↔科目二）')
  const kw = ai.searchMemory('9', '驾照的事咋样了', 2)
  ok(!kw.some((h) => h.text.includes('科目二')), '对照：只靠关键词翻不到')
  const mixed = ai.searchMemory('9', '老王', 3, { semScore: (t) => mp.semScores('9', rv, t) })
  ok(mixed.some((h) => h.text.includes('老王')), '语义结果不够时用关键词补')

  /* ── 3b. 其它用到记忆的地方都先准备查询向量 ── */
  const order = []
  const sch = createScheduler({
    config: { enabled: true, pollMs: 0, allowGroups: ['9'] }, rooms: new Map([['9', { roomId: '9', msgs: [], replyTimes: [], lastActivityAt: 1, lastProactiveAt: 0, flushing: false }]]),
    cfgFor: () => ({ proactive: true, proactiveChance: 1, proactiveIdleMs: 0, proactiveMinGapMs: 0, proactiveHours: '00:00-23:59', maxRepliesPer10Min: 200, quietHours: '', humanize: false }),
    allowedHere: () => true, isQuiet: () => false, quietWindowsFor: () => [],
    generate: async () => { order.push('generate'); return { text: '冒个泡' } }, systemPrompt: () => 'SYS', buildTranscript: () => '',
    humanizeText: (t) => t, sendReply: async () => ['x'], log: () => {}, safeTick: (n, f) => f, timers: { add() {}, delete() {} },
    pollOnce: () => {}, privateTargets: () => [],
    prepareMemory: async () => { order.push('prepare') },
  })
  sch.proactiveTick()
  await tick(30)
  ok(order.join(',') === 'prepare,generate', '主动说话：先准备查询向量再生成')

  const adminCalls = []
  const af = createAdminFlow({
    ob: { sendPrivate: async () => {}, sendGroupSegments: async () => {} }, config: { adminComposeTokens: 100 }, log: () => {},
    generate: async () => ({ text: '晚饭吃火锅吧' }), systemPrompt: () => 'SYS', roomState: (id) => ({ roomId: id, msgs: [] }),
    setRoomOverride: () => ({}), roomOverrides: {}, sendWithRetry: async () => ({ queued: false }), parseAdminCommand: () => null,
    describeAdminAction: () => '', normalizePlannedActions: (l) => l, metrics: { inc() {}, observe() {}, event() {} }, stats: {},
    sleep: async () => {}, isAllowedGroup: () => true, groupNames: new Map(),
    prepareMemory: async (r, q) => adminCalls.push(q),
  })
  await af.executeAdminAction({ action: 'compose', target: { roomId: '9', name: '测试群' }, instruction: '问问大家晚饭吃啥' })
  ok(adminCalls[0] === '问问大家晚饭吃啥', '管理员遥控：按指令内容准备查询向量')

  /* ── 1b. 改语义设置会重新预热 ── */
  const hookCalls = []
  const cs = createConfigStore({
    file: join(tmp, 'config.json'), defaults: DEFAULT_CONFIG, validateConfig, keys: Object.keys(DEFAULT_CONFIG),
    booleanSet: BOOLEAN, numericSet: NUMERIC, listSet: LIST, meta: CONFIG_META, log: () => {},
    hooks: { onSemanticChanged: () => hookCalls.push('semantic') },
  })
  cs.load({})
  cs.applyConfigPatch({ replyProbability: 0.3 })
  ok(hookCalls.length === 0, '改别的设置不会重新预热')
  cs.applyConfigPatch({ semanticModel: 'Xenova/bge-base-zh-v1.5' })
  ok(hookCalls.length === 1, '改向量模型会重新预热')
  ok(SEMANTIC_KEYS.includes('semanticThreads') && SEMANTIC_KEYS.includes('semanticSearch'), '开关 / 线程数 / 下载源都算语义设置')
} finally {
  db?.close()
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* Windows 上 sqlite 句柄可能晚一点释放 */ }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-semantic-everywhere.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-semantic-everywhere.mjs 通过 ${pass} 项，失败 0 项`)
