/**
 * 轻量动作工具：qqbot_poke / qqbot_search。
 *
 * 依赖注入：assertGroupAllowed / config / ob / sensitiveQuery / webSearch / textOut。
 */
export function actionTools(deps) {
  const { assertGroupAllowed, config, ob, sensitiveQuery, webSearch, textOut } = deps

  return [
    {
      name: 'qqbot_poke',
      description: '拍一拍白名单群里的某个人（OneBot send_poke），用来验证拍一拍链路。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号（必须在白名单）' },
          user: { type: 'string', description: '要拍的 QQ 号' },
        },
        required: ['room', 'user'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room || '').replace(/^group:/, '')
        assertGroupAllowed(roomId)
        const uid = String(args?.user || '').trim()
        if (!uid) throw new Error('user 为空')
        if (config.dryRun) return `[演练] 未拍：${uid}`
        await ob.sendPoke({ groupId: roomId, userId: uid })
        return `已拍 ${uid}（群 ${roomId}）`
      },
    },
    {
      name: 'qqbot_search',
      description: '用 DSH 的联网搜索查一条信息（只读，不发群消息），用来验证"让它去搜"这条链路。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '查询词' },
          count: { type: 'number', description: '最多几条结果，默认 5' },
        },
        required: ['query'],
      },
      output: textOut,
      async execute(args) {
        const q = String(args?.query || '').trim()
        if (!q) throw new Error('query 为空')
        const bad = sensitiveQuery(q)
        if (bad) return `没搜：${bad}（不把隐私发给搜索引擎）`
        const t0 = Date.now()
        const r = await webSearch(q, Math.max(1, Math.min(10, Number(args?.count) || 5)), Number(config.searchTimeoutMs) || 8000)
        return `搜索「${q}」→ ${r.count} 条（${Date.now() - t0}ms）\n\n${r.text || '（没有结果）'}`
      },
    },
  ]
}
