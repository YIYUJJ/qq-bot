/**
 * 会话状态持久化（replied / usage）。
 *
 * 从 index.js 抽出的第二块业务代码：这两份数据每次回复都会变，
 * 但没必要每次都写盘 —— 脏标记 + 合并写（4 秒），退出时兜底 flush。
 */

export function createStateStore({ replied, usage, repliedFile, usageFile, writeJson, log = () => {}, flushMs = 4000, maxDays = 30 }) {
  let dirty = false
  let timer = null
  let db = null // SQLite 状态库（可选，失败时退回 JSON）

  /**
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
  }

  function markStateDirty() {
    dirty = true
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      flushStateNow()
    }, flushMs)
    if (timer.unref) timer.unref()
  }

  /** 记一条"已回复"，7 天内同 id 去重，每会话最多留 100 条 */
  function recordReplied(roomId, id) {
    if (!id) return false
    const k = String(roomId)
    const list = (replied[k] || []).filter((x) => Date.now() - (x.at || 0) < 7 * 86400000)
    if (list.some((x) => x.id === String(id))) return false
    list.push({ id: String(id), at: Date.now() })
    replied[k] = list.slice(-100)
    markStateDirty()
    return true
  }

  function alreadyReplied(roomId, id) {
    if (!id) return false
    const k = String(roomId)
    const list = replied[k] || []
    return list.some((x) => x.id === String(id) && Date.now() - (x.at || 0) < 7 * 86400000)
  }

  /** 累加 token 用量，按天分桶，只留 30 天 */
  function noteUsage(u) {
    if (!u) return
    const p = Number(u.inputTokens ?? u.promptTokens ?? 0) || 0
    const c = Number(u.outputTokens ?? u.completionTokens ?? 0) || 0
    usage.prompt += p
    usage.completion += c
    usage.total += p + c
    usage.calls += 1
    const day = new Date().toISOString().slice(0, 10)
    const d = usage.byDay[day] || { prompt: 0, completion: 0, total: 0, calls: 0 }
    d.prompt += p
    d.completion += c
    d.total += p + c
    d.calls += 1
    usage.byDay[day] = d
    const days = Object.keys(usage.byDay).sort()
    while (days.length > maxDays) delete usage.byDay[days.shift()]
    markStateDirty()
  }

  function usageView() {
    const days = Object.keys(usage.byDay).sort().slice(-7)
    return {
      total: usage.total,
      calls: usage.calls,
      today: usage.byDay[new Date().toISOString().slice(0, 10)] || { total: 0, calls: 0 },
      days: days.map((d) => ({ day: d, ...usage.byDay[d] })),
    }
  }

  return {
    attachDb,
    flushStateNow,
    markStateDirty,
    recordReplied,
    alreadyReplied,
    noteUsage,
    usageView,
    get backend() {
      return db ? db.backend : "json"
    },
    get dirty() {
      return dirty
    },
    dispose() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      return flushStateNow()
    },
  }
}
