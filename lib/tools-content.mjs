/**
 * 内容类工具：qqbot_diary / qqbot_vision。
 *
 * 依赖注入：
 *   diary   getFeatures / isManagedRoom / memDirOf / readDiary / readSelf / rooms
 *   vision  describeImage / config / assertGroupAllowed / roomState
 */
export function contentTools(deps) {
  const { getFeatures, isManagedRoom, memDirOf, readDiary, readSelf, rooms, describeImage, config, assertGroupAllowed, roomState, textOut } = deps

  return [
    {
      name: 'qqbot_diary',
      description: '日记与自述：run 立刻按今天的聊天写一篇；read 看最近的日记和"我是谁"。只对托管会话有效。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'run | read' },
          room: { type: 'string', description: '群号；read 时可选，不传就列托管群' },
        },
        required: ['action'],
      },
      output: textOut,
      async execute(args) {
        const action = String(args?.action || 'read')
        if (action === 'run') {
          await getFeatures().maybeDiary(true)
          return '日记任务跑完了（看日志或 read 查看）'
        }
        const roomId = String(args?.room || '').trim().replace(/^group:/, '')
        if (roomId) {
          if (!isManagedRoom(roomId)) return '这个会话不在托管名单里'
          const dir = memDirOf(roomId)
          if (!dir) return '拿不到记忆目录'
          const d = readDiary(dir, 1200)
          const sf = readSelf(dir, 600)
          return ['== 日记 ==', d || '（还没写）', '', '== 我是谁 ==', sf || '（还没写）'].join('\n')
        }
        const out = []
        for (const rr of rooms.values()) {
          if (!isManagedRoom(rr.roomId)) continue
          const dir = memDirOf(rr.roomId)
          if (!dir) continue
          const d = readDiary(dir, 200)
          out.push((rr.roomName || rr.roomId) + '：' + (d ? d.slice(-80).replace(/\n/g, ' ') : '（还没写）'))
        }
        return out.join('\n') || '没有托管会话'
      },
    },
    {
      name: 'qqbot_vision',
      description:
        '识图：给一个图片 URL 让视觉模型描述；不给 URL 就看白名单群里最近一条带图消息。用于验证识图/识表情包链路。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '图片或表情包的 URL；留空则用最近一条带图消息' },
          room: { type: 'string', description: '群号（url 留空时用；缺省取第一个白名单群）' },
        },
      },
      output: textOut,
      async execute(args) {
        const url = String(args?.url || '').trim()
        if (url) {
          const t0 = Date.now()
          const d = await describeImage(url, 'image')
          return d ? `描述（${Date.now() - t0}ms）：${d}` : '没拿到描述（看插件日志里的「识图失败」）'
        }
        const roomId = String(args?.room || config.allowGroups[0] || '')
        if (!roomId) throw new Error('没有白名单群')
        assertGroupAllowed(roomId)
        const r = roomState(roomId)
        for (let i = r.msgs.length - 1; i >= 0; i--) {
          const m = r.msgs[i]
          if (m.vision?.length) {
            const t = new Date(m.ts).toLocaleTimeString('zh-CN', { hour12: false })
            return `最近一条带图消息（${t} ${m.senderName}）：\n${m.vision.join(' / ')}`
          }
        }
        return `群 ${roomId} 最近没有带图的消息（或识图没开）`
      },
    },
  ]
}
