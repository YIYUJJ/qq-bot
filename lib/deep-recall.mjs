/**
 * 记忆深化第 8 项：偶尔主动想起往事。重要但很久没提的事，在合适的时候顺嘴提一句，并且因此记得更牢。
 *
 * 候选：重要度 ≥ 3 或强度 ≥ 3 的事实、认识、故事节点；并且至少 recallDormantDays 天没被用过；
 *       并且和当前聊天话题相关（语义相似度高于基线），或者今天是特别的日子（纪念日、生日临近、"一年前的今天"）。
 * 什么时候提（不额外调用模型）：
 *   被动回复：按概率 recallChance、每个会话冷却 recallCooldownHours、同一件事 30 天内不重复，在提示词里加一句
 *            "如果自然，可以顺嘴提一句：…（多久以前）。不自然就别提，别硬扯。"，提不提由模型决定。
 *   主动说话：优先拿一条想起的往事当话头，替代反复出现的"饿不饿"。
 * 强化：回复发出后检查有没有真的提到（语义相似度 + 关键词），提到了就记一次被用到（新鲜度回满），记进「想起往事」记录。
 * 分寸：难过、生气、尴尬类且强度 ≥ 4 的不主动提（recallAvoidSad）；把握度 ≤ 2 的不主动提；可以在面板设"别主动提"。
 *
 * 每个会话目录下 recall.json：{ lastAt, items: { key: 上次说出口的时间 }, muted: [key], log: [...] }
 */
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readJsonSafe, bm25Scores, bigramTokens } from './memory.mjs'
import { atomicWriteJson } from './store.mjs'
import { cosine, normalizeSim } from './embed.mjs'
import { DAY, SAD_EMOTIONS, emotionOf, confidenceOf, birthdaySoon, yearsAgoToday, localDay, agoText, textSim } from './memory-deep.mjs'

const HOUR = 3600000
const REPEAT_DAYS = 30 // 同一件事 30 天内不重复
const SAID_SIM = 0.4 // 回复和这件事的语义相似度（归一化）≥ 这个算提到了
const LOG_KEEP = 300

export function createRecall({ config, log, store, insights, story, getEmbedder, isReadOnly = () => false, now = () => Date.now(), random = Math.random }) {
  const cache = new Map() // dir -> state

  function fileOf(dir) {
    return join(dir, 'recall.json')
  }
  function load(roomId) {
    const dir = store.memDirOf(roomId)
    if (!dir) return null
    if (!cache.has(dir)) {
      const j = readJsonSafe(fileOf(dir), null)
      const st = j && typeof j === 'object' ? j : {}
      cache.set(dir, { lastAt: Number(st.lastAt) || 0, items: st.items && typeof st.items === 'object' ? st.items : {}, muted: Array.isArray(st.muted) ? st.muted : [], log: Array.isArray(st.log) ? st.log : [] })
    }
    return cache.get(dir)
  }
  function save(roomId) {
    const dir = store.memDirOf(roomId)
    if (!dir || isReadOnly()) return
    const st = load(roomId)
    st.log = st.log.slice(-LOG_KEEP)
    atomicWriteJson(fileOf(dir), st)
  }
  const semOn = () => {
    const emb = getEmbedder()
    return !!config.semanticSearch && !!emb?.isReady?.() ? emb : null
  }

  /**
   * 现在可以想起的往事（按：特别的日子优先，再按和话题的相关度）。
   * @param {object} r 会话（r.semVec 是 prepareSemantic 按当前话题算好的查询向量）
   */
  function candidates(r) {
    const k = String(r?.roomId || '')
    if (!k || !store.isManagedRoom(k)) return []
    const st = load(k)
    const t = now()
    const today = localDay(new Date(t))
    const dormant = Math.max(1, Number(config.recallDormantDays) || 14) * DAY
    const avoidSad = config.recallAvoidSad !== false
    const muted = new Set(st.muted)
    const sad = (x) => {
      const e = emotionOf(x)
      return avoidSad && SAD_EMOTIONS.has(e.emotion) && e.intensity >= 4
    }
    const recentlySaid = (key) => t - (Number(st.items[key]) || 0) < REPEAT_DAYS * DAY
    const pool = []
    for (const f of store.factsOf(k)) {
      const key = 'fact:' + f.id
      const { intensity } = emotionOf(f)
      if ((Number(f.importance) || 2) < 3 && intensity < 3) continue
      if (confidenceOf(f) <= 2 || sad(f) || muted.has(key) || recentlySaid(key)) continue
      if (t - Math.max(Number(f.lastUsedAt) || 0, Number(f.at) || 0) < dormant) continue
      const years = yearsAgoToday(f.at, today)
      const special = birthdaySoon(f, today) ? '生日临近' : years ? `${years} 年前的今天` : ''
      pool.push({ key, kind: '事实', refId: f.id, text: f.text, at: Number(f.at) || 0, special, who: f.who || '' })
    }
    if (config.reflectEnabled !== false) {
      for (const x of insights.activeOf(k)) {
        const key = 'insight:' + x.id
        if (confidenceOf(x) <= 2 || muted.has(key) || recentlySaid(key)) continue
        if (t - Math.max(Number(x.lastUsedAt) || 0, Number(x.updatedAt) || Number(x.createdAt) || 0) < dormant) continue
        const years = yearsAgoToday(x.createdAt, today)
        pool.push({ key, kind: '理解', refId: x.id, text: x.text, at: Number(x.createdAt) || 0, special: years ? `${years} 年前的今天` : '', who: /^\d+$/.test(String(x.about)) ? String(x.about) : '' })
      }
    }
    if (config.storyEnabled !== false) {
      for (const m of story.allMilestones(k)) {
        const key = `story:${m.who}:${m.id}`
        if (emotionOf(m).intensity < 3 || sad(m) || muted.has(key) || recentlySaid(key)) continue
        if (t - (Number(m.at) || 0) < dormant) continue
        const years = yearsAgoToday(m.at, today)
        pool.push({ key, kind: '故事', refId: m.id, text: m.text, at: Number(m.at) || 0, special: years ? `${years} 年前的今天` : '', who: m.who })
      }
      for (const a of story.anniversaries(k, today)) {
        const key = `anniv:${a.who}:${a.days}`
        if (muted.has(key) || recentlySaid(key)) continue
        pool.push({ key, kind: '纪念日', refId: '', text: `今天是你和${a.name}认识满 ${a.days} 天`, at: t, special: '纪念日', who: a.who })
      }
    }
    if (!pool.length) return []
    // 和当前话题的相关度：有语义就按语义（高于基线 = 相关），没有就按关键词
    let rel = null
    const emb = semOn()
    if (emb && r.semVec) {
      try {
        rel = emb.scores(k, r.semVec, pool.map((x) => x.text))
      } catch {
        rel = null
      }
    }
    if (!rel) {
      const q = (r.msgs || []).slice(-6).map((m) => m.text || '').join(' ')
      const bm = bm25Scores(q, pool.map((x) => x.text))
      const max = Math.max(0, ...bm)
      rel = bm.map((b) => (max > 0 ? b / max : 0))
    }
    pool.forEach((x, i) => {
      x.rel = Math.round((rel[i] || 0) * 1000) / 1000
    })
    return pool
      .filter((x) => x.rel > 0 || x.special)
      .sort((a, b) => (b.special ? 1 : 0) - (a.special ? 1 : 0) || b.rel - a.rel)
  }

  /**
   * 这次要不要想起一件往事。
   * @param {'reply'|'proactive'} mode reply：被动回复（按概率）；proactive：主动说话（优先用往事起话头，不再掷概率）
   * @returns {null | { logId, key, kind, refId, text, when, line }}
   */
  function offer(r, mode = 'reply') {
    if (!config.recallEnabled || isReadOnly() || !r || !store.isManagedRoom(r.roomId)) return null
    const st = load(r.roomId)
    const t = now()
    if (st.lastAt && t - st.lastAt < Math.max(0, Number(config.recallCooldownHours ?? 12)) * HOUR) return null
    if (mode === 'reply' && random() >= Math.max(0, Math.min(1, Number(config.recallChance ?? 0.08)))) return null
    const c = candidates(r)[0]
    if (!c) return null
    const when = c.special === '纪念日' ? '就是今天' : c.special && c.special !== '生日临近' ? c.special : agoText(c.at, t)
    const line =
      mode === 'proactive'
        ? `你突然想起一件往事：${c.text}（${when}）。可以拿它自然地起个话头；别老问饿不饿、吃了没。`
        : `如果自然，可以顺嘴提一句：${c.text}（${when}）。不自然就别提，别硬扯。`
    const entry = { id: randomUUID().slice(0, 8), at: t, mode, kind: c.kind, key: c.key, text: c.text, special: c.special || '', said: false }
    st.lastAt = t
    st.log.push(entry)
    save(r.roomId)
    log(`想起往事：${r.roomName || r.roomId}｜${c.kind}｜${c.text.slice(0, 30)}${c.special ? '（' + c.special + '）' : ''}`)
    return { logId: entry.id, key: c.key, kind: c.kind, refId: c.refId, text: c.text, when, line }
  }

  /** 回复发出后：检查有没有真的提到；提到了就强化（新鲜度回满）并记下 */
  async function afterSend(r, o, replyText) {
    if (!o || !r) return false
    const said = String(replyText || '').trim()
    if (!said) return false
    let hit = textSim(said, o.text) >= 0.15
    if (!hit) {
      // 关键词：这件事里的字组（去掉太常见的），回复里出现了 3 个以上
      const grams = new Set(bigramTokens(o.text))
      const got = new Set(bigramTokens(said).filter((g) => grams.has(g)))
      hit = got.size >= 3
    }
    if (!hit) {
      const emb = semOn()
      if (emb) {
        try {
          const [a] = await emb.embed([said])
          const b = emb.vecOf(r.roomId, o.text) || (await emb.embed([o.text]))[0]
          hit = normalizeSim(cosine(a, b), emb.baseline()) >= SAID_SIM
        } catch {
          /* 算不了就只看关键词 */
        }
      }
    }
    if (!hit) return false
    const st = load(r.roomId)
    const t = now()
    const entry = st.log.find((x) => x.id === o.logId)
    if (entry) {
      entry.said = true
      entry.saidText = said.slice(0, 80)
    }
    st.items[o.key] = t
    if (o.kind === '事实') store.touchFact(r.roomId, o.refId)
    else if (o.kind === '理解') insights.touch(r.roomId, o.refId)
    save(r.roomId)
    log(`想起往事：说出口了｜${o.text.slice(0, 30)}`)
    return true
  }

  function history(roomId) {
    const st = load(roomId)
    return st ? st.log.slice().reverse() : []
  }
  function muted(roomId) {
    return load(roomId)?.muted || []
  }
  /** 设成"别主动提"/ 取消 */
  function mute(roomId, key, on = true) {
    const st = load(roomId)
    if (!st || !key) return false
    const k = String(key)
    st.muted = st.muted.filter((x) => x !== k)
    if (on) st.muted.push(k)
    save(roomId)
    return true
  }
  /** 面板：现在会想起哪些（不掷概率、不记冷却）；r 是会话状态（用它最近的聊天和查询向量） */
  function preview(r) {
    return candidates(r).slice(0, 20)
  }

  return { candidates, offer, afterSend, history, muted, mute, preview }
}
