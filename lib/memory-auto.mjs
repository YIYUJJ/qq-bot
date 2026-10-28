/**
 * 自动抽取：maybeAutoExtract
 */
export const CREATEMAYBEAUTOEXTRACT_DEPS = ["cfgFor","extractFacts","isManagedRoom","log","updateProfile","updateRelations","updateSummary"]

export function createMaybeAutoExtract(deps) {
  const missing = CREATEMAYBEAUTOEXTRACT_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('maybeAutoExtract 缺少依赖：' + missing.join(', '))
  const { cfgFor, extractFacts, isManagedRoom, log, updateProfile, updateRelations, updateSummary } = deps

  function maybeAutoExtract(r) {
    if (!isManagedRoom(r.roomId)) return
    const c = cfgFor(r.roomId)
    // 画像：只有显式开了 profileEvery 的群才自动重生成（默认 0=关，其他群不受影响）
    const everyProf = Number(c.profileEvery) || 0
    if (everyProf >= 10) {
      r.msgSinceProfile = (r.msgSinceProfile || 0) + 1
      if (r.msgSinceProfile >= everyProf && Date.now() - (r.lastProfileAt || 0) > 3600000 && !r.profileBusy) {
        r.msgSinceProfile = 0
        r.lastProfileAt = Date.now()
        r.profileBusy = true
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
      void updateSummary(r).catch((e) => log('摘要更新失败：' + String(e?.message || e)))
    }
    // 关系分析：每 N 条消息刷新一次，至少隔 relationsCooldownMs（默认 7 天）
    r.msgSinceRelations = (r.msgSinceRelations || 0) + 1
    const everyRel = Math.max(50, Number(c.relationsEvery) || 300)
    const relCool = Math.max(3600000, Number(c.relationsCooldownMs) || 7 * 86400000)
    if (r.isGroup && r.msgSinceRelations >= everyRel && Date.now() - (r.lastRelationsAt || 0) > relCool) {
      r.msgSinceRelations = 0
      r.lastRelationsAt = Date.now()
      void updateRelations(r).catch((e) => log('关系分析失败：' + String(e?.message || e)))
    }
    if (!c.memoryExtract) return
    r.msgSinceExtract = (r.msgSinceExtract || 0) + 1
    const every = Math.max(5, Number(c.memoryExtractEvery) || 25)
    if (r.msgSinceExtract < every) return
    const cooldown = Math.max(600000, Number(c.memoryExtractCooldownMs) || 6 * 3600_000)
    if (r.lastExtractAt && Date.now() - r.lastExtractAt < cooldown) return
    r.msgSinceExtract = 0
    r.lastExtractAt = Date.now()
    void extractFacts(r.roomId)
      .then((res) => {
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
  }

  return maybeAutoExtract
}
