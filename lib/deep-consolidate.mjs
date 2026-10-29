/**
 * 记忆深化第 6 项：每晚整理。像睡觉时整理记忆一样：去重、消矛盾、升级、降级。
 *
 * 每晚 consolidateHour:30（默认 04:30，在每日摘要之后、反思之前）。先用程序找候选，没有候选就不调模型：
 *   重复    语义相似度 ≥ 0.85，或者字面相似度 ≥ 0.6
 *   矛盾    同一个人、话题相近（相似度 0.5~0.85）、但内容不同
 *   该升级  最近 7 天的每日摘要里出现 ≥ 3 天、但长期记忆里没有的话题
 *   该降级  重要度 ≤ 2、强度 ≤ 2、超过 30 天没被用过、没有被认识或故事引用
 * 然后一次模型调用，只交候选：
 *   MERGE|编号,编号|合并后的事实          RESOLVE|保留编号|作废编号|原因
 *   PROMOTE|QQ号或群|重要度|情绪/强度|事实  DEMOTE|编号      KEEP|编号,编号|原因（不处理）
 * 通过记忆存储执行（保留变化线和归档）。每一处改动都写进 consolidation.jsonl（改之前、改之后、原因），都能撤销。
 *
 * 安全：重要度 ≥ 4 或强度 ≥ 4 的记忆不会被降级；要合并或作废它们，模型必须给出原因。每晚最多改 consolidateMaxOps 处。
 * consolidateMode = suggest 时只出建议（状态"待确认"），在面板逐条执行或忽略。
 */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { atomicWriteText } from './store.mjs'
import { cosine, normalizeSim } from './embed.mjs'
import { DAY, emotionOf, confidenceOf, clampConfidence, parseEmotion, bigramSet, localDay, addDays, clampInt, textSim } from './memory-deep.mjs'

const DUP_SEM = 0.85
const DUP_LIT = 0.6
const CON_LO = 0.5
const CON_HI = 0.85
const TOPIC_SIM = 0.5
const TOPIC_DAYS = 3
const DEMOTE_DAYS = 30
const MAX_PAIRS = 8
const MAX_TOPICS = 3
const MAX_DEMOTE = 8
/** 字面上的常见字组：找"该升级的话题"时不算（没有语义模型时的退路） */
const STOP_BIGRAMS = new Set(['大家', '我们', '今天', '聊了', '一起', '什么', '没有', '还是', '就是', '这个', '那个', '一下', '有人', '觉得', '说了', '时候', '然后', '他们', '自己', '已经', '可以', '因为', '所以', '还有', '一些', '起来', '的人', '了一', '在聊', '聊天', '群里', '讨论', '话题', '表示', '提到', '分享', '一个', '不是', '知道', '如果', '但是', '开始'])

const isStar = (f) => (Number(f?.importance) || 2) >= 4 || emotionOf(f).intensity >= 4

/**
 * 解析一行整理指令。
 * @param {Map<number,string>} idOf 编号 → 事实 id
 * @param {Map<string,string>} names 允许的 QQ 号 → 昵称
 */
export function parseConsolidateLine(s, idOf, names) {
  const raw = String(s || '').replace(/^\s*(?:[-•*]\s*|\d{1,2}\s*[.、)）]\s+)/, '').trim()
  if (!raw || raw === '无') return null
  const parts = raw.split(/\s*[|｜]\s*/)
  const op = String(parts[0] || '').toUpperCase()
  const ids = (v) => {
    const out = []
    for (const m of String(v || '').matchAll(/\d{1,4}/g)) {
      const id = idOf.get(Number(m[0]))
      if (id && !out.includes(id)) out.push(id)
    }
    return out
  }
  if (op === 'MERGE' && parts.length >= 3) {
    const list = ids(parts[1])
    const text = String(parts[2] || '').trim()
    if (list.length < 2 || !text) return null
    return { op, ids: list, text: text.slice(0, 200), reason: parts.slice(3).join(' ').trim().slice(0, 80) }
  }
  if (op === 'RESOLVE' && parts.length >= 3) {
    const keep = ids(parts[1])[0]
    const drop = ids(parts[2])[0]
    if (!keep || !drop || keep === drop) return null
    return { op, keep, drop, reason: parts.slice(3).join(' ').trim().slice(0, 80) }
  }
  if (op === 'PROMOTE' && parts.length >= 5) {
    const whoRaw = String(parts[1] || '').replace(/[()（）\s「」]/g, '')
    const text = parts.slice(4).join('｜').trim()
    if (!text || text === '无') return null
    if (whoRaw !== '群' && !names.has(whoRaw)) return { op, error: '对象不在记录里：' + whoRaw }
    const e = parseEmotion(parts[3])
    return {
      op, who: whoRaw === '群' ? '' : whoRaw, whoName: whoRaw === '群' ? '' : names.get(whoRaw) || '',
      importance: clampInt(parts[2], 1, 5, 3), emotion: e.emotion, intensity: e.intensity, text: text.slice(0, 200),
    }
  }
  if (op === 'DEMOTE' && parts.length >= 2) {
    const id = ids(parts[1])[0]
    return id ? { op, id } : null
  }
  if (op === 'KEEP' && parts.length >= 2) {
    const list = ids(parts[1])
    return list.length ? { op, ids: list, reason: parts.slice(2).join(' ').trim().slice(0, 80) } : null
  }
  return null
}

export function createConsolidate({ config, log, generate, store, getMemPlus, getEmbedder, insights, story, rooms, isReadOnly = () => false, now = () => Date.now(), patchMeta }) {
  function fileOf(dir) {
    return join(dir, 'consolidation.jsonl')
  }
  function read(roomId) {
    const dir = store.memDirOf(roomId)
    if (!dir) return []
    let raw = ''
    try {
      raw = readFileSync(fileOf(dir), 'utf8')
    } catch {
      return []
    }
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  }
  function write(roomId, entries) {
    const dir = store.memDirOf(roomId)
    if (!dir || isReadOnly()) return
    const keep = entries.slice(-1000)
    atomicWriteText(fileOf(dir), keep.map((e) => JSON.stringify(e)).join('\n') + '\n')
  }

  const semOn = () => {
    const emb = getEmbedder()
    return !!config.semanticSearch && !!emb?.isReady?.() && typeof emb.vecOf === 'function' ? emb : null
  }
  /** 允许的对象（PROMOTE 写 QQ 号时） */
  function namesOf(roomId) {
    const names = new Map()
    for (const f of store.factsOf(roomId)) if (f.who) names.set(String(f.who), f.whoName || names.get(String(f.who)) || '')
    for (const m of rooms.get(String(roomId))?.msgs || []) if (!m.isSelf && m.sender) names.set(String(m.sender), m.senderName || names.get(String(m.sender)) || '')
    return names
  }

  /** 最近 7 天的每日摘要里出现 ≥ 3 天、长期记忆里没有的话题 */
  async function topicsOf(roomId, facts) {
    const today = localDay(new Date(now()))
    const since = addDays(today, -7)
    const days = (getMemPlus()?.recentDailies?.(roomId, 8) || []).filter((d) => d.day >= since && d.day < today && d.text)
    if (days.length < TOPIC_DAYS) return []
    const sents = []
    for (const d of days) {
      for (const s of String(d.text).split(/[。！？!?；;\n]+/)) {
        const t = s.trim()
        if (t.length >= 6) sents.push({ day: d.day, text: t })
      }
    }
    const emb = semOn()
    const out = []
    if (emb) {
      const base = emb.baseline()
      for (const s of sents) {
        try {
          s.vec = (await emb.embed([s.text]))[0]
        } catch {
          s.vec = null
        }
      }
      const fvecs = facts.map((f) => emb.vecOf(roomId, f.text)).filter(Boolean)
      const sim = (a, b) => normalizeSim(cosine(a, b), base)
      const cands = []
      for (const s of sents) {
        if (!s.vec) continue
        const ds = new Set([s.day])
        for (const o of sents) if (o.day !== s.day && o.vec && sim(s.vec, o.vec) >= TOPIC_SIM) ds.add(o.day)
        if (ds.size < TOPIC_DAYS) continue
        if (fvecs.some((v) => sim(s.vec, v) >= TOPIC_SIM)) continue
        cands.push({ text: s.text, days: [...ds].sort(), vec: s.vec })
      }
      cands.sort((a, b) => b.days.length - a.days.length)
      for (const c of cands) {
        if (out.length >= MAX_TOPICS) break
        if (out.some((x) => sim(x.vec, c.vec) >= TOPIC_SIM)) continue
        out.push(c)
      }
      return out.map(({ text, days: ds }) => ({ text, days: ds }))
    }
    // 没有语义模型：按字组出现在几天的摘要里
    const factGrams = new Set()
    for (const f of facts) for (const g of bigramSet(f.text)) factGrams.add(g)
    const dayOf = new Map()
    for (const d of days) {
      for (const g of bigramSet(d.text)) {
        if (STOP_BIGRAMS.has(g) || /^\d+$/.test(g) || factGrams.has(g)) continue
        if (!dayOf.has(g)) dayOf.set(g, new Set())
        dayOf.get(g).add(d.day)
      }
    }
    const grams = [...dayOf.entries()].filter(([, ds]) => ds.size >= TOPIC_DAYS).sort((a, b) => b[1].size - a[1].size)
    for (const [g, ds] of grams) {
      if (out.length >= MAX_TOPICS) break
      const s = sents.find((x) => bigramSet(x.text).has(g))
      if (!s || out.some((x) => x.text === s.text || textSim(x.text, s.text) >= 0.5)) continue
      out.push({ text: s.text, days: [...ds].sort() })
    }
    return out
  }

  /** 程序找候选 */
  async function candidates(roomId) {
    const k = String(roomId)
    const facts = store.factsOf(k)
    const emb = semOn()
    const base = emb ? emb.baseline() : 0.3
    const vec = new Map(facts.map((f) => [f.id, emb ? emb.vecOf(k, f.text) : null]))
    const grams = new Map(facts.map((f) => [f.id, bigramSet(f.text)]))
    const lit = (a, b) => {
      const A = grams.get(a.id)
      const B = grams.get(b.id)
      if (!A.size || !B.size) return 0
      let inter = 0
      for (const x of A) if (B.has(x)) inter += 1
      return inter / (A.size + B.size - inter)
    }
    const dup = []
    const con = []
    for (let i = 0; i < facts.length; i++) {
      for (let j = i + 1; j < facts.length; j++) {
        const a = facts[i]
        const b = facts[j]
        const va = vec.get(a.id)
        const vb = vec.get(b.id)
        const sem = va && vb ? normalizeSim(cosine(va, vb), base) : null
        const l = lit(a, b)
        if ((sem != null && sem >= DUP_SEM) || l >= DUP_LIT) dup.push({ a, b, sem, lit: l })
        else if (a.who && a.who === b.who && sem != null && sem >= CON_LO && sem < CON_HI) con.push({ a, b, sem, lit: l })
      }
    }
    dup.sort((x, y) => Math.max(y.sem ?? 0, y.lit) - Math.max(x.sem ?? 0, x.lit))
    con.sort((x, y) => y.sem - x.sem)
    const t = now()
    const refIds = new Set()
    for (const x of insights.load(k)) if (x.status !== '已撤回') for (const id of x.evidence || []) refIds.add(id)
    const stories = story.allMilestones(k).map((m) => m.text)
    const demote = facts
      .filter((f) => (Number(f.importance) || 2) <= 2 && emotionOf(f).intensity <= 2 && !isStar(f))
      .filter((f) => t - Math.max(Number(f.lastUsedAt) || 0, Number(f.at) || 0) > DEMOTE_DAYS * DAY)
      .filter((f) => !refIds.has(f.id) && !stories.some((s) => textSim(s, f.text) >= 0.6))
      .sort((a, b) => Math.max(Number(a.lastUsedAt) || 0, Number(a.at) || 0) - Math.max(Number(b.lastUsedAt) || 0, Number(b.at) || 0))
      .slice(0, MAX_DEMOTE)
    const topics = await topicsOf(k, facts)
    return { dup: dup.slice(0, MAX_PAIRS), con: con.slice(0, MAX_PAIRS), topics, demote }
  }

  /* ───────────── 执行 / 撤销 ───────────── */

  const active = (k, id) => store.factsOf(k).find((f) => f.id === String(id))
  const normOf = (t) => store.factNorm(t)

  /** 执行一条改动；成功返回 { before, after }，失败返回 { error } */
  function exec(k, o) {
    const t = now()
    if (o.op === 'MERGE') {
      const olders = o.ids.map((id) => active(k, id))
      if (olders.some((f) => !f) || olders.length < 2) return { error: '要合并的记忆已经不在了' }
      if (olders.some(isStar) && !o.reason) return { error: '合并重要 / 情绪强的记忆必须写原因' }
      const ids = new Set(o.ids)
      if (store.factsOf(k).some((f) => !ids.has(f.id) && normOf(f.text) === normOf(o.text))) return { error: '合并后的内容和另一条记忆重复' }
      const base = olders.slice().sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))[0]
      const whos = new Set(olders.map((f) => f.who || ''))
      const strongest = olders.slice().sort((a, b) => emotionOf(b).intensity - emotionOf(a).intensity)[0]
      const said = olders.find((f) => f.source === '亲口说') || base
      const dues = olders.filter((f) => f.due && !f.followedAt).map((f) => f.due).sort()
      const merged = store.makeFact(o.text, {
        importance: Math.max(...olders.map((f) => Number(f.importance) || 2)),
        who: whos.size === 1 ? [...whos][0] : '',
        whoName: whos.size === 1 ? olders.find((f) => f.whoName)?.whoName || '' : '',
        due: dues[0] || '',
        uses: olders.reduce((s, f) => s + (Number(f.uses) || 0), 0),
        lastUsedAt: Math.max(...olders.map((f) => Number(f.lastUsedAt) || 0)),
        chainId: base.chainId || base.id,
        prev: base.id,
        emotion: emotionOf(strongest).emotion,
        intensity: emotionOf(strongest).intensity,
        ...(said.source ? { source: said.source, sourceBy: said.sourceBy, sourceByName: said.sourceByName, sourceTs: said.sourceTs } : {}),
        confidence: Math.max(...olders.map(confidenceOf)),
      })
      const res = store.commit(k, { remove: olders.map((f) => ({ id: f.id, mark: { supersededAt: t, supersededBy: merged.id, mergedAt: t } })), add: [merged] })
      return { before: res.removed, after: res.added }
    }
    if (o.op === 'RESOLVE') {
      const kept = active(k, o.keep)
      const drop = active(k, o.drop)
      if (!kept || !drop) return { error: '记忆已经不在了' }
      if ((isStar(drop) || isStar(kept)) && !o.reason) return { error: '作废重要 / 情绪强的记忆必须写原因' }
      // 出现矛盾说法：留下的那条把握度 −1
      const conf = clampConfidence(confidenceOf(kept) - 1, kept.source || '')
      const res = store.commit(k, {
        remove: [{ id: drop.id, mark: { voidedAt: t, voidReason: o.reason || '和另一条矛盾', supersededAt: t, supersededBy: kept.id } }],
        patch: [{ id: kept.id, set: { confidence: conf } }],
      })
      return { before: [...res.removed, ...res.patched.map((p) => p.before)], after: res.patched.map((p) => p.after) }
    }
    if (o.op === 'PROMOTE') {
      if (store.factsOf(k).some((f) => normOf(f.text) === normOf(o.text))) return { error: '已经有这条记忆了' }
      // 从每日摘要升级来的：记录里没有直接说法，来源算推测
      const f = store.makeFact(o.text, { importance: o.importance, who: o.who, whoName: o.whoName, emotion: o.emotion, intensity: o.intensity, source: '推测' })
      const res = store.commit(k, { add: [f] })
      return res.added.length ? { before: [], after: res.added } : { error: '没加进去' }
    }
    if (o.op === 'DEMOTE') {
      const f = active(k, o.id)
      if (!f) return { error: '记忆已经不在了' }
      if (isStar(f)) return { error: '重要度 ≥ 4 或强度 ≥ 4 的记忆不降级' }
      const res = store.commit(k, { remove: [{ id: f.id, mark: { demotedAt: t } }] })
      return { before: res.removed, after: [] }
    }
    return { error: '不认识的操作' }
  }

  function describe(o, factsById) {
    const txt = (id) => factsById.get(id)?.text || id
    if (o.op === 'MERGE') return `合并：${o.ids.map(txt).join(' + ')} → ${o.text}`
    if (o.op === 'RESOLVE') return `矛盾：留「${txt(o.keep)}」，作废「${txt(o.drop)}」`
    if (o.op === 'PROMOTE') return `升级为长期记忆：${o.text}`
    if (o.op === 'DEMOTE') return `降级（转进归档）：${txt(o.id)}`
    if (o.op === 'KEEP') return `不处理：${o.ids.map(txt).join(' / ')}`
    return o.op
  }

  /** 整理一次（每晚一次由 deep.mjs 的定时任务控制；面板"立即整理"直接调） */
  async function run(roomId) {
    const k = String(roomId)
    const dir = store.memDirOf(k)
    if (!dir) return { ok: false, error: '该会话不在记忆托管名单里' }
    if (isReadOnly()) return { ok: false, error: '只读实例不写数据' }
    const c = await candidates(k)
    const total = c.dup.length + c.con.length + c.topics.length + c.demote.length
    patchMeta(dir, { consolidatedAt: now() })
    if (!total) {
      log(`每晚整理：${k} 没有候选，不调模型`)
      return { ok: true, skipped: '没有候选', candidates: 0 }
    }
    const shown = []
    const add = (f) => {
      if (!shown.includes(f)) shown.push(f)
    }
    for (const p of [...c.dup, ...c.con]) {
      add(p.a)
      add(p.b)
    }
    for (const f of c.demote) add(f)
    const idOf = new Map()
    const numOf = new Map()
    shown.forEach((f, i) => {
      idOf.set(i + 1, f.id)
      numOf.set(f.id, i + 1)
    })
    const ago = (f) => {
      const d = Math.floor((now() - (Number(f.at) || 0)) / DAY)
      return d <= 0 ? '今天' : d + ' 天前'
    }
    const factLine = (f) => {
      const { emotion, intensity } = emotionOf(f)
      const tags = [f.whoName || f.who ? '关于 ' + (f.whoName || f.who) : '关于 群', '重要度 ' + (Number(f.importance) || 2), emotion !== '平静' ? `${emotion}/${intensity}` : '', f.source || '', ago(f)].filter(Boolean)
      return `[${numOf.get(f.id)}] ${isStar(f) ? '★ ' : ''}${f.text}（${tags.join('｜')}）`
    }
    const n = (f) => `[${numOf.get(f.id)}]`
    const names = namesOf(k)
    const r = rooms.get(k)
    const where = r?.isGroup === false ? '私聊' : '群'
    const user = [
      `你在睡前整理这个${where}的长期记忆。下面只列出了程序找出来的候选，不是全部记忆。`,
      '',
      '相关的记忆（编号 + 内容；★ = 重要度 ≥ 4 或情绪强度 ≥ 4）：',
      shown.map(factLine).join('\n'),
      '',
      '候选：',
      c.dup.length ? '重复（可能是同一件事）：' + c.dup.map((p) => `${n(p.a)} 和 ${n(p.b)}`).join('；') : '',
      c.con.length ? '矛盾（同一个人、话题相近、说法不同）：' + c.con.map((p) => `${n(p.a)} 和 ${n(p.b)}`).join('；') : '',
      c.topics.length ? '该升级的话题（最近 7 天的每日摘要里出现了 3 天以上，长期记忆里还没有）：\n' + c.topics.map((x) => `- ${x.text}（出现在 ${x.days.map((d) => d.slice(5)).join('、')}）`).join('\n') : '',
      c.demote.length ? '该降级的（不重要、情绪不强、30 天以上没被用过）：' + c.demote.map(n).join(' ') : '',
      '',
      '输出整理指令，每行一条，只能用这五种格式：',
      'MERGE|编号,编号|合并后的事实',
      'RESOLVE|保留编号|作废编号|原因',
      'PROMOTE|QQ号或群|重要度|情绪/强度|事实',
      'DEMOTE|编号',
      'KEEP|编号,编号|原因（不处理）',
      '规则：',
      '- 重复的：真是同一件事就 MERGE，写出合并后的完整句子（保留两边的细节）；不是就 KEEP。',
      '- 矛盾的：能判断哪个是对的（通常是更新的说法）就 RESOLVE；判断不了就 KEEP。',
      `- 该升级的话题：值得长期记住就 PROMOTE，写成一句完整的事实、写出人名；QQ号写话题主要关于谁（记录里的人：${[...names.entries()].map(([id, nm]) => id + (nm ? '（' + nm + '）' : '')).join('、') || '无'}），关于大家写「群」。不值得就不写。`,
      '- 该降级的：确实不重要了就 DEMOTE（转进归档，翻旧账还能找到）；还有用就 KEEP。',
      '- 标 ★ 的不能降级；要 MERGE 或 RESOLVE 标 ★ 的，必须写原因（MERGE 在末尾加 |原因）。',
      '- 情绪/强度从 开心、难过、生气、感动、害怕、尴尬、期待、平静 里选，如 开心/2。',
      '- 不要编造，不要改动没列出来的记忆。没有要改的就只输出「无」。',
    ]
      .filter((x) => x !== '')
      .join('\n')
    const { text } = await generate({ system: '你在整理自己的记忆，只输出整理指令，每行一条。', user, maxTokens: 900, temperature: 0.2 })
    const shownIds = new Set(shown.map((f) => f.id))
    const factsById = new Map(shown.map((f) => [f.id, f]))
    const mode = config.consolidateMode === 'suggest' ? 'suggest' : 'apply'
    const maxOps = Math.max(1, Math.min(50, Number(config.consolidateMaxOps) || 10))
    const night = localDay(new Date(now()))
    const entries = read(k)
    let changes = 0
    const stats = { done: 0, pending: 0, kept: 0, rejected: 0 }
    let promotes = 0
    for (const line of String(text || '').split(/\r?\n/)) {
      const o = parseConsolidateLine(line, idOf, names)
      if (!o) continue
      if (o.error) {
        stats.rejected += 1
        continue
      }
      // 只能动列出来的记忆；升级的条数不超过候选话题数
      const touched = o.ids || [o.keep, o.drop, o.id].filter(Boolean)
      if (touched.some((id) => !shownIds.has(id))) {
        stats.rejected += 1
        continue
      }
      if (o.op === 'PROMOTE' && ++promotes > c.topics.length) {
        stats.rejected += 1
        continue
      }
      const base = { id: 'c' + randomUUID().slice(0, 7), night, at: now(), op: o.op, reason: o.reason || '', summary: describe(o, factsById), args: o }
      if (o.op === 'KEEP') {
        entries.push({ ...base, status: '不处理', before: o.ids.map((id) => factsById.get(id)).filter(Boolean), after: [] })
        stats.kept += 1
        continue
      }
      if (changes >= maxOps) {
        stats.rejected += 1
        continue
      }
      if (o.op === 'DEMOTE' && isStar(factsById.get(o.id))) {
        stats.rejected += 1
        continue
      }
      changes += 1
      if (mode === 'suggest') {
        entries.push({ ...base, status: '待确认', before: touched.map((id) => factsById.get(id)).filter(Boolean), after: [] })
        stats.pending += 1
        continue
      }
      const res = exec(k, o)
      if (res.error) {
        entries.push({ ...base, status: '没执行', error: res.error, before: [], after: [] })
        stats.rejected += 1
        continue
      }
      entries.push({ ...base, status: '已执行', before: res.before, after: res.after })
      stats.done += 1
    }
    write(k, entries)
    log(`每晚整理：${r?.roomName || k} 候选 ${total} 个｜执行 ${stats.done}、待确认 ${stats.pending}、不处理 ${stats.kept}、丢弃 ${stats.rejected}`)
    return { ok: true, candidates: total, ...stats, mode }
  }

  /** 面板：整理记录（新的在前） */
  function list(roomId, limit = 300) {
    return read(roomId).slice(-limit).reverse()
  }

  /** 撤销一处已执行的改动 */
  function undo(roomId, entryId) {
    const k = String(roomId)
    if (isReadOnly()) return { ok: false, error: '只读实例不写数据' }
    const entries = read(k)
    const e = entries.find((x) => x.id === String(entryId))
    if (!e) return { ok: false, error: '没找到这条记录' }
    if (e.status !== '已执行') return { ok: false, error: '只有"已执行"的才能撤销' }
    const t = now()
    const stillThere = (f) => {
      const cur = active(k, f.id)
      return cur && normOf(cur.text) === normOf(f.text)
    }
    if (!(e.after || []).every(stillThere)) return { ok: false, error: '这处改动之后记忆又变过（被改或被删），不能直接撤销' }
    let res
    if (e.op === 'MERGE') res = store.commit(k, { remove: e.after.map((f) => ({ id: f.id, mark: { undoneAt: t } })), add: e.before })
    else if (e.op === 'RESOLVE') {
      const keptBefore = e.before.find((f) => e.after.some((a) => a.id === f.id))
      const dropped = e.before.filter((f) => !e.after.some((a) => a.id === f.id))
      res = store.commit(k, { add: dropped, patch: keptBefore ? [{ id: keptBefore.id, set: { confidence: keptBefore.confidence } }] : [] })
    } else if (e.op === 'PROMOTE') res = store.commit(k, { remove: e.after.map((f) => ({ id: f.id, mark: { undoneAt: t } })) })
    else if (e.op === 'DEMOTE') res = store.commit(k, { add: e.before })
    else return { ok: false, error: '这条不能撤销' }
    e.status = '已撤销'
    e.undoneAt = t
    write(k, entries)
    log(`每晚整理：撤销 ${e.summary}`)
    return { ok: true, restored: res?.added?.length || 0 }
  }

  /** 只出建议模式：执行一条建议 */
  function apply(roomId, entryId) {
    const k = String(roomId)
    if (isReadOnly()) return { ok: false, error: '只读实例不写数据' }
    const entries = read(k)
    const e = entries.find((x) => x.id === String(entryId))
    if (!e) return { ok: false, error: '没找到这条记录' }
    if (e.status !== '待确认') return { ok: false, error: '只有"待确认"的建议才能执行' }
    const res = exec(k, e.args)
    if (res.error) return { ok: false, error: res.error }
    Object.assign(e, { status: '已执行', before: res.before, after: res.after, appliedAt: now() })
    write(k, entries)
    return { ok: true }
  }
  /** 只出建议模式：忽略一条建议 */
  function dismiss(roomId, entryId) {
    const k = String(roomId)
    const entries = read(k)
    const e = entries.find((x) => x.id === String(entryId))
    if (!e) return { ok: false, error: '没找到这条记录' }
    if (e.status !== '待确认') return { ok: false, error: '只有"待确认"的建议才能忽略' }
    e.status = '已忽略'
    write(k, entries)
    return { ok: true }
  }

  return { candidates, run, list, undo, apply, dismiss, topicsOf }
}
