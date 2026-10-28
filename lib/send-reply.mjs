/**
 * 自动抽取：sendReply
 */
export const CREATESENDREPLY_DEPS = ["assertGroupAllowed","cfgFor","cleanReply","config","enqueueSend","gapMs","log","maybeSendSticker","metrics","normText","ob","shouldRetrySend","sleep","splitMessage","stats"]

export function createSendReply(deps) {
  const missing = CREATESENDREPLY_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('sendReply 缺少依赖：' + missing.join(', '))
  const { assertGroupAllowed, cfgFor, cleanReply, config, enqueueSend, gapMs, log, maybeSendSticker, metrics, normText, ob, shouldRetrySend, sleep, splitMessage, stats } = deps

  async function sendReply(r, { text, quoteTo, priority, atUser, noSticker }) {
    const c = cfgFor(r.roomId)
    if (r.isGroup) assertGroupAllowed(r.roomId)
    else if (!config.allowPrivate.includes(String(r.roomId)) && !config.adminQQ.includes(String(r.roomId))) {
      throw new Error(`私聊 ${r.roomId} 不在白名单（当前：${config.allowPrivate.join(', ') || '空'}；管理员：${config.adminQQ.join(', ') || '空'}）`)
    }
    // 这次说几句：优先用本次回复的目标句数（长度浮动），否则回落到群配置
    const lineCap = Math.max(1, Math.min(4, Number(r.lineTarget) || Number(c.maxLines) || 3))
    const charCap = Number(r.replyCharsCap) || Number(c.maxReplyChars) || 300
    const clean = cleanReply(text, { maxLen: charCap, maxLines: lineCap })
    if (!clean) return []
    const parts = splitMessage(clean, {
      chance: Number(c.splitChance) || 0,
      maxParts: lineCap,
    })
    if (config.dryRun) {
      log(`[演练] ${r.roomName || r.roomId} → ${parts.join(' / ')}`)
      return parts
    }
    const sent = []
    const scale = Math.max(0, Math.min(3, Number(c.delayScale ?? 1)))
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      // 第一条立刻发（首句要快）；只有分条之间才有拟人停顿，约 0.2~1.1 秒
      if (i > 0 && scale > 0) {
        const gap = Math.min(2500, (220 + Math.random() * 480 + Math.min(400, [...part].length * 12)) * scale)
        if (gap > 0) await sleep(gap)
      }
      // 偶尔真 @ 一下对方（被 @ 时更自然）；私聊没有 @ 段
      const useAt =
        r.isGroup && i === 0 && atUser && c.allowAt && Math.random() < Number(c.atMentionChance)
      try {
        let res = null
        if (!r.isGroup) res = await ob.sendPrivate(r.roomId, part)
        else if (i === 0 && quoteTo) res = await ob.sendGroupReply(r.roomId, quoteTo, part)
        else if (useAt)
          res = await ob.sendGroupSegments(r.roomId, [
            { type: 'at', data: { qq: String(atUser) } },
            { type: 'text', data: { text: ' ' + part } },
          ])
        else res = await ob.sendGroup(r.roomId, part)
        const mid = res?.message_id ?? res?.data?.message_id
        if (mid) r.lastBotMsgId = String(mid)
        sent.push(part)
      } catch (e) {
        stats.lastError = String(e?.message || e)
        log('发送失败：' + stats.lastError)
        // 网络类失败：把这条和剩下没发的都排进重试队列
        if (shouldRetrySend(stats.lastError)) {
          for (const rest of parts.slice(i)) {
            enqueueSend({
              roomId: r.roomId,
              isGroup: r.isGroup,
              kind: r.isGroup ? 'text' : 'private',
              payload: rest,
              error: stats.lastError,
            })
          }
        }
        break
      }
      if (i < parts.length - 1) await sleep(gapMs() * scale)
    }
    // 回完顺手拍一下对方（真人聊得热络时会这样）
    if (sent.length && atUser && c.pokeOnReply && Math.random() < Number(c.pokeOnReply)) {
      try {
        await ob.sendPoke({ groupId: r.isGroup ? r.roomId : undefined, userId: atUser })
      } catch {
        /* 拍不动就算了，不影响回复 */
      }
    }
    // 文字之后偶尔补一张群里的图（图库是收消息时攒的；私聊不发图，避免打扰）；一次回复最多一张
    if (!noSticker && sent.length) await maybeSendSticker(r, c)
    stats.sends += sent.length
    r.lastReplyAt = Date.now()
    r.replyTimes.push(Date.now())
    r.replyTimes = r.replyTimes.filter((t) => Date.now() - t < 3600000)
    if (clean) {
      r.repliedTexts = (r.repliedTexts || []).filter((x) => Date.now() - x.at < 3600000)
      r.repliedTexts.push({ norm: normText(clean), at: Date.now() })
    }
    // 一条都没发出去就不算「回复过」（否则面板会显示假成功）
    if (sent.length) {
      stats.replies += 1
      metrics.inc('replies')
      stats.lastAt = Date.now()
    }
    return sent
  }

  return sendReply
}
