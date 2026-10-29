/**
 * 记忆深化第 5 项：联想。想起一条记忆时，顺带想起和它相关的几条。
 *
 * 怎么建联系（全部本地计算，用语义检索已经算好的向量，不花 token）：
 *   意思相近        两条记忆的语义相似度（按模型基线归一化后）≥ assocMinSim（默认 0.35），每条最多连 5 条
 *   同一个人        同一个 who，并且相似度 ≥ 0.2
 *   同一条变化线    自动相连
 *   反思依据        认识和它的依据事实互相连接
 *
 * 存在每个会话的 links.json：{ 记忆id: [{ id, weight, reason }] }。
 * 记忆向量更新时只算新记忆那一行（update）；每晚整理时全量重算一次（rebuild）。
 */
import { join } from 'node:path'
import { readJsonSafe } from './memory.mjs'
import { atomicWriteJson } from './store.mjs'
import { cosine, normalizeSim } from './embed.mjs'

const SEM_LINKS = 5 // 意思相近：每条最多连几条
const SAME_WHO_SIM = 0.2

export function createLinks({ config, log, store, getEmbedder, insightsOf = () => [], isReadOnly = () => false }) {
  const cache = new Map() // dir -> data

  const minSim = () => {
    const v = Number(config.assocMinSim ?? 0.35)
    return Number.isFinite(v) ? v : 0.35
  }
  function fileOf(dir) {
    return join(dir, 'links.json')
  }
  function load(roomId) {
    const dir = store.memDirOf(roomId)
    if (!dir) return {}
    if (!cache.has(dir)) {
      const j = readJsonSafe(fileOf(dir), {})
      cache.set(dir, j && typeof j === 'object' && !Array.isArray(j) ? j : {})
    }
    return cache.get(dir)
  }
  function save(roomId, data) {
    const dir = store.memDirOf(roomId)
    if (!dir || isReadOnly()) return
    cache.set(dir, data)
    atomicWriteJson(fileOf(dir), data)
  }

  /** 参与联想的节点：当前事实 + 有效的认识 */
  function nodesOf(roomId) {
    const out = store.factsOf(roomId).map((f) => ({ id: f.id, text: f.text, who: f.who || '', chainId: f.chainId || f.id, kind: '事实', evidence: [] }))
    for (const x of insightsOf(roomId) || []) {
      out.push({ id: x.id, text: x.text, who: /^\d+$/.test(String(x.about || '')) ? String(x.about) : '', chainId: '', kind: '理解', evidence: x.evidence || [] })
    }
    return out
  }
  function vecsOf(roomId, nodes) {
    const emb = getEmbedder()
    const ok = !!config.semanticSearch && !!emb?.isReady?.() && typeof emb.vecOf === 'function'
    const base = ok ? emb.baseline() : 0.3
    return { base, ok, vecs: new Map(nodes.map((n) => [n.id, ok ? emb.vecOf(roomId, n.text) : null])) }
  }

  /** 一条记忆的联想行 */
  function rowFor(node, nodes, V) {
    const sem = []
    const other = []
    const va = V.vecs.get(node.id)
    for (const o of nodes) {
      if (o.id === node.id) continue
      const vb = V.vecs.get(o.id)
      const s = va && vb ? normalizeSim(cosine(va, vb), V.base) : null
      const reasons = []
      let w = 0
      if (node.chainId && o.chainId && node.chainId === o.chainId) {
        reasons.push('同一条变化线')
        w = 1
      }
      if ((node.kind === '理解' && node.evidence.includes(o.id)) || (o.kind === '理解' && o.evidence.includes(node.id))) {
        reasons.push('反思依据')
        w = Math.max(w, 0.8)
      }
      if (node.who && o.who === node.who && s != null && s >= SAME_WHO_SIM) {
        reasons.push('同一个人')
        w = Math.max(w, s)
      }
      const similar = s != null && s >= minSim()
      if (similar) w = Math.max(w, s)
      if (reasons.length) {
        if (similar) reasons.push('意思相近')
        other.push({ id: o.id, weight: Math.round(w * 1000) / 1000, reason: reasons.join('、') })
      } else if (similar) sem.push({ id: o.id, weight: Math.round(s * 1000) / 1000, reason: '意思相近' })
    }
    sem.sort((a, b) => b.weight - a.weight)
    return [...other, ...sem.slice(0, SEM_LINKS)].sort((a, b) => b.weight - a.weight)
  }

  /** 全量重算（每晚整理时） */
  function rebuild(roomId) {
    if (isReadOnly() || !store.isManagedRoom(roomId)) return { ok: false }
    const t0 = Date.now()
    const nodes = nodesOf(roomId)
    const V = vecsOf(roomId, nodes)
    const data = {}
    for (const n of nodes) data[n.id] = rowFor(n, nodes, V)
    save(roomId, data)
    const edges = Object.values(data).reduce((s, l) => s + l.length, 0)
    log(`联想：${roomId} 全量重算 ${nodes.length} 条记忆、${edges} 条联系（${Date.now() - t0} ms）`)
    return { ok: true, nodes: nodes.length, edges }
  }

  /**
   * 增量：只算新记忆那一行；删掉已经不在的记忆（以及指向它们的联系）。
   * 语义检索开着但新记忆的向量还没算好时先不算，等向量好了再算（写入钩子会再调一次）。
   */
  function update(roomId) {
    if (isReadOnly() || !store.isManagedRoom(roomId)) return { ok: false }
    const nodes = nodesOf(roomId)
    const ids = new Set(nodes.map((n) => n.id))
    const old = load(roomId)
    const data = {}
    let changed = false
    for (const [id, list] of Object.entries(old)) {
      if (!ids.has(id)) {
        changed = true
        continue
      }
      const kept = (list || []).filter((l) => ids.has(l.id))
      if (kept.length !== (list || []).length) changed = true
      data[id] = kept
    }
    const fresh = nodes.filter((n) => !data[n.id])
    let added = 0
    if (fresh.length) {
      const V = vecsOf(roomId, nodes)
      for (const n of fresh) {
        if (config.semanticSearch && V.ok && !V.vecs.get(n.id)) continue
        data[n.id] = rowFor(n, nodes, V)
        added += 1
        changed = true
      }
    }
    if (changed) save(roomId, data)
    return { ok: true, added }
  }

  /** 一条记忆连着哪些（面板用，带文字） */
  function linksOf(roomId, id) {
    const byId = new Map(nodesOf(roomId).map((n) => [n.id, n]))
    return (load(roomId)[String(id)] || []).filter((l) => byId.has(l.id)).map((l) => ({ ...l, text: byId.get(l.id).text, kind: byId.get(l.id).kind }))
  }
  /** 每条记忆有几条联想 */
  function counts(roomId) {
    const data = load(roomId)
    const out = {}
    for (const [id, list] of Object.entries(data)) out[id] = (list || []).length
    return out
  }

  /**
   * 从几条种子出发，各带最多 2 条联想，总数不超过 limit；已经选中的不重复带。
   * @param {(n: object) => boolean} accept 哪些节点可以被带出来
   * @returns {object[]} 节点（事实是 store 里的原对象）
   */
  function expand(roomId, seedIds, chosen, limit, accept) {
    const n = Math.max(0, Number(limit) || 0)
    if (!n || !seedIds.length) return []
    const data = load(roomId)
    const facts = new Map(store.factsOf(roomId).map((f) => [f.id, f]))
    const ins = new Map((insightsOf(roomId) || []).map((x) => [x.id, x]))
    const taken = new Set(chosen || [])
    const lists = seedIds.map((id) => (data[id] || []).slice().sort((a, b) => b.weight - a.weight))
    const out = []
    // 轮流从每条种子取它最强的一条，最多两轮 → 每条种子最多带 2 条
    for (let round = 0; round < 2 && out.length < n; round++) {
      for (const list of lists) {
        if (out.length >= n) break
        for (const l of list) {
          if (taken.has(l.id)) continue
          const node = facts.get(l.id) ? { kind: '事实', obj: facts.get(l.id) } : ins.get(l.id) ? { kind: '理解', obj: ins.get(l.id) } : null
          if (!node || !accept(node)) continue
          taken.add(l.id)
          out.push(node.obj)
          break
        }
      }
    }
    return out
  }

  /** 挑记忆时用（memory-store.setAssociator）：只带事实 */
  function associate(roomId, seeds, chosen, limit) {
    return expand(roomId, seeds.map((f) => f.id), chosen, limit, (x) => x.kind === '事实')
  }
  /** 翻旧账时用：事实和认识都可以带 */
  function associateItems(roomId, ids, chosen) {
    if (!config.assocEnabled) return []
    const n = Math.max(0, Math.min(6, Number(config.assocExtra ?? 2)))
    return expand(roomId, ids.slice(0, 3), chosen, n, () => true).map((x) => ({ id: x.id, text: x.text, at: x.at || x.updatedAt || x.createdAt || 0 }))
  }

  return { rebuild, update, linksOf, counts, associate, associateItems, load }
}
