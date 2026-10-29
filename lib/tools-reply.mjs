/**
 * 发送类工具：qqbot_say（原样发） / qqbot_ask（强制生成再发）。
 *
 * 依赖注入：
 *   say  assertGroupAllowed / roomState / config / sendWithRetry / stats
 *   ask  assertGroupAllowed / roomState / buildSearchNote / buildTranscript / config /
 *        generate / systemPrompt / sendReply / log
 */
export function replyTools(deps) {
  const { assertGroupAllowed, roomState, config, sendWithRetry, stats, buildSearchNote, buildTranscript, generate, systemPrompt, sendReply, log, textOut } = deps

  return [
    {
      name: 'qqbot_say',
      description: '以机器人身份往指定群发一条纯文本（不走模型）。只允许白名单群。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号' },
          text: { type: 'string', description: '要发的文本' },
        },
        required: ['room', 'text'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room ?? '').trim().replace(/^group:/, '')
        assertGroupAllowed(roomId)
        const text = String(args?.text ?? '').trim()
        if (!text) throw new Error('text 为空')
        const r = roomState(roomId)
        if (config.dryRun) return `[演练] 未发送：${text}`
        const res = await sendWithRetry(roomId, true, 'text', text)
        if (res.queued) return `网络抖动，已排入重发队列：${text}（${res.error}）`
        stats.sends += 1
        r.lastReplyAt = Date.now()
        return `已发送到 ${roomId}：${text}`
      },
    },
    {
      name: 'qqbot_ask',
      description: '强制生成并发送（忽略概率/冷却，用于测试回复与延迟）。room 必须在白名单。返回首字与总耗时。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号' },
          prompt: { type: 'string', description: '对它说的话；留空则用该群最近一条消息' },
          at: { type: 'string', description: '可选：要 @ 的 QQ 号（验证 at 段是否可用）' },
        },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room ?? '').trim().replace(/^group:/, '')
        assertGroupAllowed(roomId)
        const r = roomState(roomId)
        const prompt = String(args?.prompt ?? '').trim() || r.msgs[r.msgs.length - 1]?.text || '在吗'
        const hit = await buildSearchNote(r, prompt)
        const block = hit?.text
          ? `\n【联网搜索结果（${hit.query}）】\n${hit.text}\n（用平时口气转述，别念来源、别列条目；至少说出 1~2 个具体信息，没有相关的就说没查到。）`
          : ''
        const user = [
          buildTranscript(r, Number(config.contextMessages) || 20),
          block,
          '',
          `现在有人对你说：「${prompt}」`,
          '自然地回一句。',
        ]
          .filter((x) => x !== '')
          .join('\n')
        const t0 = Date.now()
        if (typeof deps.prepareMemory === 'function') await deps.prepareMemory(r, prompt).catch(() => {})
        const { text, firstTokenMs, usage } = await generate({ system: systemPrompt(r), user })
        const sent = await sendReply(r, { text, priority: 'at', atUser: String(args?.at || '') })
        log(
          `[测试] ${r.roomName || r.roomId}｜首字 ${firstTokenMs}ms 总 ${Date.now() - t0}ms` +
            (hit?.count ? `｜联网 ${hit.count} 条` : '') +
            `｜${sent.join(' / ')}`,
        )
        return [
          `首字 ${firstTokenMs}ms｜总 ${Date.now() - t0}ms${usage ? `｜token ${usage.inputTokens ?? '?'}/${usage.outputTokens ?? '?'}` : ''}` +
            (hit?.count ? `｜联网 ${hit.count} 条（${hit.ms}ms）` : hit?.skipped ? `｜未联网：${hit.skipped}` : ''),
          `已发：${sent.join(' / ')}`,
        ].join('\n')
      },
    },
  ]
}
