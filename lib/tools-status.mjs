/**
 * 只读诊断类工具：qqbot_status / qqbot_rooms。
 *
 * 从 index.js 抽出的第一批工具定义。依赖全部注入，工具本身不碰闭包状态，
 * 因此可以用假 rooms/stats 直接单测。
 */
export function statusTools(deps) {
  const { connectInfo, stats, config, push, rooms, groupNames, allowedHere, mustReply, factsOf, cfgFor, textOut } = deps

  return [
    {
      name: 'qqbot_status',
      description: 'QQ 机器人状态：SnowLuma 连接/账号、开关、拟人参数、各群节流与最近决策。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const lines = ['== QQ 机器人状态 ==', connectInfo(), '']
        lines.push(
          `计数：收到 ${stats.msgsIn}｜回复 ${stats.replies}｜跳过 ${stats.skipped}｜拦截 ${stats.blocked}｜LLM ${stats.llmCalls}（失败 ${stats.llmErrors}）｜发出 ${stats.sends}` +
            `｜推送 ${stats.pushed || 0}（命中 ${stats.pushHits || 0}）${config.pushEnabled ? (push.listening ? '监听中' : '未监听') : '关'}`,
        )
        lines.push(`延迟：上次首字 ${stats.lastFirstTokenMs}ms｜总 ${stats.lastLatencyMs}ms`)
        lines.push(
          `拟人：闲聊 ${Math.round(config.replyProbability * 100)}%｜冷却 ${Math.round(config.minReplyGapMs / 1000)}s｜10min 上限 ${config.maxRepliesPer10Min}｜延迟倍率 ${config.delayScale}｜轮询 ${config.pollMs}ms｜安静时段 ${config.quietHours || 'off'}`,
        )
        lines.push(`白名单群：${config.allowGroups.join(', ') || '无'}（硬约束，其它群一律不碰）`)
        if (!rooms.size) {
          lines.push(`\n还没收到任何消息（已知群 ${groupNames.size} 个，其中授权 ${config.allowGroups.filter((g) => groupNames.has(String(g))).length} 个）`)
        }
        for (const r of rooms.values()) {
          if (!allowedHere(r) && !r.msgs.length) continue
          const last = r.msgs[r.msgs.length - 1]
          const label = r.isGroup ? `群「${r.roomName || r.roomId}」` : `私聊「${r.roomName || r.roomId}」`
          lines.push(
            `\n${label}${allowedHere(r) ? '' : '（未授权，仅记录）'}` +
              (mustReply(r, r.roomId) ? '｜必回' : '') +
              `｜10min 回 ${r.replyTimes.filter((t) => Date.now() - t < 600000).length}/${config.maxRepliesPer10Min}` +
              `｜上次回复 ${r.lastReplyAt ? Math.round((Date.now() - r.lastReplyAt) / 60000) + ' 分钟前' : '从未'}` +
              `｜记忆 ${factsOf(r.roomId).length} 条` +
              (cfgFor(r.roomId).memoryExtract
                ? `（提炼 ${r.msgSinceExtract || 0}/${Number(cfgFor(r.roomId).memoryExtractEvery) || 30}）`
                : '（自动提炼关）') +
              (r.isGroup ? `｜关系 ${r.msgSinceRelations || 0}/${Number(cfgFor(r.roomId).relationsEvery) || 300}` : '') +
              `｜最近决策：${r.lastDecision ? `${r.lastDecision.reason}` : '-'}`,
          )
          if (last) lines.push(`  最近：${last.isSelf ? '我' : last.senderName}: ${String(last.text).slice(0, 60)}`)
        }
        const silent = groupNames.size - rooms.size
        if (silent > 0) lines.push(`\n（另有 ${silent} 个群还没收到过消息，不展开）`)
        return lines.join('\n')
      },
    },
    {
      name: 'qqbot_rooms',
      description: '列出机器人见过的 QQ 群/私聊，含是否在白名单、活跃时间、最近决策。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        if (!rooms.size) return `还没收到任何消息（已知群 ${groupNames.size} 个，不会列出未活动的群）。`
        const lines = []
        for (const r of rooms.values()) {
          lines.push(
            `${r.roomName || r.roomId}（${r.roomId}）｜${allowedHere(r) ? '已授权' : '未授权'}｜消息 ${r.msgs.length} 条｜最后活跃 ${r.lastActivityAt ? Math.round((Date.now() - r.lastActivityAt) / 60000) + ' 分钟前' : '-'}`,
          )
        }
        const silent = groupNames.size - rooms.size
        if (silent > 0) lines.push(`（另有 ${silent} 个群还没收到过消息）`)
        return lines.join('\n')
      },
    },
  ]
}
