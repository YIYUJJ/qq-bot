/**
 * 会话运行时状态：按需创建 room 对象，并把"已回复 id / 成员显示名"装回去。
 */
export const ROOM_STATE_DEPS = ['groupNames', 'replied', 'rooms', 'savedNames']

export function createRoomState(deps) {
  const missing = ROOM_STATE_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('会话状态缺少依赖：' + missing.join(', '))
  const { groupNames, replied, rooms, savedNames } = deps

  function roomState(roomId, roomName) {
    const key = String(roomId)
    let r = rooms.get(key)
    if (!r) {
      r = {
        roomId: key,
        roomName: roomName || groupNames.get(key) || '',
        isGroup: key.length > 8,
        msgs: [],
        pending: [],
        timer: null,
        replyTimes: [],
        lastReplyAt: 0,
        lastActivityAt: 0,
        lastProactiveAt: 0,
        lastDecision: null,
        lastSender: '',
        streak: 0,
        nameCache: new Map(),
        seen: new Set(),
        flushing: false,
        lastSearchAt: 0,
        muteUntil: 0,
        mood: { name: '', at: 0, intensity: 0 }, // 情绪状态（困/馋/得意/委屈…）
        lineTarget: 0, // 这次回复打算说几句（长度浮动用）
        replyCharsCap: 0, // 这次回复的字数上限（跟着句数走）
      }
      // 重启后把"已回复过的消息 id"装回去，避免对同一条再回一遍
      for (const x of replied[key] || []) if (x?.id) r.seen.add(String(x.id))
      // 面板里保存过的成员显示名也装回去
      for (const [uid, nm] of Object.entries(savedNames[key] || {})) {
        if (uid && nm) r.nameCache.set(String(uid), String(nm))
      }
      rooms.set(key, r)
    }
    if (roomName && !r.roomName) r.roomName = roomName
    return r
  }

  return { roomState }
}
