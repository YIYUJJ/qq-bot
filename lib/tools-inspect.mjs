/**
 * 调试/查看类工具：qqbot_prompt / qqbot_reminders。
 *
 * 依赖注入：
 *   prompt      roomState / systemPrompt / factsOf / isManagedRoom / cfgFor / moodName / pickLineTarget
 *   reminders   reminders / getFeatures / writeJson / remindersFile
 */
export function inspectTools(deps) {
  const { roomState, systemPrompt, factsOf, isManagedRoom, cfgFor, moodName, pickLineTarget, textOut, reminders, getFeatures, writeJson, remindersFile } = deps

  return [
    {
      name: 'qqbot_prompt',
      description:
        '只读调试：返回某个会话**真正**发给模型的系统提示词（人设、记忆、画像、规则全在里面）。用来确认"记忆/人设到底有没有生效"。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号或 QQ 号' },
        },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room ?? '').trim().replace(/^group:/, '')
        const r = roomState(roomId)
        // 和真实回复一样：先按最近聊天算语义查询向量，看到的才是"现在会带哪些记忆"
        if (typeof deps.prepareMemory === 'function') await deps.prepareMemory(r).catch(() => {})
        const sys = systemPrompt(r)
        const facts = factsOf(roomId)
        return [
          `== ${r.roomName || roomId} 的系统提示词（${sys.length} 字）==`,
          '',
          sys,
          '',
          '== 诊断 ==',
          `托管会话：${isManagedRoom(roomId) ? '是' : '否'}`,
          `记忆事实：${facts.length} 条（factsLimit=${cfgFor(roomId).factsLimit}）`,
          (() => {
            const name = moodName(r)
            if (!name) return '心情状态：（平静/无）'
            const mins = Math.round((Date.now() - (r.mood?.at || 0)) / 60000)
            return `心情状态：${name}${mins >= 0 ? `（${mins} 分钟前触发）` : ''}`
          })(),
          `长度浮动：${cfgFor(roomId).lengthSpread ? '开' : '关'}｜若现在回复会说到 ${pickLineTarget(cfgFor(roomId), cfgFor(roomId).moodEnabled ? moodName(r) : '')} 句`,
          ...facts.map((f) => '  - ' + f.text),
        ].join('\n')
      },
    },
    {
      name: 'qqbot_reminders',
      description: '定时提醒：list 看排队的提醒；run 立刻检查一次（到点的发出去）；clear 清空。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'list | run | clear' },
        },
        required: ['action'],
      },
      output: textOut,
      async execute(args) {
        const action = String(args?.action || 'list')
        if (action === 'run') {
          const before = reminders.length
          await getFeatures().checkReminders()
          return `检查完：原有 ${before} 条，剩 ${reminders.length} 条`
        }
        if (action === 'clear') {
          reminders.length = 0
          try {
            writeJson(remindersFile, reminders)
          } catch {
            /* ignore */
          }
          return '已清空提醒'
        }
        if (!reminders.length) return '没有排队的提醒'
        return reminders
          .slice()
          .sort((a, b) => a.at - b.at)
          .map((x) => {
            const d = new Date(x.at)
            return `${d.toLocaleString('zh-CN', { hour12: false })}｜${x.roomId}｜${x.text}`
          })
          .join('\n')
      },
    },
  ]
}
