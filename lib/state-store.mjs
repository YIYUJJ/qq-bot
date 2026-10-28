/**
 * 会话状态持久化（replied / usage）。
 *
 * 从 index.js 抽出的第二块业务代码：这两份数据每次回复都会变，
 * 但没必要每次都写盘 —— 脏标记 + 合并写（4 秒），退出时兜底 flush。
 */

export function createStateStore({ replied, usage, repliedFile, usageFile, writeJson, log = () => {}, flushMs = 4000, maxDays = 30 }) {
  let dirty = false
  let timer = null

  function flushStateNow() {
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
    flushStateNow,
    markStateDirty,
    recordReplied,
    alreadyReplied,
    noteUsage,
    usageView,
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
