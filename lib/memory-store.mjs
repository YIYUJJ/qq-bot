/**
 * 长期记忆存储层（每个会话一个文件夹）。
 *
 * 只负责"事实"的读写与去重相似度；提炼/画像/摘要/关系这些需要模型的部分仍在 index.js。
 */
import { ensureRoom, readRoomMemory, writeRoomFacts, readRoomText, readDiary, readSelf } from './memory.mjs'

export const MEMORY_STORE_DEPS = ["config","rooms","groupNames","facts","memoryDir","log","keywordsOf"]

export function createMemoryStore(deps) {
  const missing = MEMORY_STORE_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('记忆存储缺少依赖：' + missing.join(', '))
  const { config, rooms, groupNames, facts, memoryDir, log, keywordsOf } = deps

  // ── 长期记忆（每个会话一个文件夹；按相关性注入）────────
  /** 这个 id 是群还是私聊：优先看运行时状态，其次白名单/群列表。 */
  function isGroupRoom(roomId) {
    const id = String(roomId)
    const r = rooms.get(id)
    if (r && typeof r.isGroup === 'boolean') return r.isGroup
    return groupNames.has(id) || config.allowGroups.includes(id)
  }
  /** 这个会话是否纳入记忆托管（只有名单里的群/私聊才记）。 */
  function isManagedRoom(roomId) {
    return config.memoryRooms.includes(String(roomId))
  }
  /** 这个会话的记忆目录（会自动建目录与 meta.json）；未托管返回 ''。 */  function memDirOf(roomId) {
    const id = String(roomId)
    if (!isManagedRoom(id)) return ''
    const isGroup = isGroupRoom(id)
    const name = groupNames.get(id) || (rooms.get(id) || {}).roomName || ''
    return ensureRoom(memoryDir, id, isGroup, name).dir
  }
  /** 懒加载：第一次访问时才读该会话的 facts.json。 */
  function loadFacts(roomId) {
    const k = String(roomId)
    if (!isManagedRoom(k)) return []
    if (facts[k]) return facts[k]
    const dir = memDirOf(k)
    if (!dir) return []
    const mem = readRoomMemory(dir)
    facts[k] = Array.isArray(mem.facts) ? mem.facts : []
    return facts[k]
  }
  // 画像/摘要/关系是三个小文件，内容很少变：缓存起来，写入时失效，避免每回复都重读
  const roomTextCache = new Map() // dir -> { profile, summary, relations }
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
  /** 字符二元组 Jaccard：判断"新事实是不是在说同一件事"。 */
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
  function addFact(roomId, text, at = Date.now()) {
    const k = String(roomId)
    const t = String(text || '').trim()
    if (!t) return false
    if (!isManagedRoom(k)) return false
    const norm = factNorm(t)
    if (!norm) return false
    const dir = memDirOf(k)
    if (!dir) return false
    const list = loadFacts(k)
    if (list.some((x) => !x.supersededAt && factNorm(x.text) === norm)) return false
    // 旧事实和新事实高度相似 → 判定为"同一件事的更新"，旧的作废并留档
    const older = []
    const keep = []
    for (const x of list) {
      if (x.supersededAt) continue
      if (similarity(t, x.text) >= 0.6) older.push({ ...x, supersededAt: Date.now(), supersededBy: t })
      else keep.push(x)
    }
    keep.push({ text: t, at })
    facts[k] = keep
    const r = writeRoomFacts(dir, keep, { keep: 60, archive: older })
    if (older.length) log(`记忆更新：${k} 有 ${older.length} 条旧事实被新版本取代（已归档）`)
    else if (r.archived) log(`记忆归档：${k} 有 ${r.archived} 条转入 archive.jsonl`)
    return true
  }
  function delFact(roomId, text) {
    const k = String(roomId)
    if (!isManagedRoom(k)) return false
    const norm = factNorm(text)
    const list = loadFacts(k)
    const next = list.filter((x) => factNorm(x.text) !== norm)
    if (next.length === list.length) return false
    facts[k] = next
    writeRoomFacts(memDirOf(k), next, { keep: 60 })
    return true
  }
  /** 按"和最近聊天是否相关"挑记忆：关键词命中的优先，其次按时间新的。 */
  function pickFacts(r, limit) {
    const list = factsOf(r.roomId)
    if (!list.length) return []
    const n = Math.max(1, Math.min(30, Number(limit) || 8))
    if (list.length <= n) return list
    const kws = keywordsOf(r.msgs.slice(-6).map((m) => m.text).join(' '))
    const scored = list.map((f) => {
      let score = 0
      for (const k of kws) if (f.text.includes(k)) score += 1
      return { f, score }
    })
    scored.sort((a, b) => b.score - a.score || (b.f.at || 0) - (a.f.at || 0))
    const hit = scored.filter((x) => x.score > 0).slice(0, n).map((x) => x.f)
    if (hit.length) return hit
    return list.slice(-n)
  }
  function clearRoomTextCache() {
    roomTextCache.clear()
  }

  return { isGroupRoom, isManagedRoom, memDirOf, loadFacts, factsOf, factNorm, addFact, delFact, pickFacts, roomTextOf, invalidateRoomText, clearRoomTextCache, similarity }
}
