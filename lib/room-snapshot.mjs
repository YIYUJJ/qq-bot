/**
 * 面板「群与人」页的单房间快照（带签名缓存，状态没变就不重建对象）。
 *
 * 依赖注入：factsOf / countOverrides / roomOverrideOf / allowedHere / cfgFor / config / panelRoomCache。
 */
export const ROOM_SNAPSHOT_DEPS = ['factsOf', 'countOverrides', 'roomOverrideOf', 'allowedHere', 'cfgFor', 'config', 'panelRoomCache']

export function createRoomSnapshot(deps) {
  const missing = ROOM_SNAPSHOT_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('房间快照缺少依赖：' + missing.join(', '))
  const { factsOf, countOverrides, roomOverrideOf, allowedHere, cfgFor, config, panelRoomCache } = deps

  function roomSnapshot(r) {
    const now = Date.now()
    const factsN = factsOf(r.roomId).length
    const ovN = countOverrides(roomOverrideOf(r.roomId))
    const replies10m = r.replyTimes.filter((t) => now - t < 600000).length
    const sig = [
      r.lastActivityAt, r.msgs.length, replies10m, r.lastReplyAt, factsN, ovN,
      r.lastDecision?.at || 0, r.muteUntil || 0, r.msgSinceExtract || 0, r.streak || 0,
      r.roomName || '', allowedHere(r) ? 1 : 0,
      Number(cfgFor(r.roomId).memoryExtractEvery) || 0, cfgFor(r.roomId).memoryExtract ? 1 : 0,
    ].join('|')
    const hit = panelRoomCache.get(r.roomId)
    if (hit && hit.sig === sig) return hit.obj
    const obj = {
      roomId: r.roomId,
      roomName: r.roomName,
      isGroup: r.isGroup,
      allowed: allowedHere(r),
      msgs: r.msgs.length,
      facts: factsN,
      memory: {
        sinceExtract: r.msgSinceExtract || 0,
        every: Number(cfgFor(r.roomId).memoryExtractEvery) || 30,
        lastExtractAt: r.lastExtractAt || 0,
        auto: !!cfgFor(r.roomId).memoryExtract,
      },
      lastActivityAt: r.lastActivityAt,
      lastReplyAt: r.lastReplyAt,
      proactiveStreak: r.streak || 0,
      decision: r.lastDecision,
      overrideCount: ovN,
      policy: {
        replies10m,
        maxRepliesPer10Min: Number(config.maxRepliesPer10Min) || 0,
      },
      recent: r.msgs.slice(-8).map((m) => ({
        ts: m.ts,
        isSelf: m.isSelf,
        who: m.isSelf ? '我' : m.senderName,
        text: m.text,
      })),
    }
    panelRoomCache.set(r.roomId, { sig, obj })
    return obj
  }

  return roomSnapshot
}
