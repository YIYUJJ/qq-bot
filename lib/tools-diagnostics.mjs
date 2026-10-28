/**
 * 诊断类工具（第二批）：qqbot_llm_models / qqbot_stickers。
 *
 * 依赖注入：getLlm（懒取，避免启动时 llm 还没就绪）、stickers、existsSync、textOut。
 */
export function diagnosticTools(deps) {
  const { getLlm, stickers, existsSync, textOut } = deps

  return [
    {
      name: 'qqbot_llm_models',
      description: '列出当前 DSH 可用的模型路由（provider 及其模型），用来给识图/主模型挑一个能用的 provider+model。',
      parameters: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: '可选：只看这个 provider 的模型列表' },
        },
      },
      output: textOut,
      async execute(args) {
        const llm = getLlm()
        if (!llm) throw new Error('没有 llm 服务')
        const providers = (llm.listProviders?.() || []).map((p) => p.id)
        const only = String(args?.provider || '').trim()
        const list = only ? [only] : providers
        const lines = [`provider（${providers.length}）：${providers.join(', ') || '无'}`]
        for (const p of list) {
          try {
            const models = (await llm.listModels(p)) || []
            const ids = models.slice(0, 12).map((m) => m.id)
            lines.push(`\n${p}（${models.length}）：${ids.join(', ')}${models.length > 12 ? ' …' : ''}`)
            const vision = models.filter((m) => (m.inputModalities || []).includes('image'))
            if (vision.length) lines.push(`  ↳ 支持图片：${vision.map((m) => m.id).join(', ')}`)
          } catch (e) {
            lines.push(`\n${p}：读取失败 ${String(e?.message || e)}`)
          }
        }
        return lines.join('\n')
      },
    },
    {
      name: 'qqbot_stickers',
      description: '查看表情包库：每张的来源、是否已收进 QQ 收藏（收藏后才能以表情气泡发出）、使用次数、是否失效。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const ids = Object.keys(stickers)
        if (!ids.length) return '图库是空的：群里有人发表情/图片后会自动收进来'
        const rows = ids
          .map((k) => ({ k, s: stickers[k] }))
          .sort((a, b) => (b.s.at || 0) - (a.s.at || 0))
          .slice(0, 40)
        const fav = ids.filter((k) => stickers[k].emojiId).length
        const local = ids.filter((k) => stickers[k].file && existsSync(stickers[k].file)).length
        const bad = ids.filter((k) => stickers[k].bad).length
        return [
          `图库 ${ids.length} 张｜已收进收藏 ${fav}｜有本地文件 ${local}｜失效 ${bad}`,
          ...rows.map(
            ({ k, s }) =>
              `- ${k}${s.subType ? ' 表情' : ' 图片'}${s.emojiId ? ' ★收藏' : ''}${s.bad ? ' ❌失效' : ''}${s.file && existsSync(s.file) ? ' 📁本地' : ''}｜用 ${s.uses || 0} 次`,
          ),
        ].join('\n')
      },
    },
  ]
}
