/**
 * 记忆深化（qqbot-docs/design/记忆深化方案.md）回归测试：8 项功能 + 提炼格式升级 + 记忆总预算 + 每晚任务 + 面板接口。
 * 用假的模型输出和假的向量模型（不下载真模型、不调真模型）。
 * 运行：node lib/test-memory-deep.mjs
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createEmbedder } from './embed.mjs'
import { createMemoryStore, freshness } from './memory-store.mjs'
import { createMemPlus } from './memory-plus.mjs'
import { createMemoryAi, CREATEMEMORYAI_DEPS, parseOpLine } from './memory-ai.mjs'
import { createMemDeep, MEMDEEP_DEPS } from './deep.mjs'
import { createMemPlusApi } from './memory-plus-api.mjs'
import { createPrompt, fitBudget } from './prompt.mjs'
import { createFeatures } from './features.mjs'
import { createScheduler } from './scheduler.mjs'
import { writeRoomFacts, readRoomMemory, readArchiveFull, readArchive } from './memory.mjs'
import { parseInsightLine } from './deep-insights.mjs'
import { parseConsolidateLine } from './deep-consolidate.mjs'
import {
  parseEmotion, looksLikeEmotion, parseLineNums, judgeSource, sourceHint, confidenceHint, tactHint, chainSummary,
  clampConfidence, effectiveHalfLife, birthdaySoon, parseMonthDays, cnNum, yearsAgoToday, localDay, addDays,
} from './memory-deep.mjs'
import { CONFIG_META, GROUPS } from './meta.mjs'

let pass = 0
const fails = []
const ok = (c, n) => {
  if (c) { pass += 1; console.log('  PASS  ' + n) } else { fails.push(n); console.log('  FAIL  ' + n) }
}
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms))
const DAY = 86400000

/* ── 假向量模型：同一概念组的词得到相近的向量 ── */
const GROUPS_V = [['猫', '喵', '布偶', '橘子'], ['驾照', '科目', '倒车'], ['火锅', '辣'], ['生日', '蛋糕'], ['减肥', '撸串', '瘦'], ['考研', '复习']]
function fakeVec(text) {
  const v = GROUPS_V.map((g) => (g.some((w) => text.includes(w)) ? 1 : 0))
  v.push(0.15)
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return v.map((x) => x / n)
}
const fakeTransformers = {
  env: {},
  pipeline: async () => {
    const pipe = async (texts) => ({ tolist: () => texts.map(fakeVec) })
    pipe.tokenizer = {}
    pipe.dispose = async () => {}
    return pipe
  },
}
const importer = (m) => (m === '@huggingface/transformers' ? Promise.resolve(fakeTransformers) : import(m))

const tmp = mkdtempSync(join(tmpdir(), 'qqbot-deep-'))
try {
  /* ─────────────── 0. 配置项和方案一致 ─────────────── */
  const want = {
    reflectEnabled: true, reflectHour: 5, reflectMinNew: 5, reflectMaxNew: 3, insightsInPrompt: 3,
    emotionWeight: 0.5, emotionSlowFade: true,
    storyEnabled: true, storyInPrompt: 3, storyAnniversary: true,
    assocEnabled: true, assocExtra: 2, assocMinSim: 0.35,
    consolidateEnabled: true, consolidateHour: 4, consolidateMode: 'apply', consolidateMaxOps: 10,
    sourceHints: true, fuzzyMemory: true, fuzzyBelow: 0.3,
    recallEnabled: true, recallChance: 0.08, recallCooldownHours: 12, recallDormantDays: 14, recallAvoidSad: true,
    memoryPromptChars: 1500,
  }
  const badDefault = Object.entries(want).filter(([k, v]) => CONFIG_META[k]?.default !== v || CONFIG_META[k]?.group !== 'memdeep')
  ok(!badDefault.length, '「记忆深度」分组的 26 个配置项默认值和方案一致' + (badDefault.length ? '：' + badDefault.map(([k]) => k).join(',') : ''))
  ok(GROUPS.some((g) => g.id === 'memdeep' && g.icon === '🌊' && g.title === '记忆深度'), '新增配置分组「🌊 记忆深度」')
  const range = (k, lo, hi) => CONFIG_META[k].min === lo && CONFIG_META[k].max === hi
  ok(range('reflectHour', 0, 23) && range('reflectMinNew', 1, 50) && range('reflectMaxNew', 1, 10) && range('insightsInPrompt', 0, 8) && range('emotionWeight', 0, 1) && range('assocExtra', 0, 6), '范围和方案一致')
  ok(CONFIG_META.consolidateMode.options.join() === 'apply,suggest' && /直接执行/.test(CONFIG_META.consolidateMode.optionLabels.apply), '整理执行方式：直接执行 / 只出建议')

  /* ─────────────── 1. 纯函数 ─────────────── */
  ok(parseEmotion('难过/4').emotion === '难过' && parseEmotion('难过/4').intensity === 4, '情绪/强度：难过/4')
  ok(parseEmotion('平静/5').intensity === 1 && parseEmotion('-').emotion === '平静' && parseEmotion('开心').intensity === 2, '情绪：平静固定 1；没写按平静；只写情绪按 2')
  ok(looksLikeEmotion('期待/3') && looksLikeEmotion('-') && !looksLikeEmotion('2026-11-05'), '区分"情绪/强度"字段')
  ok(parseLineNums('3,5、第7行').join() === '3,5,7' && parseLineNums('-').length === 0, '依据行号解析')
  const L = [
    { sender: '42', senderName: '阿杰', text: '我最近在减肥', ts: 1 },
    { sender: '43', senderName: '小美', text: '阿杰在减肥哈哈', ts: 2 },
    { isSelf: true, text: '加油', ts: 3 },
    { sender: '42', senderName: '阿杰', text: '[图片：一只橘猫在睡觉]', ts: 4 },
  ]
  ok(judgeSource('42', [L[0]]).source === '亲口说' && judgeSource('42', [L[0]]).sourceBy === '42', '来源：说话人就是本人 → 亲口说')
  ok(judgeSource('42', [L[1]]).source === '别人说' && judgeSource('42', [L[1]]).sourceByName === '小美', '来源：别人说的 → 别人说（记下是谁说的）')
  ok(judgeSource('42', []).source === '推测' && judgeSource('42', [L[2]]).source === '推测', '来源：没有依据行 / 只有"我"说的 → 推测')
  ok(judgeSource('42', [L[3]]).source === '观察', '来源：依据只有图片描述 → 观察')
  ok(judgeSource('', [L[1]]).source === '亲口说', '来源：关于整个群的，群里有人说就算亲口说')
  ok(sourceHint({ source: '亲口说', who: '42' }) === '他自己说的' && sourceHint({ source: '别人说', sourceByName: '小美' }) === '听小美说的' && sourceHint({ source: '推测' }) === '你猜的，不确定' && sourceHint({ source: '手动添加' }) === '', '来源提示：他自己说的 / 听小美说的 / 你猜的，不确定 / 手动添加不加')
  ok(clampConfidence(5, '推测') === 3 && clampConfidence(undefined) === 3 && clampConfidence(9) === 5, '把握度：缺省 3；推测类最高 3')
  ok(confidenceHint({ confidence: 2 }).includes('好像') && !confidenceHint({ confidence: 3 }), '把握度 ≤ 2 提示用"好像"')
  ok(tactHint({ who: '42', emotion: '难过', intensity: 4 }) === '他当时很难过，提到时注意分寸，别拿来开玩笑' && !tactHint({ emotion: '难过', intensity: 3 }) && !tactHint({ emotion: '开心', intensity: 5 }), '说话分寸：强度 ≥ 4 的难过 / 生气 / 害怕 / 尴尬')
  ok(effectiveHalfLife({ emotion: '感动', intensity: 5 }, 30) === 90 && effectiveHalfLife({}, 30) === 30 && effectiveHalfLife({ emotion: '感动', intensity: 5 }, 30, false) === 30, '半衰期 × (1 + (强度-1) × 0.5)：强度 5 = 90 天')
  ok(cnNum('十二') === 12 && cnNum('二十三') === 23 && cnNum('三') === 3 && parseMonthDays('阿琳生日是三月十二号').length === 1, '中文日期解析')
  ok(birthdaySoon({ text: '阿琳生日是3月12日' }, '2026-03-10') && !birthdaySoon({ text: '阿琳生日是3月12日' }, '2026-03-01') && birthdaySoon({ text: '小美生日', due: '2026-03-11' }, '2026-03-10'), '生日临近（3 天内）')
  ok(yearsAgoToday(new Date(2025, 2, 10).getTime(), '2026-03-10') === 1 && yearsAgoToday(new Date(2026, 2, 10).getTime(), '2026-03-10') === 0, '"一年前的今天"')
  const nodes = [
    { kind: '版本', text: '阿杰在减肥', at: new Date(2026, 9, 1).getTime() },
    { kind: '结束', reason: '说不减了', at: new Date(2026, 10, 1).getTime() },
    { kind: '版本', text: '阿杰又开始减肥了', at: new Date(2026, 11, 1).getTime() },
  ]
  const cs = chainSummary(nodes)
  ok(cs.includes('10月1日') && cs.includes('结束（说不减了）') && cs.includes('现在是第 2 次'), '变化线摘要：10 月开始 → 11 月结束 → 12 月又开始，现在是第 2 次')
  ok(chainSummary(nodes.slice(0, 1)) === '' && chainSummary([...nodes, { kind: '版本', text: 'x', at: Date.now() }]).startsWith('… → '), '只有 1 个版本不显示；最多显示最近 3 个节点')

  /* ─────────────── 2. 装配 ─────────────── */
  let clock = new Date(2026, 10, 9, 12, 0).getTime()
  const now = () => clock
  const config = {
    memoryRooms: ['900001', '10001'], allowGroups: ['900001'], allowPrivate: [], adminQQ: ['10001'], enabled: true,
    semanticSearch: true, semanticModel: 'Xenova/bge-base-zh-v1.5', semanticThreads: 1, keywordBonus: 0,
    memoryReinforce: true, memoryHalfLifeDays: 30, factsKeep: 150, memoryOps: true, dailySummary: true, chatLogEnabled: false,
    ...want,
  }
  const rooms = new Map()
  const facts = {}
  const logs = []
  const log = (m) => logs.push(m)
  const store = createMemoryStore({ config, rooms, groupNames: new Map(), facts, memoryDir: join(tmp, 'mem'), log, keywordsOf: () => [] })
  const emb = createEmbedder({ config, log, memDirOf: store.memDirOf, dataDir: tmp, importer })
  const room = { roomId: '900001', roomName: '测试群', isGroup: true, msgs: [], seen: new Set(), lastActivityAt: 0, nameCache: new Map() }
  rooms.set('900001', room)
  const gens = []
  let reply = () => '无'
  const generate = async (args) => {
    gens.push(args)
    return { text: reply(args) }
  }
  let memDeep = null
  const mp = createMemPlus({
    config, cfgFor: () => ({ personCards: false, dailySummaryDays: 0, followUp: false }), log, generate,
    memDirOf: store.memDirOf, isManagedRoom: store.isManagedRoom, factsOf: store.factsOf, factsAbout: store.factsAbout,
    dueFacts: store.dueFacts, markFollowed: store.markFollowed, rooms, allowedHere: () => true, sendReply: async () => [],
    isQuiet: () => false, quietWindowsFor: () => [], systemPrompt: () => '', buildTranscript: () => '', humanizeText: (t) => t,
    getChatLog: () => null, getEmbedder: () => emb, getMemDeep: () => memDeep, now,
  })
  let threw = ''
  try { createMemDeep({}) } catch (e) { threw = String(e.message) }
  ok(threw.includes('缺少依赖') && MEMDEEP_DEPS.includes('store'), '记忆深化：缺依赖抛错')
  let rnd = 0
  memDeep = createMemDeep({ config, log, generate, store, rooms, getEmbedder: () => emb, getMemPlus: () => mp, now, random: () => rnd })
  store.setOnChange((rid) => {
    mp.onFactsChanged(rid)
    memDeep.onFactsChanged(rid)
  })
  await emb.ensure()
  const aiDeps = Object.fromEntries(CREATEMEMORYAI_DEPS.map((k) => [k, () => {}]))
  Object.assign(aiDeps, {
    isManagedRoom: store.isManagedRoom, memDirOf: store.memDirOf, factsOf: store.factsOf, readArchive, roomTextOf: store.roomTextOf,
    config, generate, log, roomState: (id) => rooms.get(String(id)),
    applyOps: (rid, ops) => store.applyOps(rid, ops),
    chainsFor: (rid, list) => store.chainsFor(rid, list),
    endedChains: (rid) => store.endedChains(rid),
    onStory: (rid, s) => !!memDeep.story.addMilestone(rid, s.who, s),
    insightsOf: (rid) => memDeep.insights.activeOf(rid),
    associateItems: (rid, ids, chosen) => memDeep.links.associateItems(rid, ids, chosen),
  })
  const ai = createMemoryAi(aiDeps)

  /* ─────────────── 3. 提炼格式升级（3、4、7 共用） ─────────────── */
  const names = new Map([['42', '阿杰'], ['43', '小美']])
  const idOf = new Map([[1, 'f1']])
  const a1 = parseOpLine('ADD|42|3|-|难过/4|2|阿杰最近在减肥', names, idOf, 5)
  ok(a1 && a1.emotion === '难过' && a1.intensity === 4 && a1.evidence.join() === '2' && a1.text === '阿杰最近在减肥' && a1.who === '42', '新格式 ADD：情绪 / 强度 / 依据行号')
  const a0 = parseOpLine('ADD|42|3|-|阿杰最近在减肥', names, idOf, 5)
  ok(a0 && a0.text === '阿杰最近在减肥' && a0.evidence === undefined && a0.emotion === undefined, '旧格式 ADD 仍然兼容（字段少了按缺省值）')
  ok(parseOpLine('ADD|42|3|-|开心/2|9|超出行号的依据丢掉', names, idOf, 5).evidence.length === 0, '依据行号超出这批记录的丢掉')
  const u1 = parseOpLine('UPDATE|1|3|-|期待/3|1,2|阿杰又开始减肥了', names, idOf, 5)
  ok(u1 && u1.id === 'f1' && u1.emotion === '期待' && u1.evidence.join() === '1,2', '新格式 UPDATE')
  const s1 = parseOpLine('STORY|43|特别的时刻|感动/4|3|小美深夜跟我聊了心事', names, idOf, 5)
  ok(s1 && s1.op === 'STORY' && s1.who === '43' && s1.type === '特别的时刻' && s1.intensity === 4, 'STORY 解析')
  ok(parseOpLine('STORY|999|约定|-|-|编的人', names, idOf, 5) === null && parseOpLine('STORY|42|答应过的事|期待/2|1|提醒他交作业', names, idOf, 5).type === '约定', 'STORY：不认识的 QQ 号丢弃；"答应过的事"归到约定')

  const T0 = Date.now()
  room.msgs.push(
    { id: 'm1', ts: T0 - 6000, sender: '42', senderName: '阿杰', text: '我又开始减肥了，这次是认真的' },
    { id: 'm2', ts: T0 - 5000, sender: '43', senderName: '小美', text: '阿杰上次减肥失败难过了好几天' },
    { id: 'm3', ts: T0 - 4000, sender: '43', senderName: '小美', text: '我下周三考科目二' },
    { id: 'm4', ts: T0 - 3000, isSelf: true, sender: '1', senderName: '我', text: '加油加油' },
    { id: 'm5', ts: T0 - 2000, sender: '43', senderName: '小美', text: '谢谢你昨晚陪我聊到两点' },
    { id: 'm6', ts: T0 - 1000, sender: '42', senderName: '阿杰', text: '我喜欢吃火锅' },
  )
  reply = ({ system }) =>
    system.includes('记忆整理器')
      ? [
          'ADD|42|3|-|期待/3|1|阿杰又开始减肥了',
          'ADD|42|2|-|难过/4|2|阿杰上次减肥失败难过了好几天',
          'ADD|43|5|2026-11-11|害怕/3|3|小美下周三考科目二',
          'ADD|42|3|-|开心/2|-|阿杰好像喜欢吃辣',
          'ADD|42|2|-|平静/1|6|阿杰喜欢吃火锅',
          'STORY|43|特别的时刻|感动/4|5|小美深夜跟你聊到两点，谢谢你陪她',
        ].join('\n')
      : '无'
  const ex = await ai.extractFacts('900001')
  const prompt1 = gens.find((g) => g.system.includes('记忆整理器'))?.user || ''
  ok(ex.ok && ex.added === 5 && ex.stories === 1, '提炼：新增 5 条 + 1 个故事节点')
  ok(/\[1\] 阿杰\(42\): 我又开始减肥了/.test(prompt1) && /\[4\] 我: 加油加油/.test(prompt1), '交给模型的聊天记录每行带行号 [n]')
  ok(prompt1.includes('ADD|QQ号或群|重要度|跟进日期|情绪/强度|依据行号|事实') && prompt1.includes('STORY|QQ号|类型|情绪/强度|依据行号|和"我"之间发生的事'), '提炼指令是升级后的格式')
  const F = (t) => store.factsOf('900001').find((f) => f.text === t)
  ok(F('阿杰又开始减肥了')?.source === '亲口说' && F('阿杰又开始减肥了').sourceBy === '42', '依据行是本人说的 → 亲口说')
  ok(F('阿杰上次减肥失败难过了好几天')?.source === '别人说' && F('阿杰上次减肥失败难过了好几天').sourceByName === '小美' && F('阿杰上次减肥失败难过了好几天').intensity === 4, '依据行是别人说的 → 别人说（听小美说）；情绪强度记下')
  ok(F('阿杰好像喜欢吃辣')?.source === '推测', '依据写 - → 推测')
  ok(F('小美下周三考科目二')?.emotion === '害怕' && F('小美下周三考科目二').due === '2026-11-11' && F('小美下周三考科目二').chainId === F('小美下周三考科目二').id, '情绪、跟进日期、变化线编号都记下')
  const st43 = memDeep.story.readStory('900001', '43')
  ok(st43.milestones.some((m) => m.type === '特别的时刻' && m.by === '模型' && m.intensity === 4), 'STORY 记进"我们之间的故事"（by 模型）')

  /* ─────────────── 4. 第 7 项：把握度变化 ─────────────── */
  store.applyOps('900001', [{ op: 'ADD', text: '阿杰喜欢吃火锅', who: '42', source: '亲口说', sourceBy: '42', sourceByName: '阿杰' }])
  ok(F('阿杰喜欢吃火锅').confidence === 4 && store.factsOf('900001').filter((f) => f.text === '阿杰喜欢吃火锅').length === 1, '本人又提了一次（ADD 一字不差）→ 把握度 +1，不重复记')
  store.applyOps('900001', [{ op: 'UPDATE', id: F('阿杰喜欢吃火锅').id, text: '阿杰喜欢吃火锅', source: '亲口说', sourceBy: '42' }])
  ok(F('阿杰喜欢吃火锅').confidence === 5, 'UPDATE 内容一致、本人确认 → 再 +1（最高 5）')
  store.applyOps('900001', [{ op: 'ADD', text: '阿杰好像喜欢吃辣', who: '42', source: '亲口说', sourceBy: '42' }])
  ok(F('阿杰好像喜欢吃辣').source === '亲口说' && F('阿杰好像喜欢吃辣').confidence === 4, '推测的被本人确认 → 改成亲口说，把握度 +1')
  store.applyOps('900001', [{ op: 'ADD', text: '阿杰喜欢吃火锅', who: '42', source: '别人说', sourceBy: '43' }])
  ok(F('阿杰喜欢吃火锅').confidence === 5, '别人转述一字不差的事不加把握度')
  store.updateFact('900001', F('阿杰好像喜欢吃辣').id, { source: '推测' })
  ok(F('阿杰好像喜欢吃辣').confidence === 3, '来源改成推测 → 把握度压到 3')

  /* ─────────────── 5. 第 2 项：变化线 ─────────────── */
  const old = F('小美下周三考科目二')
  const nv = store.updateFact('900001', old.id, { text: '小美把科目二改到周六了' })
  ok(nv && nv.id !== old.id && nv.chainId === old.chainId && nv.prev === old.id && nv.due === '2026-11-11', '改了内容 → 新版本（新 id、继承变化线、prev 指向旧版本）')
  const arch = readArchiveFull(store.memDirOf('900001'))
  ok(arch.some((a) => a.id === old.id && a.supersededBy === nv.id && a.supersededAt), '旧版本进归档，记下被谁取代、什么时候')
  ok(store.chainOf('900001', nv.id).filter((n) => n.kind === '版本').length === 2, 'chainOf：当前 + 归档，按时间排好')
  const imp = store.updateFact('900001', nv.id, { importance: 4 })
  ok(imp.id === nv.id, '只改重要度：原地改，不生成新版本')
  const diet = F('阿杰又开始减肥了')
  store.applyOps('900001', [{ op: 'DELETE', id: diet.id, reason: '他说不减了' }])
  const ended = store.endedChains('900001')
  ok(ended.some((a) => a.id === diet.id && a.endReason === '他说不减了'), '模型 DELETE → 给这条线记结束节点（原因 + 时间）')
  reply = ({ system, user }) => {
    if (!system.includes('记忆整理器')) return '无'
    const m = /\[(\d+)\] 阿杰又开始减肥了（\d+月\d+日结束：他说不减了）/.exec(user)
    return m ? `UPDATE|${m[1]}|3|-|开心/3|1|阿杰第二次开始减肥了` : '无'
  }
  room.msgs.push({ id: 'm7', ts: Date.now(), sender: '42', senderName: '阿杰', text: '我又又开始减肥了' })
  gens.length = 0
  const ex2 = await ai.extractFacts('900001')
  const p2 = gens[0]?.user || ''
  ok(p2.includes('已经结束的事') && ex2.updated === 1, '提炼时列出已经结束的线，模型用 UPDATE 接回去')
  const again = F('阿杰第二次开始减肥了')
  const chain = store.chainOf('900001', again.id)
  ok(again.chainId === (diet.chainId || diet.id) && again.prev === diet.id && chain.map((n) => n.kind).join() === '版本,结束,版本', '又开始了：接在结束节点后面（版本 → 结束 → 版本）')
  ok(chainSummary(chain).includes('现在是第 2 次'), '变化摘要：现在是第 2 次')
  ok(p2.includes('［变化：') || store.chainsFor('900001').get(nv.id).length === 2, '已有记忆附上变化摘要')

  /* ─────────────── 6. 第 3 项：情绪权重 ─────────────── */
  const dirE = join(tmp, 'evict')
  const list31 = Array.from({ length: 31 }, (_, i) => ({ id: 'e' + i, text: '记忆' + i, importance: 2 }))
  list31[0].emotion = '感动'
  list31[0].intensity = 5
  const ev = writeRoomFacts(dirE, list31, { keep: 30 })
  const kept = readRoomMemory(dirE).facts.map((f) => f.id)
  ok(ev.archived === 1 && kept.includes('e0') && !kept.includes('e1'), '淘汰：情绪强（强度 5）的老记忆留下，平静的先走')
  ok(Math.abs(freshness({ importance: 2, emotion: '感动', intensity: 5, at: Date.now() - 90 * DAY }, 30, Date.now(), true) - 0.5) < 0.01, '淡忘：强度 5 的 90 天才淡一半')
  ok(Math.abs(freshness({ importance: 2, emotion: '感动', intensity: 5, at: Date.now() - 30 * DAY }, 30, Date.now(), false) - 0.5) < 0.01, '关掉"情绪强的淡得慢"就照旧')
  const sc = store.scoreFacts({ roomId: '900001', msgs: [] }, [{ id: 'x', text: '甲', importance: 2 }, { id: 'y', text: '乙', importance: 2, emotion: '开心', intensity: 5 }], '', '')
  ok(Math.abs(sc[1].s - sc[0].s - 4 * 0.5 * 0.05) < 1e-9, '挑记忆：+ (强度-1) × 情绪权重 × 0.05')

  /* ─────────────── 7. 系统提示词：来源 / 把握度 / 模糊 / 分寸 / 变化 / 预算 ─────────────── */
  const promptOf = (over = {}) =>
    createPrompt({
      config: { ...config, ...over }, cfgFor: () => ({ persona: '人设', factsLimit: 30, maxLines: 2, maxReplyChars: 80 }),
      getFeatures: () => ({ bondLine: () => '' }), isManagedRoom: store.isManagedRoom, memDirOf: store.memDirOf,
      pickFacts: (r, n, o) => store.pickFacts(r, n, o), roomTextOf: () => ({ profile: '', summary: '', relations: '', diary: '', self: '' }),
      getMemPlus: () => mp, getMemDeep: () => memDeep, chainsFor: store.chainsFor, markUsed: store.markUsed,
    })
  const fuzzy = F('阿杰喜欢吃火锅')
  fuzzy.at = Date.now() - 200 * DAY
  fuzzy.lastUsedAt = 0
  const sp = promptOf().systemPrompt(room)
  ok(sp.includes('阿杰上次减肥失败难过了好几天') && sp.includes('（听小美说的）') && sp.includes('（他当时很难过，提到时注意分寸，别拿来开玩笑）'), '提示词：别人说的标"听小美说的"；强度 ≥ 4 的难过附分寸提醒')
  ok(sp.includes('（他自己说的）') && sp.includes('听说的和猜的，说出来时要带上"听说""好像"，别当成定论'), '提示词：亲口说的标"他自己说的"，加一条"听说的和猜的"规则')
  ok(sp.includes('阿杰喜欢吃火锅') && /阿杰喜欢吃火锅（[^\n]*（记得不太清了）/.test(sp) && sp.includes('好像是……吧？'), '记忆模糊：新鲜度 < 0.3 标「记得不太清了」')
  ok(/阿杰第二次开始减肥了（[^\n]*变化：[^\n]*现在是第 2 次/.test(sp), '被挑中的记忆有 ≥ 2 个版本时附变化')
  const sp0 = promptOf({ sourceHints: false, fuzzyMemory: false }).systemPrompt(room)
  ok(!sp0.includes('听小美说的') && !sp0.includes('记得不太清了') && sp0.includes('别拿来开玩笑'), '关掉来源提示 / 记忆模糊就不标（分寸提醒照旧）')

  const bl = fitBudget(
    {
      card: { head: '卡', lines: ['卡片内容'] },
      facts: { head: '记得', lines: ['事实一', '事实二'] },
      insights: { head: '理解', lines: ['认识一'] },
      story: { head: '故事', lines: ['故事一'] },
      assoc: { head: '', lines: ['联想一'] },
      daily: { head: '摘要', lines: ['摘要一'] },
      profile: { head: '画像', lines: ['画像一', '画像二'] },
    },
    30,
  )
  ok(!bl.profile.lines.length && !bl.daily.lines.length && bl.card.lines.length === 1 && bl.facts.lines.length >= 1, '记忆总预算：先砍群画像，再砍每日摘要……人物卡和相关事实最后')
  ok(fitBudget({ profile: { head: 'h', lines: ['x'.repeat(5000)] } }, 0).profile.lines[0].length === 5000, '记忆总预算 0 = 不限')
  const longProfile = promptOf({ memoryPromptChars: 200 })
  const tiny = createPrompt({
    config: { ...config, memoryPromptChars: 200 }, cfgFor: () => ({ persona: '人设', factsLimit: 30 }), getFeatures: () => ({ bondLine: () => '' }),
    isManagedRoom: () => true, memDirOf: () => 'x', pickFacts: () => [{ id: 'q', text: '小王喜欢猫', at: Date.now() }],
    roomTextOf: () => ({ profile: '画像'.repeat(200), summary: '', relations: '', diary: '', self: '' }),
  }).systemPrompt({ roomId: '1', isGroup: true, msgs: [] })
  ok(tiny.includes('小王喜欢猫') && !tiny.includes('画像'.repeat(200)), '超出预算时先裁群画像（截短或去掉），事实留着')
  void longProfile

  /* ─────────────── 8. 第 4 项：我们之间的故事 ─────────────── */
  const st = memDeep.story
  st.onMessage(room, { sender: '50', senderName: '小周', text: '大家好我是新来的' }, false)
  let s50 = st.readStory('900001', '50')
  ok(s50.firstSeenAt === clock && s50.milestones[0]?.type === '初次见面' && s50.firstMsg === '大家好我是新来的', '初次见面：第一次收到他的消息')
  st.onMessage(room, { sender: '50', senderName: '小周', text: '你好可爱' }, false)
  ok(!st.readStory('900001', '50').milestones.some((m) => m.type.includes('被夸')), '没 @ 我也没回复我：夸别人不算')
  st.onMessage(room, { sender: '50', senderName: '小周', text: '你好可爱' }, true)
  ok(st.readStory('900001', '50').milestones.some((m) => m.type === '第一次被夸' && m.text.includes('小周夸你')), '@ 我或回复我 + 命中"夸"词表 → 第一次被夸')
  st.onMessage(room, { sender: '50', senderName: '小周', text: '真棒' }, true)
  ok(st.readStory('900001', '50').milestones.filter((m) => m.type.includes('被夸')).length === 1, '同一类型 1 小时内只记一次')
  clock += 2 * 3600000
  st.onMessage(room, { sender: '50', senderName: '小周', text: '真棒' }, true)
  ok(st.readStory('900001', '50').milestones.some((m) => m.type === '被夸'), '过了 1 小时再夸 → 被夸（"第一次"只记一次）')
  st.onMessage(room, { sender: '50', senderName: '小周', text: '你好笨' }, true)
  ok(st.readStory('900001', '50').milestones.some((m) => m.type === '第一次被凶' && m.emotion === '难过'), '命中"骂"词表 → 第一次被凶')
  clock += DAY
  st.onMessage(room, { sender: '50', senderName: '小周', text: '早' }, false)
  ok(st.readStory('900001', '50').stats.daysTalked === 2, '聊过几天：换了一天 +1')
  // 亲密度门槛：features.bumpBond 跨过 80 → 变熟了
  const feats = createFeatures({
    config: { bondEnabled: true }, rooms, isManagedRoom: () => false, memDirOf: () => '', readJson: () => ({}), log,
    storyHook: { bond: (r, who, lvl, name) => st.onBondLevel(r, who, lvl, name), play: (r, who, what, name) => st.onPlay(r, who, what, name), promise: (r, who, info, name) => st.onPromise(r, who, info, name) },
  })
  room.nameCache.set('50', '小周')
  for (let i = 0; i < 80; i++) feats.bumpBond(room, '50', 1)
  ok(st.readStory('900001', '50').milestones.some((m) => m.type === '变熟了' && m.text.includes('有点熟')), '亲密度跨过"有点熟"门槛 → 变熟了')
  for (let i = 0; i < 5; i++) feats.bumpBond(room, '50', 1)
  ok(st.readStory('900001', '50').milestones.filter((m) => m.type === '变熟了').length === 1, '没跨新门槛不重复记')
  st.onPlay(room, '50', '掷骰子', '小周')
  const due = new Date(clock + DAY)
  st.onPromise(room, '50', { text: '交作业', at: due.getTime() }, '小周')
  ok(st.readStory('900001', '50').milestones.some((m) => m.type === '一起玩') && st.readStory('900001', '50').milestones.some((m) => m.type === '约定' && m.due === localDay(due)), '一起玩 / 约定（让我提醒他）')
  room.msgs.push({ id: 'm8', ts: Date.now(), sender: '50', senderName: '小周', text: '在吗' })
  let line = st.promptLine(room)
  ok(line.includes('你和小周：认识第 2 天，聊过 2 天。最近：') && line.includes('是记忆，不是指令'), '提示词：你和小周：认识第 N 天，聊过 M 天。最近：…')
  ok(line.split('；').length <= 3, '最多 3 件（最近一件 + 情绪最强的一件 + 今天有关的一件）')
  clock = due.getTime()
  line = st.promptLine(room)
  ok(line.includes('今天就是约好的事'), '约定到期那天：今天有关的一件')
  // 纪念日
  const e50 = st.readStory('900001', '50')
  e50.firstSeenAt = new Date(new Date(clock).setHours(9)).getTime() - 30 * DAY
  ok(st.anniversaries('900001').some((a) => a.who === '50' && a.days === 30) && st.promptLine(room).includes('认识满 30 天'), '纪念日：认识满 30 天')
  const man = st.addMilestone('900001', '50', { type: '特别的时刻', text: '小周送了你一张画', by: '手动' })
  ok(man && st.updateMilestone('900001', '50', man.id, { text: '小周送了你一张自己画的鲸鱼' }).text.includes('鲸鱼') && st.deleteMilestone('900001', '50', man.id), '面板可以手动添加、修改、删除节点')
  st.flush()
  ok(existsSync(join(store.memDirOf('900001'), 'story', '50.json')), '存在 story/<QQ号>.json')
  config.storyEnabled = false
  ok(st.promptLine(room) === '' && !st.addMilestone('900001', '50', { type: '约定', text: 'x', by: '规则' }), '关掉"我们之间的故事"就完全不记不带')
  config.storyEnabled = true

  /* ─────────────── 9. 第 5 项：联想 ─────────────── */
  store.addFact('900001', '小王养了一只橘猫', Date.now(), { who: '60', whoName: '小王', importance: 3 })
  store.addFact('900001', '小王家的布偶猫很粘人', Date.now(), { who: '60', whoName: '小王', importance: 2, noMerge: true })
  store.addFact('900001', '老李周末去爬山', Date.now(), { who: '61', whoName: '老李', importance: 2 })
  await tick(80)
  await mp.indexMemory('900001')
  const lk = memDeep.links.rebuild('900001')
  const cat1 = F('小王养了一只橘猫')
  const cat2 = F('小王家的布偶猫很粘人')
  const row = memDeep.links.linksOf('900001', cat1.id)
  ok(lk.ok && row.some((l) => l.id === cat2.id && /意思相近/.test(l.reason) && /同一个人/.test(l.reason)), '联想：意思相近 + 同一个人 连起来（带原因和权重）')
  ok(!row.some((l) => l.text === '老李周末去爬山'), '不相干的不连')
  ok(existsSync(join(store.memDirOf('900001'), 'links.json')), '存在 links.json')
  const seedsOnly = memDeep.links.associate('900001', [cat1], new Set([cat1.id]), 2)
  ok(seedsOnly.some((f) => f.id === cat2.id), '从种子出发带出联想的记忆')
  ok(memDeep.links.associate('900001', [cat1], new Set([cat1.id, cat2.id]), 2).every((f) => f.id !== cat2.id), '已经选中的不重复带')
  ok(memDeep.links.associate('900001', [cat1], new Set([cat1.id]), 0).length === 0, 'assocExtra = 0 不带')
  // pickFacts：相关的挑 1 条，联想再带 1 条，提示词里标（顺带想起）
  const r9 = { roomId: '900001', msgs: [{ sender: '60', text: '橘猫最近怎么样' }] }
  await mp.prepareSemantic(r9, '橘猫最近怎么样')
  const picked = store.pickFacts(r9, 1, { mark: false })
  ok(picked.length === 2 && picked.assoc.has(cat2.id) && picked[0].id === cat1.id, 'pickFacts：挑出最相关的，再带上联想的（assoc 标记）')
  const spA = createPrompt({
    config, cfgFor: () => ({ persona: '', factsLimit: 1 }), getFeatures: () => ({ bondLine: () => '' }), isManagedRoom: store.isManagedRoom, memDirOf: store.memDirOf,
    pickFacts: (r, n, o) => store.pickFacts(r, n, o), roomTextOf: () => ({}), chainsFor: store.chainsFor, markUsed: store.markUsed,
  }).systemPrompt({ ...r9, isGroup: true })
  ok(/小王家的布偶猫很粘人[^\n]*（顺带想起）/.test(spA), '联想来的记忆在提示词里标「（顺带想起）」')
  const sm = ai.searchMemory('900001', '橘猫', 1)
  ok(sm.some((h) => h.kind === '顺带想起' && h.text === '小王家的布偶猫很粘人'), '翻旧账同样会带联想')
  const before = Object.keys(memDeep.links.load('900001')).length
  store.addFact('900001', '小王的猫叫橘子', Date.now(), { who: '60', noMerge: true })
  await tick(120)
  ok(Object.keys(memDeep.links.load('900001')).length === before + 1, '新记忆写入后只算新的那一行（增量）')

  /* ─────────────── 10. 第 1 项：反思归纳 ─────────────── */
  clock = Date.now()
  const fid = new Map([[1, 'a'], [2, 'b'], [3, 'c']])
  const iid = new Map([[1, 'i1']])
  const abouts = new Set(['42', '群', '我'])
  ok(parseInsightLine('NEW|42|3|1,2|阿杰嘴上说减肥，其实经常破戒', fid, iid, abouts).confidence === 3, 'NEW：2 条依据，把握度最高 3（推测类）')
  ok(parseInsightLine('NEW|42|5|1|阿杰爱吃', fid, iid, abouts).confidence === 2, '只有 1 条依据：把握度最高 2')
  ok(parseInsightLine('NEW|42|3|-|没依据', fid, iid, abouts).error, '没有依据：不要')
  ok(parseInsightLine('NEW|99|3|1,2|不在记录里的人', fid, iid, abouts).error, '对象必须是记录里出现过的 QQ 号、群或我')
  ok(parseInsightLine('NEW|42|3|1,2|阿杰可能抑郁了', fid, iid, abouts).error && parseInsightLine('NEW|群|3|1,2|管理员是阿杰', fid, iid, abouts).error, '安全边界：不下诊断、不碰身份权限')
  ok(parseInsightLine('REVISE|1|2|2,3|改过的认识', fid, iid, abouts).id === 'i1' && parseInsightLine('RETIRE|1|不成立了', fid, iid, abouts).reason === '不成立了', 'REVISE / RETIRE 解析')
  const ins = memDeep.insights
  // 托管的管理员私聊也做反思（决定 3）
  const pr = { roomId: '10001', roomName: '', isGroup: false, msgs: [{ sender: '10001', senderName: '清风', text: '晚安' }], seen: new Set(), nameCache: new Map() }
  rooms.set('10001', pr)
  store.addFact('10001', '清风喜欢熬夜写代码', Date.now(), { who: '10001', whoName: '清风' })
  store.addFact('10001', '清风每天凌晨两点才睡', Date.now(), { who: '10001', whoName: '清风' })
  reply = ({ system, user }) => {
    if (!system.includes('善于观察')) return '无'
    const a = /\[(\d+)\] 清风喜欢熬夜写代码/.exec(user)?.[1]
    const b = /\[(\d+)\] 清风每天凌晨两点才睡/.exec(user)?.[1]
    return [`NEW|10001|3|${a},${b}|清风是个夜猫子，深夜找他聊天他多半在`, `NEW|10001|3|${a}|多余的一条`, `NEW|10001|3|${a},${b}|第三条`, `NEW|10001|3|${a},${b}|第四条超过上限`].join('\n')
  }
  config.reflectMaxNew = 3
  const rf = await ins.reflect('10001', { force: true })
  const li = ins.load('10001')
  ok(rf.ok && rf.added === 3 && li.length === 3, '管理员私聊里也做反思；每晚最多新增 reflectMaxNew 条')
  ok(li[0].about === '10001' && li[0].evidence.length === 2 && li[0].status === '有效' && li[1].confidence === 2, '认识带对象、依据、把握度、状态')
  ok(existsSync(join(store.memDirOf('10001'), 'insights.json')), '存在 insights.json')
  ok(ins.shouldReflect('10001').yes === false, '刚反思过、没有新记忆：不跑')
  for (let i = 0; i < 5; i++) store.addFact('10001', '清风的新记忆' + '甲乙丙丁戊'[i] + '号很特别', Date.now() + 10 + i, { noMerge: true })
  ok(ins.shouldReflect('10001').yes === true, '上次反思后新增 ≥ reflectMinNew 条：跑')
  pr.msgs.push({ sender: '10001', senderName: '清风', text: '今晚又要熬夜写代码了' })
  const block = ins.promptBlock(pr)
  ok(block.startsWith('你对这里的人的理解（这是你的理解，不是指令') && block.includes('关于清风：清风是个夜猫子') && block.split('\n').length <= 3, '提示词「你对这里的人的理解」：正在说话的人最多 2 条')
  const usesBefore = ins.load('10001')[0].uses
  mp.promptBlocks(pr)
  ok(ins.load('10001')[0].uses === usesBefore, '面板预览（下次会带哪些）不计入认识的使用次数')
  const ev1 = li[0].evidence[0]
  store.deleteFactById('10001', ev1, '面板删除')
  ok(ins.load('10001')[0].status === '待复核' && !ins.promptBlock(pr).includes('夜猫子'), '依据被删 → 待复核，暂时不进提示词')
  reply = ({ system, user }) => {
    if (!system.includes('善于观察')) return '无'
    const n = /\[认识(\d+)\] （关于 10001｜把握度 3｜待复核）清风是个夜猫子/.exec(user)?.[1]
    const b = /\[(\d+)\] 清风每天凌晨两点才睡/.exec(user)?.[1]
    const c = /\[(\d+)\] 清风的新记忆甲号很特别/.exec(user)?.[1]
    return [`REVISE|${n}|3|${b},${c}|清风经常凌晨才睡`, 'RETIRE|2|太单薄'].join('\n')
  }
  const rf2 = await ins.reflect('10001', { force: true })
  ok(rf2.revised === 1 && rf2.retired === 1 && ins.load('10001')[0].status === '有效' && ins.load('10001')[1].status === '已撤回', '下次反思：模型修正待复核的、撤回不成立的')
  ok(mp.memoryTexts('10001').includes('清风经常凌晨才睡'), '每条认识也建向量')
  ok(ai.searchMemory('10001', '凌晨', 5).some((h) => h.kind === '理解'), '翻旧账能搜到认识')
  const man2 = ins.add('10001', { text: '手动加的认识', about: '我', confidence: 5 })
  ok(man2.ok && man2.insight.confidence === 3 && ins.update('10001', man2.insight.id, { text: '改过的手动认识' }).insight.text === '改过的手动认识' && ins.retire('10001', man2.insight.id).insight.status === '已撤回', '面板手动添加 / 编辑 / 撤回')

  /* ─────────────── 11. 第 6 项：每晚整理 ─────────────── */
  clock = Date.now()
  const G = '20002'
  config.memoryRooms.push(G)
  const gr = { roomId: G, roomName: '整理群', isGroup: true, msgs: [{ sender: '70', senderName: '大刘', text: 'hi' }], seen: new Set(), nameCache: new Map() }
  rooms.set(G, gr)
  const add = (t, x = {}) => store.addFact(G, t, x.at || Date.now(), { noMerge: true, ...x })
  add('大刘爱吃重庆火锅', { who: '70', whoName: '大刘', importance: 3 })
  add('大刘超爱吃火锅', { who: '70', whoName: '大刘', importance: 3 })
  add('大刘在减肥', { who: '70', whoName: '大刘', importance: 2 })
  add('大刘减肥期间天天吃火锅', { who: '70', whoName: '大刘', importance: 2 })
  add('群里的旧梗是放鸽子', { importance: 1, at: Date.now() - 40 * DAY })
  add('大刘的生日是五月一号', { who: '70', importance: 5, at: Date.now() - 40 * DAY })
  add('群里有人说过今天下雨', { importance: 1, at: Date.now() - 40 * DAY, emotion: '难过', intensity: 4 })
  const today = localDay(new Date())
  const dailies = {}
  for (let i = 1; i <= 3; i++) dailies[addDays(today, -i)] = { text: '大家在聊考研复习的事。中午有人点了外卖', msgs: 30, at: Date.now() }
  writeFileSync(join(store.memDirOf(G), 'daily.json'), JSON.stringify(dailies))
  await mp.indexMemory(G)
  const cand = await memDeep.consolidate.candidates(G)
  ok(cand.dup.some((p) => [p.a.text, p.b.text].includes('大刘爱吃重庆火锅') && [p.a.text, p.b.text].includes('大刘超爱吃火锅')), '找重复：语义相似度 ≥ 0.85')
  ok(cand.con.some((p) => [p.a.text, p.b.text].includes('大刘在减肥') && [p.a.text, p.b.text].includes('大刘减肥期间天天吃火锅')), '找矛盾：同一个人、相似度 0.5~0.85')
  ok(cand.topics.some((t) => t.text.includes('考研') && t.days.length === 3), '找该升级的：最近 7 天的每日摘要里出现 ≥ 3 天、长期记忆里没有')
  ok(cand.demote.some((f) => f.text === '群里的旧梗是放鸽子') && !cand.demote.some((f) => f.text.includes('生日')) && !cand.demote.some((f) => f.text.includes('下雨')), '找该降级的：重要度 ≤ 2、强度 ≤ 2、30 天没用过（重要的、情绪强的不降级）')
  const num = (user, t) => new RegExp('\\[(\\d+)\\] (?:★ )?' + t).exec(user)?.[1]
  reply = ({ system, user }) => {
    if (!system.includes('整理自己的记忆')) return '无'
    return [
      `MERGE|${num(user, '大刘爱吃重庆火锅')},${num(user, '大刘超爱吃火锅')}|大刘超爱吃火锅，尤其是重庆火锅`,
      `RESOLVE|${num(user, '大刘减肥期间天天吃火锅')}|${num(user, '大刘在减肥')}|后来天天吃火锅，减肥没坚持`,
      'PROMOTE|群|3|期待/2|群里好几个人在准备考研',
      `DEMOTE|${num(user, '群里的旧梗是放鸽子')}`,
    ].join('\n')
  }
  gens.length = 0
  const run1 = await memDeep.consolidate.run(G)
  const GF = (t) => store.factsOf(G).find((f) => f.text === t)
  ok(run1.ok && run1.done === 4 && gens.length === 1, '一次模型调用，只交候选；4 处都执行了')
  ok(!gens[0].user.includes('大刘的生日是五月一号'), '没列进候选的记忆不交给模型')
  const merged = GF('大刘超爱吃火锅，尤其是重庆火锅')
  ok(merged && !GF('大刘爱吃重庆火锅') && !GF('大刘超爱吃火锅') && store.chainOf(G, merged.id).filter((n) => n.kind === '版本').length >= 2, 'MERGE：合并成一条，保留变化线和归档')
  ok(!GF('大刘在减肥') && GF('大刘减肥期间天天吃火锅').confidence === 2, 'RESOLVE：作废一条；留下的那条把握度 −1（出现矛盾说法）')
  ok(GF('群里好几个人在准备考研')?.source === '推测', 'PROMOTE：升级为长期记忆')
  ok(!GF('群里的旧梗是放鸽子') && readArchiveFull(store.memDirOf(G)).some((a) => a.text === '群里的旧梗是放鸽子' && a.demotedAt), 'DEMOTE：转进归档（翻旧账还能找到）')
  const logC = memDeep.consolidate.list(G)
  ok(logC.length === 4 && logC.every((e) => e.status === '已执行' && e.summary && Array.isArray(e.before) && Array.isArray(e.after)) && existsSync(join(store.memDirOf(G), 'consolidation.jsonl')), '每一处改动都写进 consolidation.jsonl：改之前、改之后、原因')
  for (const e of logC) ok(memDeep.consolidate.undo(G, e.id).ok, '撤销：' + e.op)
  ok(GF('大刘爱吃重庆火锅') && GF('大刘超爱吃火锅') && GF('大刘在减肥') && GF('群里的旧梗是放鸽子') && !GF('群里好几个人在准备考研') && !GF('大刘超爱吃火锅，尤其是重庆火锅') && GF('大刘减肥期间天天吃火锅').confidence === undefined, '每一处都能一键撤销，撤销后回到原样（把握度也恢复成缺省）')
  ok(!memDeep.consolidate.undo(G, logC[0].id).ok, '撤销过的不能再撤销')
  ok(ai.searchMemory(G, '放鸽子', 5).filter((h) => h.text === '群里的旧梗是放鸽子').length === 1, '翻旧账：撤销后恢复的记忆不和归档里的旧副本重复列')
  // 安全：★ 的不降级；合并 ★ 的要原因；每晚最多改 consolidateMaxOps 处
  reply = ({ system, user }) => {
    if (!system.includes('整理自己的记忆')) return '无'
    return [`DEMOTE|${num(user, '大刘爱吃重庆火锅')}`, `MERGE|${num(user, '大刘爱吃重庆火锅')},${num(user, '大刘超爱吃火锅')}|合并`, `KEEP|${num(user, '大刘在减肥')},${num(user, '大刘减肥期间天天吃火锅')}|不确定`].join('\n')
  }
  const starF = GF('大刘爱吃重庆火锅')
  store.updateFact(G, starF.id, { importance: 4 })
  const run2 = await memDeep.consolidate.run(G)
  ok(GF('大刘爱吃重庆火锅') && GF('大刘超爱吃火锅'), '重要度 ≥ 4 的：不降级；没写原因不合并')
  ok(memDeep.consolidate.list(G).some((e) => e.op === 'KEEP' && e.status === '不处理') && run2.kept === 1, 'KEEP：记下不处理')
  // 只出建议模式
  config.consolidateMode = 'suggest'
  store.updateFact(G, GF('大刘爱吃重庆火锅').id, { importance: 3 })
  reply = ({ system, user }) => (system.includes('整理自己的记忆') ? `MERGE|${num(user, '大刘爱吃重庆火锅')},${num(user, '大刘超爱吃火锅')}|大刘爱吃火锅` : '无')
  const run3 = await memDeep.consolidate.run(G)
  const sug = memDeep.consolidate.list(G).find((e) => e.status === '待确认')
  ok(run3.pending === 1 && sug && GF('大刘爱吃重庆火锅'), '只出建议模式：不改记忆，列为待确认')
  ok(memDeep.consolidate.apply(G, sug.id).ok && GF('大刘爱吃火锅') && !GF('大刘爱吃重庆火锅'), '在面板确认执行')
  config.consolidateMode = 'apply'
  config.consolidateMaxOps = 1
  memDeep.consolidate.undo(G, sug.id)
  add('群里的冷知识一号', { importance: 1, at: Date.now() - 40 * DAY })
  reply = ({ system, user }) => (system.includes('整理自己的记忆') ? [`DEMOTE|${num(user, '群里的旧梗是放鸽子')}`, `DEMOTE|${num(user, '群里的冷知识一号')}`].join('\n') : '无')
  const run4 = await memDeep.consolidate.run(G)
  ok(run4.done === 1, '每晚最多改 consolidateMaxOps 处')
  config.consolidateMaxOps = 10
  // 没有候选就不调模型
  const H = '30003'
  config.memoryRooms.push(H)
  rooms.set(H, { roomId: H, isGroup: true, msgs: [], seen: new Set(), nameCache: new Map() })
  store.addFact(H, '只有一条普通的记忆', Date.now(), { importance: 3 })
  gens.length = 0
  const run5 = await memDeep.consolidate.run(H)
  ok(run5.skipped && gens.length === 0, '没有候选就不调模型')

  /* ─────────────── 12. 第 8 项：偶尔主动想起往事 ─────────────── */
  const R = '40004'
  config.memoryRooms.push(R)
  const rr = { roomId: R, roomName: '往事群', isGroup: true, msgs: [], seen: new Set(), nameCache: new Map() }
  rooms.set(R, rr)
  const addR = (t, x = {}) => store.addFact(R, t, x.at || Date.now(), { noMerge: true, ...x })
  addR('小美养了一只布偶猫叫雪球', { importance: 3, at: Date.now() - 20 * DAY })
  addR('小美的猫生病住院了', { importance: 3, emotion: '难过', intensity: 5, at: Date.now() - 20 * DAY })
  addR('小美好像喜欢猫爬架', { importance: 3, source: '推测', confidence: 2, at: Date.now() - 20 * DAY })
  addR('小美新买了猫粮', { importance: 3, at: Date.now() - 2 * DAY })
  addR('小美的猫很胖', { importance: 1, at: Date.now() - 20 * DAY })
  await mp.indexMemory(R)
  clock = Date.now()
  rr.msgs.push({ sender: '43', senderName: '小美', text: '我家喵今天又拆家了' })
  await mp.prepareSemantic(rr, '我家喵今天又拆家了')
  const rc = memDeep.recall
  const cands = rc.candidates(rr)
  ok(cands.length === 1 && cands[0].text === '小美养了一只布偶猫叫雪球', '候选：重要 + 14 天没用 + 和话题相关；排除难过强度 ≥ 4、把握度 ≤ 2、最近用过、不重要的')
  rnd = 0.5
  ok(rc.offer(rr, 'reply') === null, '被动回复按概率（默认 8%）：没抽中就不提')
  rnd = 0.01
  const off = rc.offer(rr, 'reply')
  ok(off && off.line === `如果自然，可以顺嘴提一句：小美养了一只布偶猫叫雪球（${'2 周前'}）。不自然就别提，别硬扯。`, '抽中：提示词加一句"如果自然，可以顺嘴提一句：…（多久以前）。不自然就别提，别硬扯。"')
  ok(rc.offer(rr, 'reply') === null, '每个会话冷却 12 小时')
  const notSaid = await rc.afterSend(rr, off, '哈哈拆家也太可爱了')
  ok(!notSaid && rc.history(R)[0].said === false, '回复里没提到：记下"没说出口"')
  const said = await rc.afterSend(rr, off, '雪球那只布偶猫又拆家啦')
  const snow = store.factsOf(R).find((f) => f.text === '小美养了一只布偶猫叫雪球')
  ok(said && rc.history(R)[0].said === true && Date.now() - snow.lastUsedAt < 5000, '说出口了：记一次被用到（新鲜度回满），记进「想起往事」')
  clock += 13 * 3600000
  ok(rc.candidates(rr).every((c) => c.text !== '小美养了一只布偶猫叫雪球'), '同一件事 30 天内不重复')
  // 难过的事：关掉"难过的事不主动提"才会提
  config.recallAvoidSad = false
  ok(rc.candidates(rr).some((c) => c.text === '小美的猫生病住院了'), '关掉"难过的事不主动提"后，强烈难过的事也可能想起')
  config.recallAvoidSad = true
  // 别主动提
  rc.mute(R, 'fact:' + store.factsOf(R).find((f) => f.text === '小美的猫生病住院了').id, true)
  config.recallAvoidSad = false
  ok(!rc.candidates(rr).some((c) => c.text === '小美的猫生病住院了'), '面板设成"别主动提"的不提')
  config.recallAvoidSad = true
  // 特别的日子：生日临近，不看话题
  const bday = new Date(clock + 2 * DAY)
  addR(`阿琳的生日是${bday.getMonth() + 1}月${bday.getDate()}日`, { importance: 5, at: Date.now() - 30 * DAY })
  rr.msgs.push({ sender: '9', senderName: '路人', text: '今天天气不错' })
  await mp.prepareSemantic(rr, '今天天气不错')
  const sp8 = rc.candidates(rr)
  ok(sp8[0]?.special === '生日临近' && sp8[0].text.startsWith('阿琳的生日'), '特别的日子（生日临近）优先，不看话题')
  // 主动说话：不掷概率，优先拿往事当话头，替代"饿不饿"
  rnd = 0.99
  const sch = createScheduler({
    config: { enabled: true, pollMs: 0 }, rooms: new Map([[R, Object.assign(rr, { replyTimes: [], lastActivityAt: 1, lastProactiveAt: 0, flushing: false })]]),
    cfgFor: () => ({ proactive: true, proactiveChance: 1, proactiveIdleMs: 0, proactiveMinGapMs: 0, proactiveHours: '00:00-23:59', maxRepliesPer10Min: 200, quietHours: '', humanize: false }),
    allowedHere: () => true, isQuiet: () => false, quietWindowsFor: () => [], buildTranscript: () => '', humanizeText: (t) => t, systemPrompt: () => 'SYS',
    generate: async ({ user }) => { gens.push({ user }); return { text: '对了阿琳生日快到了吧' } },
    sendReply: async () => ['x'], log, safeTick: (n, f) => f, timers: { add() {}, delete() {} }, pollOnce: () => {}, privateTargets: () => [],
    recallFor: (r) => rc.offer(r, 'proactive'), afterRecall: (r, o, t) => rc.afterSend(r, o, t),
  })
  clock += 13 * 3600000
  gens.length = 0
  sch.proactiveTick()
  await tick(60)
  ok(gens[0]?.user.includes('你突然想起一件往事：阿琳的生日') && gens[0].user.includes('别老问饿不饿'), '主动说话：不掷概率，优先拿想起的往事当话头（替代"饿不饿"）')
  ok(rc.history(R)[0].said === true, '主动说话提到了也记进「想起往事」')
  // 纪念日
  const rs = memDeep.story
  rs.onMessage(rr, { sender: '43', senderName: '小美', text: '嗨' }, false)
  clock += 13 * 3600000
  rs.readStory(R, '43').firstSeenAt = clock - 100 * DAY
  ok(rc.candidates(rr).some((c) => c.special === '纪念日' && c.text.includes('认识满 100 天')), '纪念日（认识满 100 天）是可以顺嘴一提的候选')
  config.recallEnabled = false
  clock += 13 * 3600000
  rnd = 0
  ok(rc.offer(rr, 'reply') === null, '关掉就完全不提')
  config.recallEnabled = true

  /* ─────────────── 13. 每晚任务（04:30 整理 → 05:00 反思，每天一次） ─────────────── */
  const N = '50005'
  config.memoryRooms.splice(0, config.memoryRooms.length, N)
  rooms.set(N, { roomId: N, isGroup: true, msgs: [], seen: new Set(), nameCache: new Map() })
  store.addFact(N, '阿强在学吉他', Date.now(), { importance: 3 })
  store.addFact(N, '阿强学吉他很认真', Date.now(), { importance: 3, noMerge: true })
  const tasks = []
  reply = ({ system }) => {
    if (system.includes('整理自己的记忆')) tasks.push('整理')
    if (system.includes('善于观察')) tasks.push('反思')
    return '无'
  }
  config.reflectMinNew = 1
  await mp.indexMemory(N)
  clock = new Date(2026, 10, 10, 4, 20).getTime()
  await memDeep.nightlyTick()
  ok(tasks.length === 0, '04:20：还没到点')
  clock = new Date(2026, 10, 10, 4, 35).getTime()
  await memDeep.nightlyTick()
  ok(tasks.join() === '整理', '04:35：每晚整理（有候选才调模型）')
  await memDeep.nightlyTick()
  ok(tasks.join() === '整理', '同一天不重复整理')
  clock = new Date(2026, 10, 10, 5, 5).getTime()
  await memDeep.nightlyTick()
  ok(tasks.join() === '整理,反思', '05:05：反思归纳（在整理之后）')
  await memDeep.nightlyTick()
  ok(tasks.join() === '整理,反思', '同一天不重复反思')
  clock = new Date(2026, 10, 11, 6, 0).getTime()
  config.consolidateEnabled = false
  config.reflectEnabled = false
  await memDeep.nightlyTick()
  ok(tasks.join() === '整理,反思', '关掉每晚整理 / 反思归纳就不跑、不花钱')
  config.consolidateEnabled = true
  config.reflectEnabled = true

  /* ─────────────── 14. 面板接口 ─────────────── */
  config.memoryRooms.push('900001', G, R, '10001')
  const api = createMemPlusApi({
    config, getMemPlus: () => mp, getEmbedder: () => emb, getChatLog: () => null, isManagedRoom: store.isManagedRoom, factsOf: store.factsOf,
    updateFact: store.updateFact, deleteFactById: store.deleteFactById, scoreFacts: store.scoreFacts, extractFacts: ai.extractFacts,
    roomState: (id) => rooms.get(String(id)), log, getMemDeep: () => memDeep, store,
  })
  const fv = await api('facts', { room: '900001' })
  const fx = fv.facts.find((f) => f.text === '阿杰上次减肥失败难过了好几天')
  ok(fx && fx.emotion === '难过' && fx.intensity === 4 && fx.source === '别人说' && fx.confidence === 3 && fv.sources.includes('推测'), '记忆明细：情绪 / 来源 / 把握度')
  ok(fv.facts.find((f) => f.text === '阿杰第二次开始减肥了').versions === 2 && fv.facts.find((f) => f.text === '小王养了一只橘猫').links >= 1, '记忆明细：变化（版本数）/ 联想数')
  const up = await api('fact.update', { room: '900001', id: fx.id, emotion: '生气', intensity: 3, source: '推测', confidence: 5 })
  ok(up.fact.emotion === '生气' && up.fact.source === '推测' && up.fact.confidence === 3, '面板手动改情绪 / 来源 / 把握度（推测最高 3）')
  ok((await api('chain', { room: '900001', id: F('阿杰第二次开始减肥了').id })).nodes.length === 3, '点开变化：时间轴')
  ok((await api('links', { room: '900001', id: F('小王养了一只橘猫').id })).links.some((l) => l.reason), '点开联想：连着哪些、为什么连')
  const why = await api('why', { room: '900001', query: '橘猫', limit: 1 })
  ok(why.items.some((x) => x.assoc), '「下次会带哪些」标出联想带进来的')
  ok((await api('insights.list', { room: '10001' })).items.some((x) => x.evidence.length && 'exists' in x.evidence[0]), '💡 理解：依据可以点开看原始记忆')
  ok((await api('consolidate.list', { room: G })).items.length >= 4, '🧹 整理记录')
  ok(Array.isArray((await api('recall.list', { room: R })).log), '💭 想起往事记录')
  ok((await api('story.add', { room: '900001', who: '50', type: '特别的时刻', text: '面板加的' })).milestone.by === '手动', '人物卡里手动加故事节点')
  ok((await api('people.list', { room: '900001' })).people.some((p) => p.who === '50' && p.story > 0), '人物卡列表带上有故事的人')
  const stt = await api('status', { room: '900001' })
  ok(stt.deep && typeof stt.deep.links === 'number' && stt.deep.insights, '状态带上记忆深度的统计')

  /* ─────────────── 15. 只读实例一律不写 ─────────────── */
  const ro = createMemDeep({ config, log, generate, store, rooms, getEmbedder: () => emb, getMemPlus: () => mp, now, isReadOnly: () => true })
  const before2 = readFileSync(join(store.memDirOf('900001'), 'story', '50.json'), 'utf8')
  ro.story.onMessage(room, { sender: '50', senderName: '小周', text: '你真棒' }, true)
  ok(!ro.story.addMilestone('900001', '50', { type: '约定', text: '只读', by: '手动' }) && readFileSync(join(store.memDirOf('900001'), 'story', '50.json'), 'utf8') === before2, '只读实例：故事不写')
  ok(!(await ro.insights.reflect('10001', { force: true })).ok && !(await ro.consolidate.run(G)).ok && (await ro.nightlyTick()).skipped, '只读实例：反思 / 整理 / 每晚任务都不跑')
  store.setOnChange(null)
} finally {
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-memory-deep.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-memory-deep.mjs 通过 ${pass} 项，失败 0 项`)
