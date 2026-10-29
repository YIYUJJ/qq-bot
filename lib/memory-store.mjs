/**
 * 长期记忆存储层（每个会话一个文件夹）。
 *
 * 只负责"事实"的读写、去重、挑选；提炼/画像/摘要/关系这些需要模型的部分在 memory-ai.mjs。
 *
 * 事实结构：
 *   { id, text, at, importance?: 1~5, who?: QQ号, whoName?: 昵称,
 *     uses?: 被带进回复的次数, lastUsedAt?, due?: 'YYYY-MM-DD'（要跟进的日期）, followedAt?,
 *     chainId?, prev?,                    变化线（记忆深化第 2 项）：线的编号 = 第一个版本的 id；上一个版本
 *     emotion?, intensity?,               情绪 / 强度 1~5（第 3 项；缺省 平静 / 1）
 *     source?, sourceBy?, sourceByName?, sourceTs?,   来源（第 7 项；亲口说 / 别人说 / 推测 / 观察 / 手动添加，缺省 = 未知）
 *     confidence? }                       把握度 1~5（缺省 3；推测类最高 3）
 *   - importance：淘汰时重要度高的优先留下（默认 2）
 *   - who：这条事实是关于谁的；回复这个人时优先带上
 *   - uses / lastUsedAt：记忆强化（常被提起的加分，长期不用的按半衰期淡出）
 *
 * 归档（archive.jsonl）里的旧版本带 supersededAt / supersededBy（被哪个新版本取代）；
 * 模型 DELETE（"不去了""分手了"）给这条线记一个结束节点：endedAt / endReason。
 */
import { randomUUID } from 'node:crypto'
import { ensureRoom, readRoomMemory, writeRoomFacts, readRoomText, readDiary, readSelf, bm25Scores, readArchiveFull } from './memory.mjs'
import { EMOTIONS, SOURCES, clampConfidence, confidenceOf, emotionOf, effectiveHalfLife } from './memory-deep.mjs'

export const MEMORY_STORE_DEPS = ["config","rooms","groupNames","facts","memoryDir","log","keywordsOf"]

const DAY = 86400000

/**
 * 相关度融合（插件和 tools/bench-embed.mjs 共用同一个函数）：
 *   有语义分 sem（按模型基线线性归一化，基线 = 0）时：sem + bonus × b/(b+3)，关键词只做饱和加分；
 *   没有语义分时：b / 本组最大 BM25（只用来排序）。
 * bonus 默认 0：严格测试里任何大于 0 的加分都让 Top1 下降（三个模型都是），带关键词的题语义自己就全对。
 */
export function fuseRelevance(sem, bm, bmMax, bonus = 0) {
  if (sem == null) return bm / (bmMax || 1)
  const k = Math.max(0, Math.min(1, Number(bonus) || 0))
  return sem + k * (bm / (bm + 3))
}

/**
 * 新鲜度：最近一次被用到（或记下）距今多久，按半衰期衰减到 0~1。重要度 4~5 不衰减。
 * slowFade（记忆深化第 3 项）：半衰期 × (1 + (强度-1) × 0.5)，情绪越强淡得越慢。
 */
export function freshness(f, halfLifeDays, now = Date.now(), slowFade = false) {
  if ((Number(f?.importance) || 2) >= 4) return 1
  const last = Math.max(Number(f?.lastUsedAt) || 0, Number(f?.at) || 0)
  if (!last) return 0.5
  const hl = effectiveHalfLife(f, Math.max(1, Number(halfLifeDays) || 30), slowFade) * DAY
  return Math.pow(0.5, Math.max(0, now - last) / hl)
}

export function createMemoryStore(deps) {
  const missing = MEMORY_STORE_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('记忆存储缺少依赖：' + missing.join(', '))
  const { config, rooms, groupNames, facts, memoryDir, log } = deps

  /** 语义打分钩子（embed.mjs 注入）：(roomId, texts) => number[] | null */
  let semanticScorer = null
  function setSemanticScorer(fn) {
    semanticScorer = typeof fn === 'function' ? fn : null
  }
  /** 写入钩子：记忆有增删改时通知（用来马上补语义向量） */
  let onChange = null
  function setOnChange(fn) {
    onChange = typeof fn === 'function' ? fn : null
  }
  function notifyChange(k) {
    if (!onChange) return
    try {
      onChange(String(k))
    } catch (e) {
      log('记忆写入钩子出错：' + String(e?.message || e))
    }
  }
  /** 联想钩子（deep-links 注入）：(roomId, seeds, chosen:Set<id>, limit) => fact[] */
  let associator = null
  function setAssociator(fn) {
    associator = typeof fn === 'function' ? fn : null
  }

  /** 每个会话最多保留多少条事实（超出的按重要度+新旧+使用次数+情绪转入归档） */
  function keepLimit() {
    return Math.max(30, Number(config.factsKeep) || 150)
  }

  function isGroupRoom(roomId) {
    const id = String(roomId)
    const r = rooms.get(id)
    if (r && typeof r.isGroup === 'boolean') return r.isGroup
    return groupNames.has(id) || config.allowGroups.includes(id)
  }
  function isManagedRoom(roomId) {
    return config.memoryRooms.includes(String(roomId))
  }
  function memDirOf(roomId) {
    const id = String(roomId)
    if (!isManagedRoom(id)) return ''
    const isGroup = isGroupRoom(id)
    const name = groupNames.get(id) || (rooms.get(id) || {}).roomName || ''
    return ensureRoom(memoryDir, id, isGroup, name).dir
  }
  /** 懒加载：第一次访问时才读该会话的 facts.json；老数据补上 id。 */
  function loadFacts(roomId) {
    const k = String(roomId)
    if (!isManagedRoom(k)) return []
    if (facts[k]) return facts[k]
    const dir = memDirOf(k)
    if (!dir) return []
    const mem = readRoomMemory(dir)
    const list = Array.isArray(mem.facts) ? mem.facts : []
    let patched = false
    for (const f of list) {
      if (f && !f.id) {
        f.id = newId()
        patched = true
      }
    }
    facts[k] = list
    // 老数据补上的 id 要落盘，否则重启后 id 变了，面板/模型引用的编号会对不上
    if (patched) {
      try {
        writeRoomFacts(dir, list, { keep: keepLimit() })
      } catch (e) {
        log('记忆补 id 落盘失败：' + String(e?.message || e))
      }
    }
    return facts[k]
  }
  function newId() {
    return randomUUID().slice(0, 8)
  }
  const roomTextCache = new Map()
  function roomTextOf(dir) {
    let v = roomTextCache.get(dir)
    if (!v) {
      v = { ...readRoomText(dir), diary: readDiary(dir, 600), self: readSelf(dir, 400) }
      roomTextCache.set(dir, v)
    }
    return v
  }
  function invalidateRoomText(dir) {
    if (dir) roomTextCache.delete(dir)
  }
  function factsOf(roomId) {
    return loadFacts(roomId).filter((x) => !x.supersededAt)
  }
  function bigrams(s) {
    const t = String(s || '').replace(/[\s\p{P}\p{S}]/gu, '')
    const set = new Set()
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
    return set
  }
  function similarity(a, b) {
    const A = bigrams(a)
    const B = bigrams(b)
    if (!A.size || !B.size) return 0
    let inter = 0
    for (const x of A) if (B.has(x)) inter += 1
    return inter / (A.size + B.size - inter)
  }
  function factNorm(t) {
    return String(t || '')
      .replace(/[\s\p{P}\p{S}]/gu, '')
      .toLowerCase()
      .slice(0, 120)
  }
  function clampImportance(v) {
    const n = Math.round(Number(v))
    return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 2
  }
  function cleanDue(v) {
    const s = String(v || '').trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
  }
  const chainOfFact = (f) => String(f?.chainId || f?.id || '')

  /**
   * 情绪 / 来源 / 把握度这些可选字段：给了才写，没给不写（读的时候按缺省值）。
   * 改的是 target 本身。
   */
  function setDeepFields(target, extra = {}) {
    if (extra.emotion !== undefined) {
      const e = emotionOf({ emotion: extra.emotion, intensity: extra.intensity })
      if (e.emotion === '平静') {
        delete target.emotion
        delete target.intensity
      } else {
        target.emotion = e.emotion
        target.intensity = e.intensity
      }
    } else if (extra.intensity !== undefined && target.emotion && EMOTIONS.includes(target.emotion)) {
      target.intensity = emotionOf({ emotion: target.emotion, intensity: extra.intensity }).intensity
    }
    if (extra.source !== undefined) {
      const s = SOURCES.includes(extra.source) ? extra.source : ''
      if (s) target.source = s
      else delete target.source
      for (const k of ['sourceBy', 'sourceByName']) {
        if (s && extra[k]) target[k] = String(extra[k])
        else delete target[k]
      }
      if (s && Number(extra.sourceTs)) target.sourceTs = Number(extra.sourceTs)
      else delete target.sourceTs
    }
    if (extra.confidence !== undefined && extra.confidence !== null && extra.confidence !== '') {
      target.confidence = clampConfidence(extra.confidence, target.source || '')
    } else if (target.confidence !== undefined) {
      // 来源改成推测：把握度最高 3
      target.confidence = clampConfidence(target.confidence, target.source || '')
    }
    return target
  }

  /** 落盘并同步内存（writeRoomFacts 可能按分数淘汰一部分）。 */
  function persist(k, list, archive = []) {
    const dir = memDirOf(k)
    if (!dir) return { kept: 0, archived: 0 }
    facts[k] = list
    const r = writeRoomFacts(dir, list, { keep: keepLimit(), archive })
    if (r.archived > archive.length) facts[k] = readRoomMemory(dir).facts
    notifyChange(k)
    return r
  }

  /**
   * 记一条事实（相似度去重版；memoryOps 关闭、手动添加、视频记忆走这里）。
   * @param {object} [extra] { importance?, who?, whoName?, due?, noMerge?,
   *   emotion?, intensity?, source?, sourceBy?, sourceByName?, sourceTs?, confidence?, chainId?, prev? }
   * @returns {false | object} 新事实
   */
  function addFact(roomId, text, at = Date.now(), extra = {}) {
    const k = String(roomId)
    const t = String(text || '').trim()
    if (!t || !isManagedRoom(k)) return false
    const norm = factNorm(t)
    if (!norm || !memDirOf(k)) return false
    const list = loadFacts(k)
    if (list.some((x) => !x.supersededAt && factNorm(x.text) === norm)) return false
    const id = newId()
    const older = []
    const keep = []
    for (const x of list) {
      if (x.supersededAt) continue
      if (!extra?.noMerge && similarity(t, x.text) >= 0.6) older.push({ ...x, supersededAt: Date.now(), supersededBy: id })
      else keep.push(x)
    }
    let importance = clampImportance(extra?.importance ?? 2)
    for (const o of older) importance = Math.max(importance, clampImportance(o.importance ?? 2))
    const fact = { id, text: t, at: Number(at) || Date.now(), importance }
    const who = String(extra?.who || older.find((o) => o.who)?.who || '').trim()
    if (who) {
      fact.who = who
      const whoName = String(extra?.whoName || older.find((o) => o.whoName)?.whoName || '').trim()
      if (whoName) fact.whoName = whoName
    }
    const due = cleanDue(extra?.due)
    if (due) fact.due = due
    // 继承使用次数：同一件事的新版本不该从零开始
    const uses = older.reduce((s, o) => s + (Number(o.uses) || 0), 0)
    if (uses) fact.uses = uses
    // 变化线：相似度合并 = 新版本，接在最近的旧版本后面；否则自己开一条线（复活结束的线时由调用方给 chainId / prev）
    const base = older.slice().sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))[0]
    fact.chainId = String(extra?.chainId || (base ? chainOfFact(base) : id))
    const prev = String(extra?.prev || base?.id || '')
    if (prev) fact.prev = prev
    // 情绪：取合并进来的里面最强的
    const strongest = [extra, ...older].map((x) => emotionOf(x)).sort((a, b) => b.intensity - a.intensity)[0]
    setDeepFields(fact, { ...extra, emotion: strongest.emotion, intensity: strongest.intensity })
    if (extra?.confidence === undefined && older.length) {
      const c = Math.max(...older.map((o) => confidenceOf(o)))
      if (c !== 3) fact.confidence = clampConfidence(c, fact.source || '')
    }
    keep.push(fact)
    const r = persist(k, keep, older)
    if (older.length) log(`记忆更新：${k} 有 ${older.length} 条旧事实被新版本取代（已归档）`)
    else if (r.archived) log(`记忆归档：${k} 有 ${r.archived} 条转入 archive.jsonl`)
    return fact
  }

  /**
   * 按 id 改一条。
   *   改了内容（text）→ 生成新版本：新 id，继承变化线（chainId），prev 指向旧版本，旧版本进归档并记下被谁取代、什么时候。
   *   只改重要度 / 关于谁 / 跟进日期 / 情绪 / 来源 / 把握度 → 原地改。
   *   confirm=true：本人又确认了一次，把握度 +1（最高 5，推测类最高 3）。
   */
  function updateFact(roomId, id, patch = {}) {
    const k = String(roomId)
    const list = loadFacts(k)
    const idx = list.findIndex((x) => x.id === String(id) && !x.supersededAt)
    if (idx < 0) return false
    const old = list[idx]
    const text = patch.text != null ? String(patch.text).trim() : old.text
    if (!text) return false
    if (list.some((x, i) => i !== idx && !x.supersededAt && factNorm(x.text) === factNorm(text))) return false
    const changed = factNorm(text) !== factNorm(old.text)
    let next
    if (changed) {
      next = { ...old, id: newId(), text, at: Date.now(), chainId: chainOfFact(old), prev: old.id }
      delete next.editedAt
      // 新的说法：把握度从缺省重新算（除非调用方给了）
      if (patch.confidence === undefined) delete next.confidence
    } else {
      next = { ...old, text, editedAt: Date.now() }
    }
    if (patch.importance != null) next.importance = clampImportance(patch.importance)
    if (patch.who !== undefined) {
      if (patch.who) next.who = String(patch.who)
      else delete next.who
      if (patch.whoName) next.whoName = String(patch.whoName)
      if (!patch.who) delete next.whoName
    }
    if (patch.due !== undefined) {
      const d = cleanDue(patch.due)
      if (d) {
        if (d !== old.due) delete next.followedAt
        next.due = d
      } else delete next.due
    }
    setDeepFields(next, patch)
    if (patch.confirm) next.confidence = clampConfidence(confidenceOf(next) + 1, next.source || '')
    const copy = list.slice()
    copy[idx] = next
    const archive = changed ? [{ ...old, supersededAt: Date.now(), supersededBy: next.id }] : []
    persist(k, copy, archive)
    return next
  }

  /**
   * 按 id 删一条（进归档，标 deletedAt，翻旧账仍能找到）。
   * end=true（模型判断"不去了""分手了"）：不只是删除，还给这条变化线记一个结束节点（endedAt + endReason）。
   */
  function deleteFactById(roomId, id, reason = '', { end = false } = {}) {
    const k = String(roomId)
    const list = loadFacts(k)
    const f = list.find((x) => x.id === String(id))
    if (!f) return false
    const now = Date.now()
    const why = reason ? String(reason).slice(0, 80) : ''
    const rec = { ...f, chainId: chainOfFact(f), deletedAt: now, ...(why ? { deletedReason: why } : {}) }
    if (end) {
      rec.endedAt = now
      rec.endReason = why || '不再成立'
    }
    persist(k, list.filter((x) => x !== f), [rec])
    return true
  }

  function delFact(roomId, text) {
    const k = String(roomId)
    if (!isManagedRoom(k)) return false
    const norm = factNorm(text)
    const f = loadFacts(k).find((x) => factNorm(x.text) === norm)
    return f ? deleteFactById(k, f.id, '手动删除') : false
  }

  /** 归档里的完整记录（只读，别改返回的对象） */
  function archiveOf(k) {
    const dir = memDirOf(k)
    return dir ? readArchiveFull(dir, 2000).filter((x) => !x.undoneAt) : []
  }

  /** 已经结束的变化线（最近 days 天内结束的；提炼时交给模型，"又开始了"可以接回去） */
  function endedChains(roomId, days = 60, limit = 10) {
    const k = String(roomId)
    const since = Date.now() - days * DAY
    const active = new Set(loadFacts(k).map(chainOfFact))
    const seen = new Set()
    const out = []
    for (const a of archiveOf(k).slice().reverse()) {
      if (!a.endedAt || a.endedAt < since) continue
      const cid = chainOfFact(a)
      if (active.has(cid) || seen.has(cid)) continue
      seen.add(cid)
      out.push(a)
      if (out.length >= limit) break
    }
    return out
  }

  /** 结束的线又开始了：在结束节点后面接一个新版本 */
  function reviveChain(roomId, endedId, text, extra = {}) {
    const k = String(roomId)
    const ended = archiveOf(k).filter((a) => a.id === String(endedId) && a.endedAt).pop()
    if (!ended) return false
    return addFact(k, text, Date.now(), {
      importance: extra.importance ?? ended.importance,
      who: extra.who || ended.who,
      whoName: extra.whoName || ended.whoName,
      ...extra,
      noMerge: true,
      chainId: chainOfFact(ended),
      prev: ended.id,
    })
  }

  /**
   * 一条变化线上的全部版本（当前 + 归档），按时间排好。
   * @returns {Array<{kind:'版本', id, text, at, current:boolean} | {kind:'结束', id, at, reason}>}
   */
  function chainOf(roomId, id) {
    const k = String(roomId)
    const active = loadFacts(k).filter((x) => !x.supersededAt)
    const arch = archiveOf(k)
    const f = active.find((x) => x.id === String(id)) || arch.filter((x) => x.id === String(id)).pop()
    if (!f) return []
    return chainNodes(chainOfFact(f), active, arch)
  }
  function chainNodes(cid, active, arch) {
    const byId = new Map()
    for (const a of arch) if (chainOfFact(a) === cid) byId.set(a.id, { ...a, current: false })
    for (const x of active) if (chainOfFact(x) === cid) byId.set(x.id, { ...x, current: true })
    const nodes = []
    for (const v of byId.values()) {
      nodes.push({ kind: '版本', id: v.id, text: v.text, at: Number(v.at) || 0, current: v.current })
      if (!v.current && v.endedAt) nodes.push({ kind: '结束', id: v.id + ':end', at: Number(v.endedAt) || 0, reason: v.endReason || '' })
    }
    return nodes.sort((a, b) => a.at - b.at || (a.kind === '结束' ? 1 : -1))
  }
  /** 所有当前事实的变化线（面板 / 提示词批量用，只读一次归档） */
  function chainsFor(roomId, list) {
    const k = String(roomId)
    const active = loadFacts(k).filter((x) => !x.supersededAt)
    const arch = archiveOf(k)
    const out = new Map()
    for (const f of list || active) out.set(f.id, chainNodes(chainOfFact(f), active, arch))
    return out
  }

  /**
   * 批量执行模型给出的增删改（memoryOps）。
   * @param {Array<{op:'ADD'|'UPDATE'|'DELETE', id?, text?, importance?, who?, whoName?, due?,
   *   emotion?, intensity?, source?, sourceBy?, sourceByName?, sourceTs?}>} ops
   *
   * 和记忆深化相关的处理：
   *   ADD 和已有的一字不差、且是本人亲口说 → 不重复记，原来那条把握度 +1（"被再次提起"）
   *   UPDATE 内容一致、且是本人亲口说 → 把握度 +1；内容变了 → 新版本（变化线）
   *   UPDATE 的编号是一条已经结束的线 → 接着这条线开一个新版本（"又开始了"）
   *   DELETE → 给这条线记结束节点
   */
  function applyOps(roomId, ops) {
    const out = { added: 0, updated: 0, deleted: 0, confirmed: 0, skipped: 0, lines: [], addedIds: [] }
    const deepOf = (o) => {
      const x = {}
      for (const key of ['emotion', 'intensity', 'source', 'sourceBy', 'sourceByName', 'sourceTs']) if (o[key] !== undefined) x[key] = o[key]
      return x
    }
    const selfSaid = (o, f) => o.source === '亲口说' && String(o.sourceBy || '') === String(f.who || o.sourceBy || '')
    for (const o of ops || []) {
      try {
        if (o.op === 'ADD') {
          const norm = factNorm(o.text)
          const same = factsOf(roomId).find((x) => factNorm(x.text) === norm)
          if (same) {
            if (selfSaid(o, same)) {
              const patch = { confirm: true }
              if (same.source === '推测') Object.assign(patch, deepOf(o)) // 本人确认了 → 不再是猜的
              updateFact(roomId, same.id, patch)
              out.confirmed += 1
              out.lines.push('✓ ' + same.text)
            } else out.skipped += 1
            continue
          }
          const f = addFact(roomId, o.text, Date.now(), { importance: o.importance, who: o.who, whoName: o.whoName, due: o.due, noMerge: true, ...deepOf(o) })
          if (f) {
            out.added += 1
            out.addedIds.push(f.id)
            out.lines.push('+ ' + f.text)
          } else out.skipped += 1
        } else if (o.op === 'UPDATE') {
          const cur = factsOf(roomId).find((x) => x.id === String(o.id))
          if (!cur) {
            const f = reviveChain(roomId, o.id, o.text, { importance: o.importance, due: o.due, ...deepOf(o) })
            if (f) {
              out.updated += 1
              out.lines.push('↻ ' + f.text)
            } else out.skipped += 1
            continue
          }
          if (factNorm(o.text) === factNorm(cur.text)) {
            // 内容一致：只是又提了一次。跟进日期写"-"时别把原来的日期删掉
            const patch = { importance: o.importance }
            if (o.due) patch.due = o.due
            if (o.emotion !== undefined) Object.assign(patch, { emotion: o.emotion, intensity: o.intensity })
            if (selfSaid(o, cur)) {
              patch.confirm = true
              if (cur.source === '推测') Object.assign(patch, deepOf(o))
            }
            if (updateFact(roomId, cur.id, patch)) {
              if (patch.confirm) out.confirmed += 1
              out.lines.push((patch.confirm ? '✓ ' : '~ ') + cur.text)
            } else out.skipped += 1
            continue
          }
          const f = updateFact(roomId, o.id, { text: o.text, importance: o.importance, due: o.due, ...(o.who ? { who: o.who, whoName: o.whoName } : {}), ...deepOf(o) })
          if (f) {
            out.updated += 1
            out.lines.push('~ ' + f.text)
          } else out.skipped += 1
        } else if (o.op === 'DELETE') {
          const before = loadFacts(roomId).find((x) => x.id === String(o.id))
          if (deleteFactById(roomId, o.id, o.reason || '模型判断已失效', { end: true })) {
            out.deleted += 1
            out.lines.push('- ' + (before?.text || o.id))
          } else out.skipped += 1
        } else out.skipped += 1
      } catch (e) {
        out.skipped += 1
        log('记忆操作失败：' + String(e?.message || e))
      }
    }
    return out
  }

  /**
   * 一次提交多处改动（每晚整理 / 撤销用），只落盘一次。
   *   remove: [{ id, mark }]   从当前记忆移走，带上 mark（如 { demotedAt }）进归档
   *   patch:  [{ id, set }]    原地改字段（set 里值为 undefined 的字段会被删掉）
   *   add:    [fact]           加入当前记忆（必须带 id；和现有的一字不差就跳过）
   * @returns {{ removed: object[], patched: Array<{before, after}>, added: object[] }}
   */
  function commit(roomId, { remove = [], patch = [], add = [] } = {}) {
    const k = String(roomId)
    const list = loadFacts(k).slice()
    const archive = []
    const res = { removed: [], patched: [], added: [] }
    const now = Date.now()
    for (const r of remove) {
      const i = list.findIndex((x) => x.id === String(r.id) && !x.supersededAt)
      if (i < 0) continue
      const f = list[i]
      list.splice(i, 1)
      res.removed.push({ ...f })
      archive.push({ ...f, chainId: chainOfFact(f), ...(r.mark || { deletedAt: now }) })
    }
    for (const p of patch) {
      const i = list.findIndex((x) => x.id === String(p.id) && !x.supersededAt)
      if (i < 0) continue
      const before = { ...list[i] }
      const after = { ...list[i] }
      for (const [key, v] of Object.entries(p.set || {})) {
        if (v === undefined) delete after[key]
        else after[key] = v
      }
      list[i] = after
      res.patched.push({ before, after })
    }
    for (const f of add) {
      if (!f?.id || !String(f.text || '').trim()) continue
      const norm = factNorm(f.text)
      const j = list.findIndex((x) => x.id === f.id)
      if (j >= 0) list.splice(j, 1)
      if (list.some((x) => !x.supersededAt && factNorm(x.text) === norm)) continue
      const g = { ...f }
      delete g.supersededAt
      delete g.supersededBy
      list.push(g)
      res.added.push(g)
    }
    if (res.removed.length || res.patched.length || res.added.length) persist(k, list, archive)
    return res
  }

  /** 新建一条事实对象（不落盘；交给 commit 用） */
  function makeFact(text, extra = {}) {
    const id = newId()
    const f = { id, text: String(text || '').trim(), at: Number(extra.at) || Date.now(), importance: clampImportance(extra.importance ?? 2) }
    if (extra.who) {
      f.who = String(extra.who)
      if (extra.whoName) f.whoName = String(extra.whoName)
    }
    const due = cleanDue(extra.due)
    if (due) f.due = due
    if (Number(extra.uses)) f.uses = Number(extra.uses)
    if (Number(extra.lastUsedAt)) f.lastUsedAt = Number(extra.lastUsedAt)
    f.chainId = String(extra.chainId || id)
    if (extra.prev) f.prev = String(extra.prev)
    setDeepFields(f, extra)
    return f
  }

  /** 记忆强化：这些事实被带进了回复 → 计数 + 记时间。只改内存，攒着由 flushUses 落盘。 */
  const usesDirty = new Set()
  function markUsed(roomId, list) {
    if (!config.memoryReinforce || !list?.length) return
    const now = Date.now()
    for (const f of list) {
      f.uses = (Number(f.uses) || 0) + 1
      f.lastUsedAt = now
    }
    usesDirty.add(String(roomId))
  }
  /** 想起往事真的说出口了（第 8 项）：记一次被用到，新鲜度回满（不看 memoryReinforce 开关） */
  function touchFact(roomId, id) {
    const f = factsOf(roomId).find((x) => x.id === String(id))
    if (!f) return false
    f.uses = (Number(f.uses) || 0) + 1
    f.lastUsedAt = Date.now()
    usesDirty.add(String(roomId))
    return true
  }
  function flushUses() {
    for (const k of usesDirty) {
      try {
        const dir = memDirOf(k)
        if (dir && facts[k]) writeRoomFacts(dir, facts[k], { keep: keepLimit() })
      } catch (e) {
        log('记忆使用计数落盘失败：' + String(e?.message || e))
      }
    }
    const n = usesDirty.size
    usesDirty.clear()
    return n
  }

  /**
   * 给一组事实打分（挑选用，也给面板"为什么带这条"看）：
   *   相关度 + 说话人 + 重要度 + 强化（使用次数 × 新鲜度）+ 情绪
   *
   * 相关度：见 fuseRelevance。有语义分时以语义为主，关键词加分默认 0（keywordBonus 可调）；
   *   没有语义分时就是 BM25 除以最大值（只用来排序）。
   * 情绪（记忆深化第 3 项）：+ (强度-1) × emotionWeight × 0.05，相关度相近时情绪强的优先。
   */
  function scoreFacts(r, list, query, speaker) {
    const raw = bm25Scores(query, list.map((f) => f.text))
    const max = Math.max(0, ...raw) || 1
    let sem = null
    if (config.semanticSearch && semanticScorer) {
      try {
        sem = semanticScorer(r.roomId, list.map((f) => f.text))
      } catch {
        sem = null
      }
    }
    const bonus = Number(config.keywordBonus ?? 0)
    const hl = Number(config.memoryHalfLifeDays) || 30
    const slow = config.emotionSlowFade !== false
    const ew = Math.max(0, Math.min(1, Number(config.emotionWeight ?? 0.5)))
    return list.map((f, i) => {
      const rel = fuseRelevance(sem ? sem[i] : null, raw[i], max, bonus)
      let s = rel
      if (speaker && f.who && String(f.who) === speaker) s += 0.6
      s += (clampImportance(f.importance ?? 2) - 2) * 0.15
      if (config.memoryReinforce) {
        const fr = freshness(f, hl, Date.now(), slow)
        s += Math.min(0.3, Math.log1p(Number(f.uses) || 0) * 0.1) * fr
        // 太久没用、重要度又低：轻微降权（不会降到 0，相关的仍能被挑中）
        s -= (1 - fr) * 0.1
      }
      s += (emotionOf(f).intensity - 1) * ew * 0.05
      return { f, s, rel }
    })
  }

  /**
   * 联想（记忆深化第 5 项）：从得分最高的几条出发，各带 1~2 条相连的记忆，总数不超过 assocExtra。
   * @param {object[]} seeds 按得分排好的事实（只用前 3 条）
   * @param {Set<string>} chosen 已经选中的 id（不重复带）
   */
  function associate(roomId, seeds, chosen) {
    if (!associator || !config.assocEnabled) return []
    const n = Math.max(0, Math.min(6, Number(config.assocExtra ?? 2)))
    if (!n || !seeds?.length) return []
    try {
      return associator(String(roomId), seeds.slice(0, 3), chosen, n) || []
    } catch (e) {
      log('联想出错：' + String(e?.message || e))
      return []
    }
  }

  /**
   * 挑这次回复要带的记忆；相关的不够 limit 条时用最新的补满；再带上联想的几条（返回数组上挂 assoc = Set<id>）。
   * @param {{mark?: boolean}} [opts] mark=false：先不记"被用到"（提示词按预算裁剪后再由调用方 markUsed）
   */
  function pickFacts(r, limit, { mark = true } = {}) {
    const list = factsOf(r.roomId)
    if (!list.length) return []
    const n = Math.max(1, Math.min(30, Number(limit) || 8))
    let out
    const assoc = new Set()
    if (list.length <= n) out = list.slice()
    else {
      const recent = (r.msgs || []).slice(-6)
      const speaker = String([...recent].reverse().find((m) => !m.isSelf)?.sender || '')
      const scored = scoreFacts(r, list, recent.map((m) => m.text || '').join(' '), speaker)
      scored.sort((a, b) => b.s - a.s || (b.f.at || 0) - (a.f.at || 0))
      out = scored.filter((x) => x.rel > 0 || x.s > 0.3).slice(0, n).map((x) => x.f)
      const seeds = out.slice(0, 3)
      if (out.length < n) {
        const chosen = new Set(out)
        for (let i = list.length - 1; i >= 0 && out.length < n; i--) if (!chosen.has(list[i])) out.push(list[i])
      }
      for (const f of associate(r.roomId, seeds, new Set(out.map((x) => x.id)))) {
        if (out.includes(f)) continue
        out.push(f)
        assoc.add(f.id)
      }
    }
    if (mark) markUsed(r.roomId, out)
    out.assoc = assoc
    return out
  }

  /** 关于某个人的事实（人物卡用）。 */
  function factsAbout(roomId, who) {
    const id = String(who || '')
    return id ? factsOf(roomId).filter((f) => String(f.who || '') === id) : []
  }

  /** 到期该跟进的事（due ≤ 今天、没跟进过）。 */
  function dueFacts(roomId, today) {
    return factsOf(roomId).filter((f) => f.due && f.due <= today && !f.followedAt)
  }
  function markFollowed(roomId, id) {
    const list = loadFacts(roomId)
    const f = list.find((x) => x.id === String(id))
    if (!f) return false
    f.followedAt = Date.now()
    persist(String(roomId), list.slice())
    return true
  }

  function clearRoomTextCache() {
    roomTextCache.clear()
  }

  return {
    isGroupRoom, isManagedRoom, memDirOf, loadFacts, factsOf, factNorm,
    addFact, updateFact, deleteFactById, delFact, applyOps, commit, makeFact,
    chainOf, chainsFor, endedChains, reviveChain, archiveOf,
    pickFacts, scoreFacts, associate, markUsed, touchFact, flushUses, factsAbout, dueFacts, markFollowed,
    roomTextOf, invalidateRoomText, clearRoomTextCache, similarity, keepLimit,
    setSemanticScorer, setOnChange, notifyChange, setAssociator,
  }
}
