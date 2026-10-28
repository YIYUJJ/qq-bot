import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/state-store.mjs', 'utf8')

s = s.replace(
  'export function createStateStore({ replied, usage, repliedFile, usageFile, writeJson, log = () => {}, flushMs = 4000, maxDays = 30 }) {\n  let dirty = false\n  let timer = null',
  `export function createStateStore({ replied, usage, repliedFile, usageFile, writeJson, log = () => {}, flushMs = 4000, maxDays = 30 }) {
  let dirty = false
  let timer = null
  let db = null // SQLite 状态库（可选，失败时退回 JSON）`,
)

s = s.replace(
  `  function flushStateNow() {
    if (!dirty) return false
    dirty = false
    try {
      writeJson(repliedFile, replied)
      writeJson(usageFile, usage)
      return true
    } catch (e) {
      log('状态写盘失败：' + String(e?.message || e))
      return false
    }
  }`,
  `  /**
   * 挂上 SQLite 状态库：库空则把现有 JSON 导入；库非空则以库为准。
   * 失败不影响主流程（继续用 JSON）。
   */
  function attachDb(d) {
    if (!d) return { ok: false }
    db = d
    try {
      if (d.isEmpty()) {
        d.save(replied, usage)
        log('状态库：空库，已把现有 JSON 导入（' + Object.keys(replied).length + ' 个会话）')
        return { ok: true, imported: true }
      }
      const snap = d.load()
      for (const k of Object.keys(replied)) delete replied[k]
      if (snap.replied && typeof snap.replied === 'object') Object.assign(replied, snap.replied)
      if (snap.usage && typeof snap.usage === 'object') {
        for (const k of Object.keys(usage)) delete usage[k]
        Object.assign(usage, snap.usage)
        if (!usage.byDay || typeof usage.byDay !== 'object') usage.byDay = {}
      }
      log('状态库：已从 ' + d.backend + ' 载入（' + Object.keys(replied).length + ' 个会话）')
      return { ok: true, imported: false }
    } catch (e) {
      log('状态库载入失败（继续用 JSON）：' + String(e?.message || e))
      db = null
      return { ok: false, error: String(e?.message || e) }
    }
  }

  function flushStateNow() {
    if (!dirty) return false
    dirty = false
    let wrote = false
    try {
      writeJson(repliedFile, replied)
      writeJson(usageFile, usage)
      wrote = true
    } catch (e) {
      log('状态写盘失败：' + String(e?.message || e))
    }
    if (db) {
      try {
        db.save(replied, usage)
        wrote = true
      } catch (e) {
        log('状态库写入失败：' + String(e?.message || e))
      }
    }
    return wrote
  }`,
)

s = s.replace(
  '  return {\n    flushStateNow,',
  '  return {\n    attachDb,\n    flushStateNow,',
)
s = s.replace(
  '    get dirty() {\n      return dirty\n    },',
  '    get backend() {\n      return db ? db.backend : "json"\n    },\n    get dirty() {\n      return dirty\n    },',
)

writeFileSync('lib/state-store.mjs', s, 'utf8')
console.log('state-store 已支持 attachDb')
