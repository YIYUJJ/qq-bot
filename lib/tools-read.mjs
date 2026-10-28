/**
 * 只读查看类工具：qqbot_history / qqbot_outbox。
 *
 * 依赖注入：rooms / outbox / flushOutbox / textOut。
 */
export function readTools(deps) {
  const { rooms, outbox, flushOutbox, textOut } = deps

  return [
    {
      name: 'qqbot_history',
      description: '看某个群最近的消息记录（只读）。room 可用群号、群名，留空且只有一个群时自动选。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号或群名；只有一个群时可留空' },
          limit: { type: 'number', description: '条数，默认 20，最多 100' },
        },
      },
      output: textOut,
      async execute(args) {
        const key = String(args?.room ?? '').trim()
        let r = rooms.get(key)
        if (!r && key) {
          for (const x of rooms.values()) if (x.roomName === key) r = x
        }
        if (!r && !key && rooms.size === 1) r = [...rooms.values()][0]
        if (!r) throw new Error(`找不到群：${key || '（有多个群，请指定）'}`)
        const n = Math.max(1, Math.min(100, Number(args?.limit) || 20))
        const lines = [`群「${r.roomName || r.roomId}」最近 ${n} 条：`]
        for (const m of r.msgs.slice(-n)) {
          const t = new Date(m.ts).toLocaleTimeString('zh-CN', { hour12: false })
          lines.push(`${t} ${m.isSelf ? '我' : m.senderName}: ${m.text}`)
        }
        return lines.join('\n')
      },
    },
    {
      name: 'qqbot_outbox',
      description: '发送失败重试队列：看有哪些消息在排队等重发，或立刻重发一次。',
      parameters: {
        type: 'object',
        properties: {
          flush: { type: 'boolean', description: 'true=立刻尝试重发一次' },
        },
      },
      output: textOut,
      async execute(args) {
        if (args?.flush) await flushOutbox()
        if (!outbox.count) return '重发队列为空'
        return [
          `待重发 ${outbox.count} 条（最多重试 5 次 / 10 分钟）：`,
          ...outbox
            .list({ limit: 20 })
            .map((x) => `- ${x.roomId}｜${x.kind}｜第 ${x.attempts} 次｜${x.preview}｜${String(x.lastError).slice(0, 60)}`),
        ].join('\n')
      },
    },
  ]
}
