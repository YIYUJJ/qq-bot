/**
 * 自检类工具：qqbot_selftest / qqbot_selfcheck。
 *
 * selftest 会真实回放一条历史消息走完整链路；selfcheck 只汇总诊断项。
 *
 * 依赖注入：assertGroupAllowed / ob / normalizeEvent / roomState / stats / onEvent /
 *           log / sleep / cfgFor / config / selfcheck / textOut。
 */
export function selftestTools(deps) {
  const { assertGroupAllowed, ob, normalizeEvent, roomState, stats, onEvent, log, sleep, cfgFor, config, selfcheck, textOut } = deps

  return [
    {
      name: 'qqbot_selftest',
      description:
        '收消息链路自测：把白名单群里最新一条别人发的消息重新注入一遍，走真实「收到→判定→生成→发送」流程并返回耗时。用于确认轮询/推送到底能不能收到消息。',
      parameters: {
        type: 'object',
        properties: { room: { type: 'string', description: '群号（必须在白名单）' } },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room ?? '').trim().replace(/^group:/, '')
        assertGroupAllowed(roomId)
        const data = await ob.call('get_group_msg_history', { group_id: roomId, count: 20 }, 8000)
        const self = String(ob.status.self?.user_id ?? '')
        let ev = null
        for (const m of data?.messages || []) {
          const cand = normalizeEvent(m, self)
          if (!cand.roomId || !cand.text) continue
          if (String(m?.user_id ?? '') === self) continue
          if (!ev || cand.ts >= ev.ts) ev = cand
        }
        if (!ev) throw new Error('历史里没有别人发的文本消息可回放')
        const r = roomState(roomId)
        r.seen.delete(ev.id)
        const before = stats.replies
        const t0 = Date.now()
        void onEvent(ev).catch((e) => log('消息处理失败：' + String(e?.message || e)))
        for (let i = 0; i < 60; i++) {
          if (stats.replies > before) break
          await sleep(500)
        }
        const replied = stats.replies > before
        return [
          `回放：${ev.senderName}: ${String(ev.text).slice(0, 60)}（${new Date(ev.ts).toLocaleTimeString('zh-CN', { hour12: false })}）`,
          replied
            ? `✅ 已回复，端到端 ${Date.now() - t0}ms（@ 快车道合批 ${Number(cfgFor(roomId).fastDebounceMs) || 400}ms + 拟人延迟 ×${config.delayScale}${config.streamSend ? '｜流式已开' : ''}）`
            : `❌ 未回复（决策：${r.lastDecision?.reason ?? '未知'}）`,
          `首字 ${stats.lastFirstTokenMs}ms｜模型侧 ${stats.lastLatencyMs}ms`,
        ].join('\n')
      },
    },
    {
      name: 'qqbot_selfcheck',
      description: '自检明细：WS/HTTP/白名单/收消息通路/模型路由（会验证 provider 是否真的有模型）/视觉路由/日志可写。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const h = await selfcheck()
        const icon = (lv) => (lv === 'ok' ? '✅' : lv === 'warn' ? '⚠️ ' : '❌')
        const lines = h.items.map((it) => `${icon(it.level)} ${it.name}：${it.text}` + (it.advice ? `\n   → ${it.advice}` : ''))
        lines.push('', `异常 ${h.bad.length} 项｜提醒 ${h.warn.length} 项`)
        if (h.bad.length) lines.push('异常项：' + h.bad.join('、'))
        return lines.join('\n')
      },
    },
  ]
}
