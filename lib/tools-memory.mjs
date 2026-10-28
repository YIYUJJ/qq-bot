/**
 * 长期记忆工具：qqbot_memory。
 *
 * 依赖全部注入（记忆子系统仍在 index.js 里，后续可再抽成 memory-store 模块）：
 *   config / isManagedRoom / cfgFor / roomState / facts / factsOf / loadFacts / factNorm
 *   addFact / delFact / writeRoomFacts / memDirOf / readRoomText / readJson / graphPath
 *   updateProfile / updateSummary / updateRelations / extractFacts / searchMemory / exportMemory
 */
export function memoryTools(deps) {
  const {
    config,
    isManagedRoom,
    cfgFor,
    roomState,
    facts,
    factsOf,
    loadFacts,
    factNorm,
    addFact,
    delFact,
    writeRoomFacts,
    memDirOf,
    readRoomText,
    readJson,
    graphPath,
    updateProfile,
    updateSummary,
    updateRelations,
    extractFacts,
    searchMemory,
    exportMemory,
    textOut,
  } = deps

  return [
    {
      name: 'qqbot_memory',
      description:
        '长期记忆：list / add / del / clear / extract 提炼 / profile 画像 / summary 摘要 / relations 群内关系 / search 翻旧记忆 / show 全看。只有托管名单里的会话才记。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号（私聊用对方 QQ 号）' },
          action: {
            type: 'string',
            description: 'list | add | del | update | clear | extract | profile | summary | relations | search | export | graph | show | regenProfile | regenSummary',
          },
          text: { type: 'string', description: 'add 的内容 / update 的新内容 / del 的原内容' },
          old: { type: 'string', description: 'update 时被修改的原内容' },
        },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room || '').replace(/^group:/, '').trim()
        if (!roomId) throw new Error('room 为空')
        if (!isManagedRoom(roomId)) {
          return `这个会话不在记忆托管名单里（当前：${config.memoryRooms.join('、') || '空'}），不记录任何记忆。\n要开的话在面板「长期记忆」页的「维护记忆的会话」里加上 ${roomId}。`
        }
        const action = String(args?.action || 'list')
        if (action === 'add') return addFact(roomId, args?.text) ? '已记下' : '已存在（归一化后重复）'
        if (action === 'regenProfile') {
          const rr = await updateProfile(roomState(roomId))
          return rr.ok ? '画像已重新生成' : '失败：' + (rr.error || '模型返回空')
        }
        if (action === 'regenSummary') {
          const rr = await updateSummary(roomState(roomId))
          return rr.ok ? '摘要已重新生成' : '失败：' + (rr.error || '模型返回空')
        }
        if (action === 'del') return delFact(roomId, args?.text) ? '已删除' : '没找到这条'
        if (action === 'update') {
          const oldText = String(args?.old || '')
          const newText = String(args?.text || '').trim()
          if (!newText) return '新内容不能为空'
          const list = loadFacts(roomId)
          const idx = list.findIndex((x) => factNorm(x.text) === factNorm(oldText))
          if (idx < 0) return '没找到这条记忆'
          if (list.some((x, i) => i !== idx && factNorm(x.text) === factNorm(newText))) return '已经有一条一样的了'
          list[idx] = { ...list[idx], text: newText, editedAt: Date.now() }
          facts[roomId] = list
          writeRoomFacts(memDirOf(roomId), list, { keep: 60 })
          return `已修改，现在是：${newText}`
        }
        if (action === 'clear') {
          facts[roomId] = []
          writeRoomFacts(memDirOf(roomId), [], { keep: 60 })
          return '已清空该群记忆（归档文件保留）'
        }
        if (action === 'extract') {
          const r = await extractFacts(roomId)
          return r.ok ? `提炼出 ${r.added} 条${r.lines?.length ? '：' + r.lines.join(' / ') : ''}` : r.error
        }
        if (action === 'profile') {
          const r = await updateProfile(roomState(roomId))
          return r.ok ? r.text : r.error
        }
        if (action === 'summary') {
          const r = await updateSummary(roomState(roomId))
          return r.ok ? r.text : r.error
        }
        if (action === 'relations') {
          const r = await updateRelations(roomState(roomId))
          return r.ok ? r.text : r.error
        }
        if (action === 'search') {
          const hits = searchMemory(roomId, args?.text || args?.query || '', 10)
          return hits.length ? hits.map((h) => `[${h.kind}] ${h.text}`).join('\n') : '没翻到相关的旧记忆'
        }
        if (action === 'export') {
          const out = exportMemory(roomId)
          return out.ok ? `已导出 ${Object.keys(out.files).length} 个文件 → ${out.file}` : out.error
        }
        if (action === 'graph') {
          const dir = memDirOf(roomId)
          if (!dir) return '该会话不在记忆托管名单里'
          const g = readJson(graphPath(dir), null)
          if (!g || !g.nodes?.length) return '还没有关系图（先跑一次 relations 分析）'
          const nameOf = (id) => (g.nodes.find((n) => n.id === id) || {}).name || id
          return [
            `节点 ${g.nodes.length} 个：` + g.nodes.map((n) => `${n.name}(${n.msgs})`).join('、'),
            '主要互动：',
            ...g.edges.slice(0, 10).map((e) => `- ${nameOf(e.a)} ↔ ${nameOf(e.b)}：${e.w} 次`),
          ].join('\n')
        }
        if (action === 'show') {
          const dir = memDirOf(roomId)
          if (!dir) return '该会话不在记忆托管名单里'
          const t = readRoomText(dir)
          return [
            `目录：${dir}`,
            `画像（${t.profile.length} 字）：\n${t.profile || '（还没有）'}`,
            `摘要（${t.summary.length} 字）：\n${t.summary || '（还没有）'}`,
            `关系（${t.relations.length} 字）：\n${t.relations || '（还没有）'}`,
          ].join('\n\n')
        }
        const list = factsOf(roomId)
        const dir = memDirOf(roomId)
        if (!list.length) {
          return `群 ${roomId} 还没有长期记忆（自动提炼：${cfgFor(roomId).memoryExtract ? '开' : '关'}）\n目录：${dir}`
        }
        return [
          `群 ${roomId} 的记忆（${list.length} 条）｜目录 ${dir}`,
          ...list.map((f) => `- ${f.text}（${new Date(f.at).toLocaleDateString('zh-CN')}）`),
        ].join('\n')
      },
    },
  ]
}
