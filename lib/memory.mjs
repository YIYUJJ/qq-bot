/**
 * 按会话独立的记忆目录。
 *
 * 为什么从"一个 facts.json 装所有群"改成"每个会话一个文件夹"：
 *   1. 长期养的记忆会越来越大（事实 + 画像 + 事件流），塞一个文件既难维护也难备份；
 *   2. 每群独立文件夹后，可以直接看/拷/删某个群的记忆，不会牵动别的群；
 *   3. 满了可以往 archive.jsonl 里归档，而不是把老记忆挤掉。
 *
 * 目录结构：
 *   <base>/group-123456789/{meta.json, facts.json, archive.jsonl}
 *   <base>/private-10001/{meta.json, facts.json, archive.jsonl}
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJson, atomicWriteText } from './store.mjs'
import { intensityOf } from './memory-deep.mjs'

export function readJsonSafe(file, fallback) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return fallback // 不存在/读不了
  }
  try {
    return JSON.parse(raw)
  } catch {
    // 文件存在但已损坏：先留一份副本再回落，免得下一次写入把唯一的残骸也覆盖掉
    try {
      copyFileSync(file, file + '.corrupt-' + Date.now())
    } catch {
      /* ignore */
    }
    return fallback
  }
}

/** 原子写（tmp + rename）；失败抛错，保持和原来 writeFileSync 一样"写不进去就报错"的语义。 */
function mustWriteJson(file, obj) {
  if (!atomicWriteJson(file, obj)) throw new Error('写盘失败：' + file)
}
function mustWriteText(file, text) {
  if (!atomicWriteText(file, text)) throw new Error('写盘失败：' + file)
}

/** 目录名：group-<群号> / private-<QQ号>，只保留安全字符。 */
export function roomSlug(roomId, isGroup) {
  return (isGroup ? 'group-' : 'private-') + String(roomId).replace(/[^\w.-]/g, '_')
}

export function roomDir(baseDir, roomId, isGroup) {
  return join(baseDir, roomSlug(roomId, isGroup))
}

/** 建目录 + 维护 meta.json（首次创建时间、名称、最后更新）。只在真有变化时才写盘。 */
export function ensureRoom(baseDir, roomId, isGroup, name) {
  const dir = roomDir(baseDir, roomId, isGroup)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const metaPath = join(dir, 'meta.json')
  const old = readJsonSafe(metaPath, null)
  const created = !(old && typeof old === 'object')
  const meta = created ? {} : old
  const wantName = name ? String(name) : meta.name || ''
  const changed =
    created || meta.roomId !== String(roomId) || meta.isGroup !== !!isGroup || meta.name !== wantName
  if (changed) {
    meta.roomId = String(roomId)
    meta.isGroup = !!isGroup
    meta.name = wantName
    meta.createdAt = Number(meta.createdAt) || Date.now()
    meta.updatedAt = Date.now()
    mustWriteJson(metaPath, meta)
  }
  return { dir, meta }
}

export function readRoomMemory(dir) {
  const meta = readJsonSafe(join(dir, 'meta.json'), null)
  const facts = readJsonSafe(join(dir, 'facts.json'), [])
  return { meta, facts: Array.isArray(facts) ? facts : [] }
}

/**
 * 写记忆事实。超过 keep 条时把最老的归档到 archive.jsonl（长期保留，不丢）。
 * @returns {{kept:number, archived:number}}
 */
export function writeRoomFacts(dir, facts, { keep = 150, archive = [] } = {}) {
  mkdirSync(dir, { recursive: true })
  let list = Array.isArray(facts) ? facts.slice() : []
  const extra = Array.isArray(archive) ? archive.slice() : []
  let archived = 0
  if (list.length > keep) {
    // 不再"最老的先走"：重要度（1~5，默认 2）+ 新旧程度（0~2）一起算，分低的先归档。
    // 这样生日/约定这类重要度高的老事实不会被一堆闲聊挤掉。
    const n = list.length - keep
    // 被用到的次数也算分（记忆强化）：常被提起的不容易被挤走
    // 情绪越强越不容易被挤走（记忆深化第 3 项：+ (强度-1) × 0.5；平静 / 旧记忆强度按 1）
    const scored = list.map((x, i) => ({
      i,
      s:
        (Number(x?.importance) || 2) +
        (2 * i) / list.length +
        Math.min(1, Math.log1p(Number(x?.uses) || 0) / 3) +
        (intensityOf(x) - 1) * 0.5,
    }))
    scored.sort((a, b) => a.s - b.s)
    const dropIdx = new Set(scored.slice(0, n).map((y) => y.i))
    extra.push(...list.filter((_, i) => dropIdx.has(i)))
    list = list.filter((_, i) => !dropIdx.has(i))
  }
  if (extra.length) {
    appendFileSync(join(dir, 'archive.jsonl'), extra.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
    archived = extra.length
  }
  mustWriteJson(join(dir, 'facts.json'), list)
  return { kept: list.length, archived }
}

/** 读一段文本（profile.md / summary.md），没有返回 ''。 */
export function readTextSafe(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export function writeTextSafe(file, text) {
  mustWriteText(file, String(text || '').trim() + '\n')
}

export function profilePath(dir) {
  return join(dir, 'profile.md')
}
export function summaryPath(dir) {
  return join(dir, 'summary.md')
}
export function relationsPath(dir) {
  return join(dir, 'relations.md')
}
export function graphPath(dir) {
  return join(dir, 'relations.json')
}
export function diaryPath(dir) {
  return join(dir, 'diary.md')
}
export function selfPath(dir) {
  return join(dir, 'self.md')
}

/** 追加一篇日记（一天一篇，重复写同一天就追加一段） */
export function appendDiary(dir, text, day = '') {
  const t = String(text || '').trim()
  if (!t) return false
  const head = day ? `\n\n## ${day}\n` : '\n'
  try {
    appendFileSync(diaryPath(dir), head + t + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}
export function readDiary(dir, maxChars = 600) {
  const s = readTextSafe(diaryPath(dir))
  return s.length > maxChars ? s.slice(-maxChars) : s
}
export function writeSelf(dir, text) {
  const t = String(text || '').trim()
  if (!t) return false
  try {
    return atomicWriteText(selfPath(dir), t + '\n')
  } catch {
    return false
  }
}
export function readSelf(dir, maxChars = 400) {
  const s = readTextSafe(selfPath(dir))
  return s.length > maxChars ? s.slice(0, maxChars) : s
}

export function readRoomText(dir) {
  return {
    profile: readTextSafe(profilePath(dir)),
    summary: readTextSafe(summaryPath(dir)),
    relations: readTextSafe(relationsPath(dir)),
  }
}

/* ───────────── 检索：字符二元组 + BM25（中文没有空格，按 2 字切） ───────────── */

/** 去掉空白/标点后切成 2 字窗口（保留重复，BM25 要词频）。 */
export function bigramTokens(s) {
  const t = String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
  if (t.length === 1) return [t]
  const out = []
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2))
  return out
}

/**
 * BM25 打分：query 对每篇 doc 的相关度（0 = 完全不相关）。
 * 比"子串命中几个关键词"好在：常见字组（哈哈、什么）权重低，稀有的（人名、地名）权重高。
 * @returns {number[]} 与 docs 一一对应
 */
export function bm25Scores(query, docs, { k1 = 1.2, b = 0.75 } = {}) {
  const N = docs.length
  const q = [...new Set(bigramTokens(query))]
  if (!q.length || !N) return docs.map(() => 0)
  const toks = docs.map((d) => bigramTokens(d))
  const avg = toks.reduce((s, t) => s + t.length, 0) / N || 1
  const tfs = toks.map((t) => {
    const m = new Map()
    for (const x of t) m.set(x, (m.get(x) || 0) + 1)
    return m
  })
  const idf = new Map()
  for (const w of q) {
    let n = 0
    for (const m of tfs) if (m.has(w)) n += 1
    idf.set(w, Math.log(1 + (N - n + 0.5) / (n + 0.5)))
  }
  return tfs.map((m, i) => {
    let s = 0
    for (const w of q) {
      const tf = m.get(w)
      if (!tf) continue
      s += (idf.get(w) * (tf * (k1 + 1))) / (tf + k1 * (1 - b + (b * toks[i].length) / avg))
    }
    return s
  })
}

/** 读 archive.jsonl（被挤出的旧事实），返回 [{text, at}]。撤销掉的（undoneAt）不算。 */
export function readArchive(dir, limit = 500) {
  return readArchiveFull(dir, Math.max(2000, limit))
    .filter((o) => !o.undoneAt)
    .slice(-limit)
    .map((o) => ({ text: o.text, at: o.at }))
}

/** archive.jsonl 的完整记录（变化线 / 撤销要用 id、chainId、supersededAt 这些字段）。 */
const archiveCache = new Map() // dir -> { size, mtimeMs, lines }

export function readArchiveFull(dir, limit = 2000) {
  const file = join(dir, 'archive.jsonl')
  let st
  try {
    st = statSync(file)
  } catch {
    return []
  }
  const hit = archiveCache.get(dir)
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.lines.slice(-limit)
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const lines = raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        const o = JSON.parse(line)
        return o && o.text ? { ...o, text: String(o.text), at: Number(o.at) || 0 } : null
      } catch {
        return null
      }
    })
    .filter(Boolean)
  // 缓存最多留最近 2000 条，避免超长归档长期占内存
  const keep = lines.slice(-Math.max(2000, limit))
  archiveCache.set(dir, { size: st.size, mtimeMs: st.mtimeMs, lines: keep })
  return keep.slice(-limit)
}

/** 写 meta 的某个字段（profile/summary 的更新时间戳等）。 */
export function patchMeta(dir, patch) {
  const metaPath = join(dir, 'meta.json')
  const meta = readJsonSafe(metaPath, null) || {}
  Object.assign(meta, patch || {}, { updatedAt: Date.now() })
  mustWriteJson(metaPath, meta)
  return meta
}

/** 列出所有记忆目录（面板/诊断用）。 */export function listRooms(baseDir) {
  try {
    return readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const dir = join(baseDir, d.name)
        const meta = readJsonSafe(join(dir, 'meta.json'), null) || {}
        const facts = readJsonSafe(join(dir, 'facts.json'), [])
        return { slug: d.name, dir, meta, facts: Array.isArray(facts) ? facts.length : 0 }
      })
  } catch {
    return []
  }
}

/** 旧版 facts.json（一个文件装所有群）→ 每个会话一个文件夹。返回迁移了多少条。 */
export function migrateLegacy(baseDir, legacyFile, isGroupOf) {
  if (!existsSync(legacyFile)) return { migrated: 0, rooms: 0 }
  const legacy = readJsonSafe(legacyFile, null)
  if (!legacy || typeof legacy !== 'object') return { migrated: 0, rooms: 0 }
  let migrated = 0
  let roomCount = 0
  for (const [roomId, list] of Object.entries(legacy)) {
    if (!Array.isArray(list) || !list.length) continue
    const isGroup = typeof isGroupOf === 'function' ? !!isGroupOf(roomId) : true
    const { dir } = ensureRoom(baseDir, roomId, isGroup)
    const facts = list
      .map((x) =>
        typeof x === 'string'
          ? { text: x, at: Date.now() }
          : x && x.text
            ? { text: String(x.text), at: Number(x.at) || Date.now() }
            : null,
      )
      .filter(Boolean)
    writeRoomFacts(dir, facts)
    migrated += facts.length
    roomCount += 1
  }
  return { migrated, rooms: roomCount }
}
