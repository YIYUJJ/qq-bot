/**
 * 记忆增强的面板接口：op 名去掉 "memplus." 前缀后分发到这里。
 *
 * 只做"读状态 + 手动触发 + 手动修正"，所有自动行为仍由各自的开关控制。
 */
import { freshness } from './memory-store.mjs'
import { emotionOf, confidenceOf, EMOTIONS, SOURCES } from './memory-deep.mjs'

export const MEMPLUS_API_DEPS = [
  'config', 'getMemPlus', 'getEmbedder', 'getChatLog', 'isManagedRoom', 'factsOf',
  'updateFact', 'deleteFactById', 'scoreFacts', 'extractFacts', 'roomState', 'log',
]

export function createMemPlusApi(deps) {
  const missing = MEMPLUS_API_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('记忆增强面板接口缺少依赖：' + missing.join(', '))
  const { config, getMemPlus, getEmbedder, getChatLog, isManagedRoom, factsOf, updateFact, deleteFactById, scoreFacts, extractFacts, roomState, log } = deps
  // 可选：记忆深化（理解 / 整理记录 / 想起往事 / 我们的故事 / 变化线 / 联想）
  const getMemDeep = typeof deps.getMemDeep === 'function' ? deps.getMemDeep : () => null
  const store = deps.store || null
  const deep = () => {
    const d = getMemDeep()
    if (!d) throw new Error('记忆深化没有加载')
    return d
  }

  const need = (room) => {
    if (!room) throw new Error('先选一个会话')
    if (!isManagedRoom(room)) throw new Error('这个会话不在「维护记忆的会话」名单里')
  }

  function factView(f, extra = {}) {
    const { emotion, intensity } = emotionOf(f)
    return {
      emotion,
      intensity,
      source: f.source || '',
      sourceBy: f.sourceBy || '',
      sourceByName: f.sourceByName || '',
      confidence: confidenceOf(f),
      chainId: f.chainId || f.id,
      versions: Number(extra.versions) || 1,
      links: Number(extra.links) || 0,
      assoc: !!extra.assoc,
      id: f.id,
      text: f.text,
      at: Number(f.at) || 0,
      importance: Number(f.importance) || 2,
      who: f.who || '',
      whoName: f.whoName || '',
      due: f.due || '',
      followedAt: Number(f.followedAt) || 0,
      uses: Number(f.uses) || 0,
      lastUsedAt: Number(f.lastUsedAt) || 0,
      freshness: Math.round(freshness(f, Number(config.memoryHalfLifeDays) || 30, Date.now(), config.emotionSlowFade !== false) * 100) / 100,
    }
  }
  /** 每条记忆有几个版本（变化线）、几条联想 */
  function extrasOf(room, list) {
    const out = new Map()
    let chains = new Map()
    let links = {}
    try {
      chains = store?.chainsFor ? store.chainsFor(room, list) : new Map()
    } catch {
      chains = new Map()
    }
    try {
      links = getMemDeep()?.links.counts(room) || {}
    } catch {
      links = {}
    }
    for (const f of list) out.set(f.id, { versions: (chains.get(f.id) || []).filter((n) => n.kind === '版本').length || 1, links: links[f.id] || 0 })
    return out
  }

  return async function memPlusAction(op, args = {}) {
    const room = String(args.room || '')
    const mp = getMemPlus()
    switch (op) {
      /* ── 面板待办（导航红点 / 总览「需要你处理的」）：所有托管会话加起来 ── */
      case 'todo': {
        const out = { review: 0, pending: 0, rooms: [] }
        const d = getMemDeep()
        if (!d) return out
        for (const rid of config.memoryRooms || []) {
          try {
            const s = d.status(String(rid))
            if (!s) continue
            const review = s.insights.review || 0
            const pending = s.consolidation.pending || 0
            out.review += review
            out.pending += pending
            if (review || pending) out.rooms.push({ room: String(rid), review, pending })
          } catch {
            /* 单个会话读失败不影响别的 */
          }
        }
        return out
      }
      case 'status': {
        const s = mp.status(room)
        try {
          s.deep = getMemDeep()?.status(room) || null
        } catch {
          s.deep = null
        }
        return s
      }

      /* ── 记忆明细（带重要度 / 使用次数 / 新鲜度 / 跟进日期） ── */
      case 'facts': {
        need(room)
        const list = factsOf(room)
        const ex = extrasOf(room, list)
        return { facts: list.map((f) => factView(f, ex.get(f.id))), emotions: EMOTIONS, sources: SOURCES }
      }
      case 'fact.update': {
        need(room)
        const patch = {}
        if (args.text !== undefined) patch.text = String(args.text)
        if (args.importance !== undefined) patch.importance = Number(args.importance)
        if (args.due !== undefined) patch.due = String(args.due || '')
        if (args.who !== undefined) {
          patch.who = String(args.who || '')
          patch.whoName = String(args.whoName || '')
        }
        // 记忆深化：情绪 / 强度、来源、把握度（面板手动改）
        if (args.emotion !== undefined) {
          patch.emotion = String(args.emotion || '平静')
          patch.intensity = Number(args.intensity) || 1
        } else if (args.intensity !== undefined) patch.intensity = Number(args.intensity) || 1
        if (args.source !== undefined) {
          const cur = factsOf(room).find((x) => x.id === String(args.id || ''))
          const src = String(args.source || '')
          // 只改来源这一项时，原来的"谁说的"留着
          patch.source = src
          if (cur && cur.source === src) Object.assign(patch, { sourceBy: cur.sourceBy, sourceByName: cur.sourceByName, sourceTs: cur.sourceTs })
        }
        if (args.confidence !== undefined) patch.confidence = Number(args.confidence)
        const f = updateFact(room, String(args.id || ''), patch)
        if (!f) return { ok: false, error: '没改成（找不到这条，或改完和别的记忆重复了）' }
        log(`面板修改记忆：${room}｜${f.text.slice(0, 30)}`)
        return { fact: factView(f, extrasOf(room, [f]).get(f.id)) }
      }
      /* ── 变化线 / 联想 ── */
      case 'chain':
        need(room)
        return { nodes: store?.chainOf ? store.chainOf(room, String(args.id || '')) : [] }
      case 'links':
        need(room)
        return { links: deep().links.linksOf(room, String(args.id || '')) }
      case 'fact.delete':
        need(room)
        if (!deleteFactById(room, String(args.id || ''), '面板删除')) return { ok: false, error: '没找到这条' }
        return { deleted: true }

      /* ── 下一次回复会带哪些记忆、为什么（不计入使用次数） ── */
      case 'why': {
        need(room)
        const r = roomState(room)
        const list = factsOf(room)
        const recent = (r.msgs || []).slice(-6)
        const query = String(args.query || '').trim() || recent.map((m) => m.text || '').join(' ')
        const speaker = String(args.speaker || [...recent].reverse().find((m) => !m.isSelf)?.sender || '')
        const n = Math.max(1, Math.min(30, Number(args.limit) || 15))
        const top = scoreFacts(r, list, query, speaker)
          .sort((a, b) => b.s - a.s)
          .slice(0, n)
        const ex = extrasOf(room, list)
        const scored = top.map((x) => ({ ...factView(x.f, ex.get(x.f.id)), score: Math.round(x.s * 100) / 100, rel: Math.round(x.rel * 100) / 100 }))
        // 联想带进来的（从得分最高的 3 条出发；列表全带上时没有联想）
        if (store?.associate && list.length > n) {
          const seeds = top.filter((x) => x.rel > 0 || x.s > 0.3).slice(0, 3).map((x) => x.f)
          for (const f of store.associate(room, seeds, new Set(top.map((x) => x.f.id)))) scored.push({ ...factView(f, { ...ex.get(f.id), assoc: true }), score: null, rel: null })
        }
        // 分块给面板看各占多少字（对照记忆总预算）；预览不计入"被用到"
        const blocks = { card: '', daily: '', insights: '', story: '' }
        try {
          Object.assign(blocks, mp.promptParts ? mp.promptParts(r) : {})
          Object.assign(blocks, getMemDeep()?.promptParts?.(r, { preview: true }) || {})
        } catch {
          /* ignore */
        }
        return { query: query.slice(0, 200), speaker, items: scored, prompt: mp.promptBlocks(r), blocks }
      }

      /* ── 原文归档 ── */
      case 'archive.search': {
        need(room)
        const db = config.chatLogEnabled ? getChatLog() : null
        if (!db) return { ok: false, error: '原文归档没开或不可用' }
        const q = String(args.q || '').trim()
        if (!q) return { ok: false, error: '先输入要搜的内容' }
        return { hits: db.search(room, q, { limit: Math.min(50, Number(args.limit) || 20) }) }
      }
      case 'archive.recent': {
        need(room)
        const db = config.chatLogEnabled ? getChatLog() : null
        if (!db) return { ok: false, error: '原文归档没开或不可用' }
        return { msgs: db.recent(room, Math.min(200, Number(args.limit) || 30)) }
      }

      /* ── 人物卡 ── */
      case 'people.list': {
        need(room)
        const people = mp.listCards(room)
        // 有故事、但还没有记忆 / 人物卡的人也列出来
        try {
          for (const s of getMemDeep()?.story.people(room) || []) {
            const p0 = people.find((x) => x.who === s.who)
            if (p0) Object.assign(p0, { story: s.milestones })
            else people.push({ who: s.who, name: s.name, facts: 0, cardAt: 0, hasCard: false, story: s.milestones })
          }
        } catch {
          /* ignore */
        }
        return { people }
      }

      /* ── 我们之间的故事 ── */
      case 'story.get': {
        need(room)
        const s = deep().story.readStory(room, String(args.who || ''))
        return { story: s }
      }
      case 'story.add': {
        need(room)
        const m = deep().story.addMilestone(room, String(args.who || ''), {
          type: String(args.type || '特别的时刻'), text: String(args.text || ''), emotion: args.emotion, intensity: args.intensity,
          at: Number(args.at) || Date.now(), due: args.due || '', by: '手动', name: String(args.name || ''),
        })
        return m ? { milestone: m } : { ok: false, error: '没加上（内容为空、功能没开，或只读实例）' }
      }
      case 'story.update': {
        need(room)
        const m = deep().story.updateMilestone(room, String(args.who || ''), String(args.id || ''), args)
        return m ? { milestone: m } : { ok: false, error: '没找到这个节点' }
      }
      case 'story.delete':
        need(room)
        return deep().story.deleteMilestone(room, String(args.who || ''), String(args.id || '')) ? { deleted: true } : { ok: false, error: '没找到这个节点' }

      /* ── 💡 理解（反思归纳） ── */
      case 'insights.list': {
        need(room)
        const d = deep()
        const facts = new Map(factsOf(room).map((f) => [f.id, f.text]))
        return {
          items: d.insights
            .load(room)
            .slice()
            .reverse()
            .map((x) => ({ ...x, evidence: (x.evidence || []).map((id) => ({ id, text: facts.get(id) || '', exists: facts.has(id) })) })),
          lastReflectAt: Number(d.readMeta(room).lastReflectAt) || 0,
        }
      }
      case 'insight.add': {
        need(room)
        const out = deep().insights.add(room, { text: args.text, about: args.about, confidence: args.confidence })
        return out.ok ? out : { ok: false, error: out.error }
      }
      case 'insight.update': {
        need(room)
        const out = deep().insights.update(room, String(args.id || ''), args)
        return out.ok ? out : { ok: false, error: out.error }
      }
      case 'insight.retire': {
        need(room)
        const out = deep().insights.retire(room, String(args.id || ''), args.reason)
        return out.ok ? out : { ok: false, error: out.error }
      }
      case 'reflect': {
        need(room)
        log(`面板立即反思：${room}`)
        const out = await deep().insights.reflect(room, { force: true })
        return out.ok ? out : { ok: false, error: out.error }
      }

      /* ── 🧹 整理记录（每晚整理） ── */
      case 'consolidate.list':
        need(room)
        return { items: deep().consolidate.list(room), mode: config.consolidateMode === 'suggest' ? 'suggest' : 'apply' }
      case 'consolidate.run': {
        need(room)
        log(`面板立即整理：${room}`)
        const d = deep()
        const out = await d.consolidate.run(room)
        if (out.ok && config.assocEnabled) {
          try {
            d.links.rebuild(room)
          } catch {
            /* ignore */
          }
        }
        return out.ok ? out : { ok: false, error: out.error }
      }
      case 'consolidate.undo': {
        need(room)
        const out = deep().consolidate.undo(room, String(args.id || ''))
        return out.ok ? out : { ok: false, error: out.error }
      }
      case 'consolidate.apply': {
        need(room)
        const out = deep().consolidate.apply(room, String(args.id || ''))
        return out.ok ? out : { ok: false, error: out.error }
      }
      case 'consolidate.dismiss': {
        need(room)
        const out = deep().consolidate.dismiss(room, String(args.id || ''))
        return out.ok ? out : { ok: false, error: out.error }
      }

      /* ── 💭 想起往事 ── */
      case 'recall.list': {
        need(room)
        const d = deep()
        const r = roomState(room)
        return { log: d.recall.history(room), muted: d.recall.muted(room), candidates: d.recall.preview(r) }
      }
      case 'recall.mute':
        need(room)
        return { ok: deep().recall.mute(room, String(args.key || ''), args.on !== false) }
      case 'people.get':
        need(room)
        return { text: mp.readCard(room, String(args.who || '')) }
      case 'people.regen': {
        need(room)
        const out = await mp.updateCard(room, String(args.who || ''))
        return out.ok ? out : { ok: false, error: out.error }
      }

      /* ── 每日摘要 ── */
      case 'daily.list': {
        need(room)
        const all = mp.readDaily(room)
        return {
          days: Object.keys(all)
            .sort()
            .reverse()
            .slice(0, 60)
            .map((day) => ({ day, ...all[day] })),
        }
      }
      case 'daily.write': {
        need(room)
        const out = await mp.writeDaily(room, String(args.day || ''))
        return out.ok ? out : { ok: false, error: out.error }
      }

      /* ── 跟进 ── */
      case 'follow.list':
        need(room)
        return { items: mp.followList(room) }
      case 'follow.preview': {
        need(room)
        const out = await mp.previewFollow(room, String(args.id || ''))
        return out.ok ? out : { ok: false, error: out.error }
      }

      /* ── 语义检索 ── */
      case 'semantic.status': {
        const s = getEmbedder().status(room && isManagedRoom(room) ? room : '')
        if (room && isManagedRoom(room)) Object.assign(s, mp.status(room).semantic)
        return s
      }
      case 'semantic.load':
        // 预热：加载模型 + 给所有托管会话补记忆向量 + 后台补原文向量
        await mp.warmUp()
        return getEmbedder().status(room && isManagedRoom(room) ? room : '')
      case 'semantic.index': {
        need(room)
        // 必须用"全部记忆文本"（事实 + 归档 + 摘要/关系），只给事实建会把其它向量清掉
        const out = await mp.indexMemory(room)
        mp.kickBackfill()
        return out.ok ? out : { ok: false, error: out.error || '语义检索没开或模型还没加载' }
      }

      /* ── 手动提炼（走当前模式：增删改 / 旧版） ── */
      case 'extract': {
        need(room)
        const r0 = roomState(room)
        log(`面板立即提炼：${room}｜内存消息 ${(r0.msgs || []).length} 条（有文字 ${(r0.msgs || []).filter((m) => m && m.text).length} 条）｜模式 ${config.memoryOps ? '增删改' : '旧版'}`)
        const out = await extractFacts(room)
        if (out?.ok) log(`面板立即提炼完成：${room}｜新增 ${out.added || 0}、更新 ${out.updated || 0}、删除 ${out.deleted || 0}（${out.batches || 0} 批）`)
        if (out?.ok && (out.added || out.updated || out.deleted)) {
          try {
            mp.maybeCards(room, out.whos || [])
          } catch {
            /* ignore */
          }
        }
        return out?.ok ? out : { ok: false, error: out?.error || '提炼失败' }
      }

      default:
        return { ok: false, error: '未知的记忆增强操作：' + op }
    }
  }
}
