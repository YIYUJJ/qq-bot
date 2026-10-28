/**
 * 通知事件处理（撤回 / 拍一拍）。
 *
 * 从 index.js 抽出：只处理 notice 语义，副作用通过依赖注入：
 *   roomState / cfgFor / allowedHere / setMood / scheduleFlush
 * 这样可以用假 ob + 假房间状态单测，不用启动整个插件。
 */
export function createNoticeHandler({ ob, config, log, roomState, cfgFor, allowedHere, setMood, scheduleFlush }) {
  let noticeShapes = 0 // 记录"没有 target_id"的原始形状，最多 3 次，方便以后适配

  async function handleNotice(n) {
    const t = String(n?.notice_type || '')
    const sub = String(n?.sub_type || '')
    // 有人撤回消息：上下文里标一下，别拿撤回的内容当事实
    if (t === 'group_recall' || t === 'friend_recall') {
      const roomId = String(n?.group_id || n?.user_id || '')
      const mid = String(n?.message_id || '')
      if (roomId && mid) {
        const r = roomState(roomId)
        const m = r.msgs.find((x) => String(x.id) === mid)
        if (m) m.text = '[已撤回]'
        if (r.lastBotMsgId && String(r.lastBotMsgId) === mid) r.lastBotMsgId = ''
        log('有人撤回了消息 ' + mid + '（' + roomId + '）')
      }
      return
    }
    if (!(t === 'notify' && sub === 'poke')) return
    const selfId = String(ob.status.self?.user_id ?? '')
    const from = String(n?.user_id ?? '')
    const target = String(n?.target_id ?? n?.user_id ?? '')
    // 有些实现不带 target_id：记一次原始形状，方便以后适配
    if (!n?.target_id && from && from !== selfId && noticeShapes < 3) {
      noticeShapes += 1
      log('poke notice 没有 target_id：' + JSON.stringify(n).slice(0, 220))
    }
    const groupId = String(n?.group_id ?? '')
    const roomId = groupId || from
    if (!roomId) return
    const r = roomState(roomId)
    r.isGroup = !!groupId
    r.lastActivityAt = Date.now()
    if (from && from === selfId) return // 自己拍自己，忽略
    if (target && target !== selfId) return // 别人拍别人，不管

    let name = r.nameCache.get(from) || ''
    if (!name && groupId) {
      try {
        const m = await ob.groupMember(groupId, from)
        name = String(m?.card || m?.nickname || '')
      } catch {
        /* 拿不到就用 QQ 号 */
      }
    }
    name = name || from || '有人'
    if (from) r.nameCache.set(from, name)

    // 先判断"这个群/私聊现在该不该有动作"：停用、未授权、或该群关了拍一拍，都不动
    const c = cfgFor(r.roomId)
    const active = config.enabled && allowedHere(r) && c.pokeOnMe
    if (active) setMood(r, '被惹到', 1) // 被戳了，嘴硬一下
    if (active && c.pokeBack && Math.random() < Number(c.pokeChance)) {
      try {
        await ob.sendPoke({ groupId: groupId || undefined, userId: from })
        log(`被 ${name} 拍了拍 → 拍回去`)
      } catch (e) {
        log('拍回去失败：' + String(e?.message || e))
      }
    } else {
      log(`被 ${name} 拍了拍${active ? '' : '（当前不活跃，只记录）'}`)
    }

    if (!active) return
    // 防连拍刷屏：刚回过就先只拍不接话
    if (r.lastReplyAt && Date.now() - r.lastReplyAt < Number(c.minReplyGapMs)) return
    r.pending.push({
      id: '',
      roomId: r.roomId,
      isGroup: r.isGroup,
      sender: from,
      senderName: name,
      text: '（拍了拍你）',
      isAtMe: true,
      atAll: false,
      images: 0,
      imageUrls: [],
      ts: Date.now(),
    })
    scheduleFlush(r)
  }

  return { handleNotice }
}
