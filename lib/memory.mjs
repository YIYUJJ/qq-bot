/**
 * 按会话独立的记忆目录。
 *
 * 为什么从"一个 facts.json 装所有群"改成"每个会话一个文件夹"：
 *   1. 长期养的记忆会越来越大（事实 + 画像 + 事件流），塞一个文件既难维护也难备份；
 *   2. 每群独立文件夹后，可以直接看/拷/删某个群的记忆，不会牵动别的群；
 *   3. 满了可以往 archive.jsonl 里归档，而不是把老记忆挤掉。
 *
 * 目录结构：
 *   <base>/group-975427049/{meta.json, facts.json, archive.jsonl}
 *   <base>/private-2237116031/{meta.json, facts.json, archive.jsonl}
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

export function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
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
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8')
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
export function writeRoomFacts(dir, facts, { keep = 60, archive = [] } = {}) {
  mkdirSync(dir, { recursive: true })
  const list = Array.isArray(facts) ? facts.slice() : []
  const extra = Array.isArray(archive) ? archive.slice() : []
  let archived = 0
  if (list.length > keep) {
    const drop = list.splice(0, list.length - keep)
    extra.push(...drop)
  }
  if (extra.length) {
    appendFileSync(join(dir, 'archive.jsonl'), extra.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
    archived = extra.length
  }
  writeFileSync(join(dir, 'facts.json'), JSON.stringify(list, null, 2) + '\n', 'utf8')
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
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, String(text || '').trim() + '\n', 'utf8')
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
    writeFileSync(selfPath(dir), t + '\n', 'utf8')
    return true
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

/** 读 archive.jsonl（被挤出的旧事实），返回 [{text, at}]。 */
const archiveCache = new Map() // dir -> { size, mtimeMs, lines }

export function readArchive(dir, limit = 500) {
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
        return o && o.text ? { text: String(o.text), at: Number(o.at) || 0 } : null
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
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8')
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
