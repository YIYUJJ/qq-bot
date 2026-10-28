/**
 * 长期记忆（模型侧）：提炼事实 / 翻旧账 / 群内关系。
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { profilePath, summaryPath, roomSlug, readRoomText } from './memory.mjs'
export const CREATEMEMORYAI_DEPS = ["DATA_DIR","addFact","analyze","buildRelationGraph","config","factsOf","generate","graphPath","invalidateRoomText","isGroupRoom","isManagedRoom","keywordsOf","log","memDirOf","normalizeEvent","ob","patchMeta","readArchive","relationsPath","roomState","roomTextOf","whoHint","writeJson","writeTextSafe"]

export function createMemoryAi(deps) {
  const missing = CREATEMEMORYAI_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('记忆模型侧缺少依赖：' + missing.join(', '))
  const { isGroupRoom, DATA_DIR, addFact, analyze, buildRelationGraph, factsOf, generate, graphPath, invalidateRoomText, isManagedRoom, keywordsOf, log, memDirOf, normalizeEvent, ob, patchMeta, readArchive, relationsPath, roomState, roomTextOf, whoHint, writeJson, writeTextSafe } = deps
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
  function exportMemory(roomId) {
    const id = String(roomId)
    const dir = memDirOf(id)
    if (!dir) return { ok: false, error: '该会话不在记忆托管名单里' }
    const files = {}
    for (const name of [
      'meta.json',
      'facts.json',
      'archive.jsonl',
      'profile.md',
      'summary.md',
      'relations.md',
      'relations.json',
    ]) {
      const p = join(dir, name)
      if (existsSync(p)) files[name] = readFileSync(p, 'utf8')
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const outDir = join(DATA_DIR, 'exports')
    mkdirSync(outDir, { recursive: true })
    const outFile = join(outDir, `memory-${roomSlug(id, isGroupRoom(id))}-${stamp}.json`)
    writeJson(outFile, { exportedAt: new Date().toISOString(), roomId: id, dir, files })
    log(`记忆导出：${id} → ${outFile}`)
    return { ok: true, file: outFile, files }
  }
  
  /** 滚动摘要：把旧摘要和最近对话合并成一段，长期保留"之前聊过什么"。 */
  async function updateSummary(r) {
    const dir = memDirOf(r.roomId)
    if (!dir) return { ok: false, error: '该会话不在记忆托管名单里' }
    const old = readRoomText(dir).summary
    const recent = r.msgs.slice(-80)
    if (recent.length < 8 && !old) return { ok: false, error: '消息太少（不足 8 条，且没有旧摘要）' }
    const user = [
      whoHint(r),
      old ? '已有摘要：\n' + old : '',
      '',
      '最近的对话：',
      recent.map((m) => `${m.isSelf ? '我' : m.senderName}: ${m.text}`).join('\n'),
      '',
      '把已有摘要和最近对话合并成一段不超过 400 字的中文摘要：保留人物、关系、约定、正在进行的事；去掉寒暄和重复；不要逐句复述。只输出摘要正文。',
    ]
      .filter(Boolean)
      .join('\n')
    const { text: rawText, finish } = await analyze('你是聊天摘要器，只输出摘要正文。', user)
    const text = rawText.slice(0, 900)
    if (!text) {
      log(`摘要返回空（finish=${finish || '?'}）`)
      return { ok: false, error: `模型返回空（finish=${finish || '?'}）` }
    }
    writeTextSafe(summaryPath(dir), text)
    invalidateRoomText(dir)
    patchMeta(dir, { summaryAt: Date.now() })
    log(`摘要已更新：${r.roomName || r.roomId}（${text.length} 字）`)
    return { ok: true, text }
  }
  
  /** 人物画像：谁在这里、关系、性格、禁忌——长期维持"关系感"。 */
  async function updateProfile(r) {
    const dir = memDirOf(r.roomId)
    if (!dir) return { ok: false, error: '该会话不在记忆托管名单里' }
    const list = factsOf(r.roomId)
    if (!list.length) return { ok: false, error: '还没有事实可整理（先提炼或手动加几条）' }
    const old = readRoomText(dir).profile
    const user = [
      whoHint(r),
      old ? '现有画像：\n' + old : '',
      '',
      '已知事实：',
      list.slice(-40).map((f) => '- ' + f.text).join('\n'),
      '',
      '最近聊天片段：',
      r.msgs.slice(-20).map((m) => `${m.isSelf ? '我' : m.senderName}: ${m.text}`).join('\n'),
      '',
      '输出 5~10 行中文画像：这里有哪些人、你和他们的关系、各人的性格与偏好、禁忌/别踩的点、这里的常用梗。不要编造，没把握的别写。只输出画像正文。',
    ]
      .filter(Boolean)
      .join('\n')
    const { text: rawText, finish } = await analyze('你是人物画像整理器，只输出画像正文。', user)
    const text = rawText.slice(0, 1200)
    if (!text) {
      log(`画像返回空（finish=${finish || '?'}）`)
      return { ok: false, error: `模型返回空（finish=${finish || '?'}）` }
    }
    writeTextSafe(profilePath(dir), text)
    invalidateRoomText(dir)
    patchMeta(dir, { profileAt: Date.now(), profileFacts: list.length })
    log(`画像已更新：${r.roomName || r.roomId}（${text.length} 字）`)
    return { ok: true, text }
  }
  
  /** 自动提炼 / 摘要：只在托管会话里跑，攒够量且过冷却才触发。 */
  return { extractFacts, searchMemory, updateRelations, exportMemory, updateSummary, updateProfile }
}
