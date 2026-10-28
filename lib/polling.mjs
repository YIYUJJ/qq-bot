/**
 * 长轮询兜底（WS 不可靠时靠它收消息）。
 *
 * 本机实测 SnowLuma 的 WS 只推心跳、不推群消息，所以白名单群 + 私聊改用
 * get_*_msg_history 对齐；启动时先建基线，避免一上线就回一堆旧消息。
 *
 * 依赖注入：config / ob / ingestHistory / onEvent / roomState / log。
 */
export const POLLING_DEPS = ['config', 'ob', 'ingestHistory', 'onEvent', 'roomState', 'log']

export function createPolling(deps) {
  const missing = POLLING_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('轮询缺少依赖：' + missing.join(', '))
  const { config, ob, ingestHistory, onEvent, roomState, log } = deps
  let polling = false

  /** 私聊轮询目标：白名单 + 管理员。 */
  function privateTargets() {
    return [...new Set([...config.allowPrivate, ...config.adminQQ].map(String).filter(Boolean))]
  }

  async function primeAllowed() {
    // 只把「冷消息」当基线吞掉：插件重载/短暂离线期间进来的消息仍然算新消息，
    // 否则用户刚发的「在」会被静默错过（实测踩过）。
    const cutoff = Date.now() - Math.max(60000, (Number(config.pollMs) || 3000) * 3)

    function absorb(r, messages, peerId) {
      let fresh = 0
      for (const ev of ingestHistory(messages, peerId)) {
        const isFresh = ev.ts >= cutoff
        if (typeof ev.isGroup === 'boolean') r.isGroup = ev.isGroup
        if (ev.id && !isFresh) r.seen.add(ev.id)
        if (isFresh) fresh += 1
        r.msgs.push({
          id: ev.id,
          ts: ev.ts,
          sender: ev.sender,
          senderName: ev.senderName || ev.sender,
          isSelf: ev.isSelf,
          isAtMe: ev.isAtMe,
          text: ev.text,
          images: ev.images,
        })
      }
      if (r.msgs.length > 200) r.msgs.splice(0, r.msgs.length - 200)
      r.lastActivityAt = r.msgs.length ? r.msgs[r.msgs.length - 1].ts : 0
      return fresh
    }

    for (const gid of config.allowGroups) {
      try {
        const data = await ob.call('get_group_msg_history', { group_id: gid, count: 10 }, 8000)
        const r = roomState(gid)
        r.isGroup = true
        const fresh = absorb(r, data?.messages)
        log(`基线：群 ${gid} 已有 ${r.msgs.length} 条（吞掉旧消息，保留 ${fresh} 条待处理）`)
      } catch (e) {
        log(`基线读取失败 ${gid}：${String(e?.message || e)}`)
      }
    }
    // 私聊没有 WS 推送，必须靠轮询；这里先建基线，避免一启动就回一堆旧消息
    for (const uid of privateTargets()) {
      try {
        const data = await ob.call('get_friend_msg_history', { user_id: uid, count: 10 }, 8000)
        const r = roomState(uid)
        r.isGroup = false
        const fresh = absorb(r, data?.messages, uid)
        log(`基线：私聊 ${uid} 已有 ${r.msgs.length} 条（保留 ${fresh} 条待处理）`)
      } catch (e) {
        log(`私聊基线读取失败 ${uid}：${String(e?.message || e)}`)
      }
    }
  }

  async function pollOnce() {
    if (polling || !config.pollMs) return
    if (!config.allowGroups.length && !privateTargets().length) return
    polling = true
    try {
      // 群 + 私聊并行拉，别串行等多次往返
      await Promise.all([
        ...config.allowGroups.map(async (gid) => {
          try {
            const data = await ob.call('get_group_msg_history', { group_id: gid, count: 10 }, 8000)
            for (const ev of ingestHistory(data?.messages)) {
              void onEvent(ev).catch((e) => log('消息处理失败：' + String(e?.message || e)))
            }
          } catch {
            /* 单群失败不影响其它 */
          }
        }),
        ...privateTargets().map(async (uid) => {
          try {
            const data = await ob.call('get_friend_msg_history', { user_id: uid, count: 10 }, 8000)
            for (const ev of ingestHistory(data?.messages, uid)) {
              void onEvent(ev).catch((e) => log('私聊消息处理失败：' + String(e?.message || e)))
            }
          } catch {
            /* 单个私聊失败不影响其它 */
          }
        }),
      ])
    } finally {
      polling = false
    }
  }

  return { primeAllowed, pollOnce, privateTargets, isPolling: () => polling }
}
