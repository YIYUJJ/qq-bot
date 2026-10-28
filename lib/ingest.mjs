/**
 * 原始消息 → 统一事件。
 *
 * 把 OneBot 的 group/private 两种形状抹平成 onEvent 能用的事件，
 * 单条坏消息只跳过、不影响整批（历史接口偶尔返回脏数据）。
 *
 * 依赖注入：normalizeEvent（协议归一化）+ getSelfId（自己 QQ 号）。
 */
export function createIngest({ normalizeEvent, getSelfId }) {
  return function ingestHistory(messages, peerId) {
    const out = []
    const selfId = String(getSelfId() ?? '')
    for (const m of messages || []) {
      try {
        const ev = normalizeEvent(m, selfId)
        if (peerId && String(m?.message_type) === 'private') {
          ev.roomId = String(peerId)
          ev.isGroup = false
          ev.sender = String(m?.user_id ?? '')
          if (ev.sender === selfId) ev.isSelf = true
        }
        if (ev.roomId) out.push(ev)
      } catch {
        /* 单条坏了跳过 */
      }
    }
    return out
  }
}
