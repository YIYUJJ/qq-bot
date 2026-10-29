/**
 * 自动抽取：maybeAutoExtract
 *
 * 计数器（msgSince* / last*At）会落到 meta.json 的 autoCounters 里：
 * 插件一天重启上百次时，纯内存计数永远攒不到阈值，记忆就停住了。
 */
export const CREATEMAYBEAUTOEXTRACT_DEPS = ["cfgFor","extractFacts","isManagedRoom","log","memDirOf","patchMeta","readRoomMemory","updateProfile","updateRelations","updateSummary"]

/** 需要跨重启保留的计数器 */
export const AUTO_COUNTER_KEYS = [
  'msgSinceExtract',
  'msgSinceSummary',
  'msgSinceRelations',
  'msgSinceProfile',
  'lastExtractAt',
  'lastSummaryAt',
  'lastRelationsAt',
  'lastProfileAt',
  'extractCursorTs', // 提炼进度：上次处理到哪条消息的时间戳
]
/** 每攒这么多次变化才写一次盘；有任务触发时立即写 */
const SAVE_EVERY = 5

export function createMaybeAutoExtract(deps) {
  const missing = CREATEMAYBEAUTOEXTRACT_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('maybeAutoExtract 缺少依赖：' + missing.join(', '))
  const { cfgFor, extractFacts, isManagedRoom, log, memDirOf, patchMeta, readRoomMemory, updateProfile, updateRelations, updateSummary } = deps

  /** 每个会话第一次进来时，把上次落盘的计数器合并回内存。 */
  function restoreCounters(r, dir) {
    if (r.memCountersRestored) return
    r.memCountersRestored = true
    let saved
    try {
      saved = (readRoomMemory(dir).meta || {}).autoCounters
    } catch {
      return
    }
    if (!saved || typeof saved !== 'object') return
    for (const k of AUTO_COUNTER_KEYS) {
      const v = Number(saved[k]) || 0
      if (k.startsWith('msgSince')) r[k] = (Number(r[k]) || 0) + v
      else r[k] = Math.max(Number(r[k]) || 0, v)
    }
  }

  function saveCounters(r, dir, force) {
    r.memCountersDirty = (r.memCountersDirty || 0) + 1
    if (!force && r.memCountersDirty < SAVE_EVERY) return
    const snap = {}
    for (const k of AUTO_COUNTER_KEYS) snap[k] = Number(r[k]) || 0
    try {
      patchMeta(dir, { autoCounters: snap })
      r.memCountersDirty = 0
    } catch (e) {
      log('记忆计数器落盘失败：' + String(e?.message || e))
    }
  }

  function maybeAutoExtract(r) {
    if (!isManagedRoom(r.roomId)) return
    const dir = memDirOf(r.roomId)
    if (dir) restoreCounters(r, dir)
    let fired = false
    try {
      fired = step(r)
    } finally {
      if (dir) saveCounters(r, dir, fired)
    }
  }

  /** @returns {boolean} 这次是否触发了任何后台任务 */
  function step(r) {
    let fired = false
    const c = cfgFor(r.roomId)
    // 画像：只有显式开了 profileEvery 的群才自动重生成（默认 0=关，其他群不受影响）
    const everyProf = Number(c.profileEvery) || 0
    if (everyProf >= 10) {
      r.msgSinceProfile = (r.msgSinceProfile || 0) + 1
      if (r.msgSinceProfile >= everyProf && Date.now() - (r.lastProfileAt || 0) > 3600000 && !r.profileBusy) {
        r.msgSinceProfile = 0
        r.lastProfileAt = Date.now()
        r.profileBusy = true
        fired = true
        void updateProfile(r)
          .then((res) => { if (res?.ok) log(`自动画像：${r.roomName || r.roomId} 已更新`) })
          .catch((e) => log('自动画像失败：' + String(e?.message || e)))
          .finally(() => { r.profileBusy = false })
      }
    }
    // 摘要独立于提炼：每 N 条消息更新一次，至少隔 10 分钟
    r.msgSinceSummary = (r.msgSinceSummary || 0) + 1
    const everySum = Math.max(20, Number(c.memorySummaryEvery) || 80)
    if (r.msgSinceSummary >= everySum && Date.now() - (r.lastSummaryAt || 0) > 600000) {
      r.msgSinceSummary = 0
      r.lastSummaryAt = Date.now()
      fired = true
      void updateSummary(r).catch((e) => log('摘要更新失败：' + String(e?.message || e)))
    }
    // 关系分析：每 N 条消息刷新一次，至少隔 relationsCooldownMs（默认 7 天）
    r.msgSinceRelations = (r.msgSinceRelations || 0) + 1
    const everyRel = Math.max(50, Number(c.relationsEvery) || 300)
    const relCool = Math.max(3600000, Number(c.relationsCooldownMs) || 7 * 86400000)
    if (r.isGroup && r.msgSinceRelations >= everyRel && Date.now() - (r.lastRelationsAt || 0) > relCool) {
      r.msgSinceRelations = 0
      r.lastRelationsAt = Date.now()
      fired = true
      void updateRelations(r).catch((e) => log('关系分析失败：' + String(e?.message || e)))
    }
    if (!c.memoryExtract) return fired
    r.msgSinceExtract = (r.msgSinceExtract || 0) + 1
    const every = Math.max(5, Number(c.memoryExtractEvery) || 25)
    if (r.msgSinceExtract < every) return fired
    const cooldown = Math.max(600000, Number(c.memoryExtractCooldownMs) || 6 * 3600_000)
    if (r.lastExtractAt && Date.now() - r.lastExtractAt < cooldown) return fired
    r.msgSinceExtract = 0
    r.lastExtractAt = Date.now()
    void extractFacts(r.roomId)
      .then((res) => {
        // 记忆增强钩子（人物卡等）：有增删改就通知一次
        if (res?.ok && (res.added || res.updated || res.deleted) && typeof deps.afterExtract === 'function') {
          try {
            deps.afterExtract(r, res)
          } catch (e) {
            log('提炼后处理失败：' + String(e?.message || e))
          }
        }
        if (res.ok && res.added) {
          log(`自动记忆：${r.roomName || r.roomId} 新增 ${res.added} 条`)
          // 事实有新增时，顺手把画像刷新一下（最多 3 天一次）
          const dir = memDirOf(r.roomId)
          if (dir) {
            const meta = readRoomMemory(dir).meta || {}
            if (!meta.profileAt || Date.now() - Number(meta.profileAt) > 3 * 86400000) {
              void updateProfile(r).catch((e) => log('画像更新失败：' + String(e?.message || e)))
            }
          }
        }
      })
      .catch((e) => log('自动记忆失败：' + String(e?.message || e)))
    return true
  }

  return maybeAutoExtract
}
