/** 记忆增强回归测试：原文归档 / 增删改解析 / applyOps / 强化 / 跟进 / 人物卡 / 每日摘要 / 提示词。 运行：node lib/test-memory-plus.mjs */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openChatLog } from './chat-log.mjs'
import { parseOpLine } from './memory-ai.mjs'
import { createMemoryStore, freshness } from './memory-store.mjs'
import { createMemPlus, splitDue, addDays, localDay, inHours, MEMPLUS_DEPS } from './memory-plus.mjs'
import { cosine, normalizeSim } from './embed.mjs'

let pass = 0
const fails = []
const ok = (c, n) => {
  if (c) { pass += 1; console.log('  PASS  ' + n) } else { fails.push(n); console.log('  FAIL  ' + n) }
}

const tmp = mkdtempSync(join(tmpdir(), 'qqbot-mp-'))
let db = null
try {
  /* ── 原文归档 ── */
  db = await openChatLog(join(tmp, 'chatlog.db'))
  ok(!!db, 'node:sqlite 可用，归档已打开')
  if (db) {
    const t0 = Date.now() - 3 * 86400000
    ok(db.append('900001', { id: 'm1', ts: t0, sender: '42', senderName: '张三', text: '我下周三要考驾照科目二' }), '写入一条')
    ok(!db.append('900001', { id: 'm1', ts: t0, sender: '42', senderName: '张三', text: '我下周三要考驾照科目二' }), '同 id 重复写入被忽略')
    db.append('900001', { id: 'm2', ts: t0 + 1000, sender: '43', senderName: '李四', text: '今天中午吃了麻辣烫' })
    db.append('900001', { ts: t0 + 2000, sender: '42', senderName: '张三', text: '没有 id 的消息也能存' })
    db.append('900002', { id: 'x', ts: t0, sender: '9', text: '别的群的驾照话题' })
    ok(db.count('900001') === 3, '按会话计数')
    const hits = db.search('900001', '驾照考试')
    ok(hits.length === 1 && hits[0].text.includes('科目二'), 'FTS 检索命中且不串群')
    ok(db.search('900001', '麻辣').length === 1, '两个字的查询走 LIKE')
    const rec = db.recent('900001', 2)
    ok(rec.length === 2 && rec[1].ts > rec[0].ts && rec[0].restored, 'recent 按时间正序、带 restored 标记')
    ok(db.updateText('900001', { id: 'm2', text: '今天中午吃了麻辣烫[图片：一碗汤]' }), '按 id 更新原文')
    ok(db.search('900001', '一碗汤').length === 1, '更新后 FTS 同步')
    ok(db.range('900001', t0, t0 + 1500).length === 2, 'range 时间段')
    ok(db.stats().total === 4, 'stats 总数')
    ok(db.prune(1) === 4 && db.count('900001') === 0, 'prune 删掉过期原文')
  }

  /* ── 增删改解析 ── */
  const names = new Map([['42', '张三']])
  const idOf = new Map([[1, 'aaa'], [2, 'bbb']])
  const a = parseOpLine('ADD|42|5|2026-11-05|张三下周三考科目二', names, idOf)
  ok(a && a.op === 'ADD' && a.who === '42' && a.importance === 5 && a.due === '2026-11-05', 'ADD 解析 who/重要度/日期')
  ok(parseOpLine('ADD|999|3|-|李四喜欢猫', names, idOf).who === undefined, 'ADD 不采信没出现过的 QQ 号')
  const u = parseOpLine('- UPDATE|[2]|3|-|张三把考试改到周六', names, idOf)
  ok(u && u.op === 'UPDATE' && u.id === 'bbb' && u.due === '', 'UPDATE 解析编号（带列表前缀和方括号）')
  const d = parseOpLine('DELETE|1|他说不去了', names, idOf)
  ok(d && d.op === 'DELETE' && d.id === 'aaa' && d.reason === '他说不去了', 'DELETE 解析')
  ok(parseOpLine('DELETE|9|编号不存在', names, idOf) === null, '不存在的编号丢弃')
  ok(parseOpLine('无', names, idOf) === null && parseOpLine('随便一句话', names, idOf) === null, '不合格式的行丢弃')

  /* ── store：applyOps / 强化 / 跟进 ── */
  const facts = {}
  const config = { memoryRooms: ['900001'], allowGroups: ['900001'], memoryReinforce: true, memoryHalfLifeDays: 30, factsKeep: 150 }
  const rooms = new Map()
  const store = createMemoryStore({ config, rooms, groupNames: new Map(), facts, memoryDir: join(tmp, 'mem'), log: () => {}, keywordsOf: () => [] })
  const f1 = store.addFact('900001', '张三下周三考科目二', Date.now(), { who: '42', whoName: '张三', importance: 4, due: '2026-11-05' })
  ok(f1 && f1.id && f1.due === '2026-11-05', 'addFact 返回带 id 和 due 的事实')
  const res = store.applyOps('900001', [
    { op: 'UPDATE', id: f1.id, text: '张三把科目二改到周六', importance: 4, due: '2026-11-08' },
    { op: 'ADD', text: '李四喜欢吃麻辣烫', importance: 2 },
    { op: 'DELETE', id: 'nope' },
  ])
  ok(res.updated === 1 && res.added === 1 && res.skipped === 1, 'applyOps 计数正确')
  const now1 = store.factsOf('900001')
  const v2 = now1.find((x) => x.text === '张三把科目二改到周六')
  ok(v2 && v2.id !== f1.id && v2.chainId === f1.id && v2.prev === f1.id && v2.due === '2026-11-08' && !now1.some((x) => x.id === f1.id), 'UPDATE 生成新版本：新 id、接在同一条变化线上、改了日期')
  const lee = now1.find((x) => x.text.includes('李四'))
  ok(store.deleteFactById('900001', lee.id) && !store.factsOf('900001').some((x) => x.id === lee.id), '按 id 删除')
  ok(store.factsAbout('900001', '42').length === 1, 'factsAbout 按人取')
  const r0 = { roomId: '900001', msgs: [{ sender: '42', text: '科目二' }] }
  store.pickFacts(r0, 5)
  ok((store.factsOf('900001')[0].uses || 0) === 1, 'pickFacts 记一次使用')
  ok(store.flushUses() === 1, 'flushUses 落盘一个会话')
  ok(freshness({ importance: 2, at: Date.now() - 30 * 86400000 }, 30) < 0.51, '半衰期：30 天后新鲜度约 0.5')
  ok(freshness({ importance: 5, at: 1 }, 30) === 1, '重要度 ≥4 不衰减')
  ok(store.dueFacts('900001', '2026-11-08').length === 1 && store.dueFacts('900001', '2026-11-07').length === 0, 'dueFacts 按日期')

  /* ── 跟进日期划分 / 工具函数 ── */
  ok(addDays('2026-02-28', 1) === '2026-03-01' && localDay(new Date(2026, 0, 5)) === '2026-01-05', '日期加减')
  const sd = splitDue([{ id: 1, due: '2026-11-04' }, { id: 2, due: '2026-11-01' }, { id: 3, due: '2026-11-06' }, { id: 4, due: '2026-11-04', followedAt: 1 }], '2026-11-06')
  ok(sd.ready.map((x) => x.id).join() === '1' && sd.stale.map((x) => x.id).join() === '2', 'splitDue：昨天前 3 天内的问、太早的过期、今天的不问、问过的跳过')
  ok(inHours('10:00-22:00', new Date(2026, 0, 1, 12)) && !inHours('10:00-22:00', new Date(2026, 0, 1, 23)) && inHours('22:00-02:00', new Date(2026, 0, 1, 1)), 'inHours 含跨午夜')
  ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9 && normalizeSim(0.3, 0.3) === 0 && normalizeSim(1, 0.3) === 1 && normalizeSim(0.2, 0.3) < 0, '向量工具（基线 = 0，不截断）')

  /* ── memory-plus：人物卡 / 每日摘要 / 跟进 / 提示词 ── */
  let threw = ''
  try { createMemPlus({}) } catch (e) { threw = String(e.message) }
  ok(threw.includes('缺少依赖') && MEMPLUS_DEPS.includes('getChatLog'), '缺依赖抛错')

  const db2 = await openChatLog(join(tmp, 'chatlog2.db'))
  const room = { roomId: '900001', roomName: '测试群', isGroup: true, msgs: [], seen: new Set(), lastActivityAt: 0 }
  rooms.set('900001', room)
  const sent = []
  const gens = []
  const mp = createMemPlus({
    config: { ...config, chatLogEnabled: true, restoreContext: 50, personCardMinFacts: 1, dailySummary: true, dailySummaryHour: 0, followUpHours: '00:00-23:59', followUpMaxPerDay: 2, enabled: true },
    cfgFor: () => ({ personCards: true, personCardChars: 300, dailySummaryDays: 3, followUp: true, quietHours: '', humanize: false }),
    log: () => {},
    generate: async ({ user }) => { gens.push(user); return { text: user.includes('人物卡') ? '称呼/外号：小张\n喜欢：开车' : user.includes('摘要') ? '大家聊了驾照和午饭。' : '科目二考得咋样' } },
    memDirOf: store.memDirOf, isManagedRoom: store.isManagedRoom, factsOf: store.factsOf,
    factsAbout: store.factsAbout, dueFacts: store.dueFacts, markFollowed: store.markFollowed,
    rooms, allowedHere: () => true,
    sendReply: async (r, { text }) => { sent.push(text); return [text] },
    isQuiet: () => false, quietWindowsFor: () => [], systemPrompt: () => 'SYS', buildTranscript: () => '', humanizeText: (t) => t,
    getChatLog: () => db2,
    now: () => new Date(2026, 10, 9, 12).getTime(),
  })
  // 归档 + 装回
  mp.archiveMsg(room, { id: 'q1', ts: new Date(2026, 10, 8, 10).getTime(), sender: '42', senderName: '张三', text: '昨天聊的第一句' })
  for (let i = 0; i < 6; i++) mp.archiveMsg(room, { id: 'q' + (i + 2), ts: new Date(2026, 10, 8, 11, i).getTime(), sender: '42', senderName: '张三', text: '昨天的消息' + i })
  const n = await mp.restoreContext(room)
  ok(n === 7 && room.msgs.length === 7 && room.seen.has('q1'), '重启后装回上下文并标记已见')
  ok((await mp.restoreContext(room)) === 0, '已有上下文时不重复装回')
  ok(mp.searchArchive('900001', '还记得第一句吗', 3).length === 1, '翻旧账搜原文（去掉"还记得"噪声）')
  // 人物卡
  ok(mp.maybeCards('900001', ['42']) === 1, '新事实攒够 → 触发人物卡')
  await new Promise((r) => setTimeout(r, 30))
  ok(mp.readCard('900001', '42').includes('小张'), '人物卡已写入')
  ok(mp.maybeCards('900001', ['42']) === 0, '没有新事实不重写')
  ok(mp.listCards('900001')[0]?.hasCard === true, 'listCards 列出')
  // 每日摘要
  const w = await mp.writeDaily('900001', '2026-11-08')
  ok(w.ok && w.msgs === 7, '写某一天的摘要')
  ok((await mp.writeDaily('900001', '2026-11-01')).skipped, '消息太少的那天跳过')
  // 提示词：说话人卡 + 每日摘要
  const pb = mp.promptBlocks(room)
  ok(pb.includes('小张') && pb.includes('每日摘要') && pb.includes('11-08'), '提示词带人物卡和每日摘要')
  // 跟进（due=11-08 是昨天）
  const sentN = await mp.followTick()
  ok(sentN === 1 && sent[0] === '科目二考得咋样', '到期主动跟进一次')
  ok((await mp.followTick()) === 0, '跟进过的不再问')
  ok(mp.followList('900001')[0]?.state === 'done', 'followList 状态')
  ok(mp.status('900001').archive.available && mp.status('900001').people === 1, 'status 汇总')
  db2?.close()
} finally {
  db?.close()
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* Windows 上 sqlite 句柄可能晚一点释放 */ }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-memory-plus.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-memory-plus.mjs 通过 ${pass} 项，失败 0 项`)
