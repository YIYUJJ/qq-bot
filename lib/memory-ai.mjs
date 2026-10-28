/**
 * 长期记忆（模型侧）：提炼事实 / 翻旧账 / 群内关系。
 */
export const CREATEMEMORYAI_DEPS = ["addFact","analyze","buildRelationGraph","config","factsOf","generate","graphPath","invalidateRoomText","isManagedRoom","keywordsOf","log","memDirOf","normalizeEvent","ob","patchMeta","readArchive","relationsPath","roomState","roomTextOf","writeJson","writeTextSafe"]

export function createMemoryAi(deps) {
  const missing = CREATEMEMORYAI_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('记忆模型侧缺少依赖：' + missing.join(', '))
  const { addFact, analyze, buildRelationGraph, config, factsOf, generate, graphPath, invalidateRoomText, isManagedRoom, keywordsOf, log, memDirOf, normalizeEvent, ob, patchMeta, readArchive, relationsPath, roomState, roomTextOf, writeJson, writeTextSafe } = deps

  async function extractFacts(roomId) {
    const r = roomState(roomId)
    const recent = r.msgs.slice(-30)
    if (recent.length < 6) return { ok: false, error: '消息太少，攒够 6 条再提炼' }
    const existing = factsOf(roomId).map((x) => '- ' + x.text).join('\n')
    const user = [
      '从下面的群聊记录里提炼 1~3 条值得长期记住的事实（人物关系、偏好、约定、重要事件）。',
      '每行一条，不要编号、不要解释、不要编造；已经记过的不要重复。没有值得记的就输出「无」。',
      existing ? '\n已经记过的：\n' + existing : '',
      '',
      recent.map((m) => `${m.isSelf ? '我' : m.senderName}: ${m.text}`).join('\n'),
    ]
      .filter(Boolean)
      .join('\n')
    const { text } = await generate({
      system: '你是一个记忆整理器，只输出事实条目，每行一条。',
      user,
      maxTokens: 400,
      temperature: 0.3,
    })
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((s) => s.replace(/^[-•\d.、\s]+/, '').trim())
      .filter((s) => s && s !== '无')
      .slice(0, 3)
    let added = 0
    for (const l of lines) if (addFact(roomId, l)) added += 1
    r.lastExtractAt = Date.now()
    r.msgSinceExtract = 0
    return { ok: true, added, lines }
  }
  
  /** 自动提炼：攒够 N 条消息且过了冷却才触发；后台跑，不阻塞回复。 */
  /** 翻旧账：在 facts / archive / 摘要 / 关系 里按关键词找。 */
  function searchMemory(roomId, query, limit = 5) {
    if (!isManagedRoom(roomId)) return []
    const dir = memDirOf(roomId)
    if (!dir) return []
    const kws = keywordsOf(String(query || ''))
    const pool = []
    for (const f of factsOf(roomId)) pool.push({ kind: '事实', text: f.text, at: f.at || 0 })
    for (const a of readArchive(dir, 800)) pool.push({ kind: '归档', text: a.text, at: a.at || 0 })
    const t = roomTextOf(dir)
    for (const line of String(t.summary || '').split(/\n+/)) if (line.trim()) pool.push({ kind: '摘要', text: line.trim(), at: 0 })
    for (const line of String(t.relations || '').split(/\n+/)) if (line.trim()) pool.push({ kind: '关系', text: line.trim(), at: 0 })
    if (!pool.length) return []
    if (!kws.length) return pool.slice(-limit).reverse()
    const scored = pool
      .map((x) => ({ x, s: kws.filter((k) => x.text.includes(k)).length }))
      .filter((y) => y.s > 0)
      .sort((a, b) => b.s - a.s || (b.x.at || 0) - (a.x.at || 0))
    return scored.slice(0, Math.max(1, limit)).map((y) => y.x)
  }
  
  /** 群内关系分析：把最近的历史拉下来，让模型总结"谁和谁什么关系"。 */
  async function updateRelations(r) {
    const dir = memDirOf(r.roomId)
    if (!dir) return { ok: false, error: '该会话不在记忆托管名单里' }
    if (!r.isGroup) return { ok: false, error: '私聊没有"群内关系"可分析' }
    let msgs = []
    try {
      const data = await ob.call('get_group_msg_history', { group_id: r.roomId, count: 200 }, 12000)
      msgs = (data?.messages || []).map((m) => normalizeEvent(m, ob.status.self?.user_id)).filter((e) => e.text)
    } catch {
      msgs = r.msgs.slice(-200)
    }
    if (msgs.length < 10) return { ok: false, error: '消息太少（不足 10 条），多聊几句再分析' }
    const transcript = msgs
      .slice(-150)
      .map((m) => `${m.isSelf ? '我' : m.senderName}: ${m.text}`)
      .join('\n')
    const facts = factsOf(r.roomId).map((f) => '- ' + f.text).join('\n')
    const user = [
      '下面是这个群的聊天记录（"我"=机器人自己）。分析群成员之间的关系。',
      facts ? '已知事实：\n' + facts : '',
      '',
      transcript,
      '',
      '输出 Markdown，只写这几节：',
      '## 核心成员（谁活跃、大概的角色）',
      '## 互动关系（谁跟谁常对话、亲疏、有没有小圈子）',
      '## 相处方式（语气、玩笑尺度、明显禁忌）',
      '## 不确定的地方',
      '只写记录里能看出来的，不要编造真实身份；证据不足就写"看不出"。',
    ]
      .filter(Boolean)
      .join('\n')
    const { text: rawText, finish } = await analyze('你是群聊关系分析器，只输出 Markdown 正文。', user)
    const text = rawText.slice(0, 2500)
    if (!text) {
      log(`关系分析返回空（finish=${finish || '?'}）`)
      return { ok: false, error: `模型返回空（finish=${finish || '?'}，可能预算不够）` }
    }
    writeTextSafe(relationsPath(dir), text)
    invalidateRoomText(dir)
    // 顺手更新结构化关系图（纯统计，不花 token）
    try {
      writeJson(graphPath(dir), buildRelationGraph(r, msgs))
    } catch {
      /* ignore */
    }
    patchMeta(dir, { relationsAt: Date.now() })
    log(`关系分析已更新：${r.roomName || r.roomId}（${text.length} 字，样本 ${msgs.length} 条）`)
    return { ok: true, text, sample: msgs.length }
  }
  
  /** 启动清理：非托管会话的目录一律删掉（只保留名单里的）。 */
  return { extractFacts, searchMemory, updateRelations }
}
