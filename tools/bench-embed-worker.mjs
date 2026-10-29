#!/usr/bin/env node
/**
 * 向量模型测试的子进程（由 tools/bench-embed.mjs 调用，每次一个全新进程，互不干扰）。
 *
 *   node --expose-gc tools/bench-embed-worker.mjs '{"mode":"speed","model":"...","threads":4}'
 *   node --expose-gc tools/bench-embed-worker.mjs '{"mode":"accuracy","model":"..."}'
 *
 * 只用本地已下载的模型（不联网）。结果以一行 JSON 写到 stdout，过程信息写到 stderr。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { loadEmbedModel, presetOf, cosine, normalizeSim } from '../lib/embed.mjs'
import { bm25Scores } from '../lib/memory.mjs'
import { fuseRelevance } from '../lib/memory-store.mjs'
import { CONFIG_META } from '../lib/meta.mjs'
import { MEMORIES, QUESTIONS, SPEED_SHORT, SPEED_LONG } from './embed-testset.mjs'

const args = JSON.parse(process.argv[2] || '{}')
const CACHE = join(homedir(), '.dsh', 'qq-bot', 'models')
const say = (s) => process.stderr.write(s + '\n')
const gc = () => {
  if (global.gc) {
    global.gc()
    global.gc()
  }
}
const rss = () => {
  gc()
  return process.memoryUsage().rss
}

/** 并列按"不利"算：和正确答案同分的也排在它前面 */
const rankOf = (scores, t) => 1 + scores.filter((s, i) => i !== t && s >= scores[t]).length

/** 不同查询前缀方案（第一个是插件预设） */
function variantsFor(model) {
  const p = presetOf(model)
  const out = [{ name: '插件预设', prefix: p.queryPrefix }]
  if (model.includes('Qwen3')) {
    out.push({ name: '中文指令', prefix: 'Instruct: 根据群聊里的一句话，找出与其中提到的人和事相关的记忆\nQuery:' })
    out.push({ name: '不加前缀', prefix: '' })
  } else if (p.queryPrefix) {
    out.push({ name: '不加前缀', prefix: '' })
  } else {
    out.push({ name: '加官方检索前缀', prefix: '为这个句子生成表示以用于检索相关文章：' })
  }
  return out
}

async function main() {
  const model = args.model
  const preset = presetOf(model)
  // 先单独加载推理库，算出"不含模型"的内存基线
  await import('@huggingface/transformers')
  const rss0 = rss()
  const t0 = performance.now()
  const m = await loadEmbedModel({ model, cacheDir: CACHE, threads: args.threads ?? 4, offline: true, dtype: args.dtype || 'q8' })
  const loadMs = performance.now() - t0
  const rss1 = rss()
  say(`  已加载 ${preset.short}（${(loadMs / 1000).toFixed(1)} 秒，模型占内存约 ${Math.round((rss1 - rss0) / 1048576)} MB）`)

  if (args.mode === 'speed') {
    const embedOne = (text, query) => m.embed([text], { query })
    for (let i = 0; i < 20; i++) await embedOne(SPEED_SHORT[i], true) // 预热
    const short = []
    for (let i = 0; i < 200; i++) {
      const s = performance.now()
      await embedOne(SPEED_SHORT[i % SPEED_SHORT.length], true)
      short.push(performance.now() - s)
    }
    const long = []
    for (let i = 0; i < 100; i++) {
      const s = performance.now()
      await embedOne(SPEED_LONG[i % SPEED_LONG.length], true)
      long.push(performance.now() - s)
    }
    const texts = MEMORIES.map((x) => x.text)
    const ix0 = performance.now()
    for (let r = 0; r < 3; r++) for (const t of texts) await m.embed([t]) // 和插件一样一条一条建索引
    const indexPerItem = (performance.now() - ix0) / (3 * texts.length)
    const rss2 = rss()
    console.log(JSON.stringify({ ok: true, mode: 'speed', model, threads: args.threads ?? 4, loadMs, modelMB: (rss1 - rss0) / 1048576, peakMB: rss2 / 1048576, short, long, indexPerItem }))
    return
  }

  // ── accuracy ──
  // 1) 正确性检查：同一句算两次是否完全一致；批量（有补齐）和单条是否一致
  const probe = ['好', '小周的猫叫年糕', '老王最近膝盖受伤了，在家养伤，下楼梯都疼', '群里约好下个月一起去成都旅游，看熊猫吃火锅']
  const a1 = await m.embed([probe[2]])
  const a2 = await m.embed([probe[2]])
  const determinism = cosine(a1[0], a2[0])
  const batch = await m.embed(probe)
  let consistency = 1
  for (let i = 0; i < probe.length; i++) consistency = Math.min(consistency, cosine(batch[i], (await m.embed([probe[i]]))[0]))

  // 2) 记忆向量（不加前缀）。和插件一样一条一条算：int8 动态量化下，批量补齐会让结果随"同批的其他句子"变化
  const texts = MEMORIES.map((x) => x.text)
  const one = async (t) => (await m.embed([t]))[0]
  const memVecs = []
  for (const t of texts) memVecs.push(await one(t))
  const targetIdx = QUESTIONS.map((q) => MEMORIES.findIndex((x) => x.id === q.target))
  const bmRows = QUESTIONS.map((q) => bm25Scores(q.q, texts))
  const BONUS = [0, 0.03, 0.05, 0.1, 0.15, 0.2, 0.3]

  const variants = []
  for (const v of variantsFor(model)) {
    const qVecs = []
    for (const q of QUESTIONS) qVecs.push(await one(v.prefix + q.q))
    const cosRows = qVecs.map((qv) => memVecs.map((d) => cosine(qv, d)))
    const related = []
    const unrelated = []
    cosRows.forEach((cos, k) => {
      related.push(cos[targetIdx[k]])
      cos.forEach((c, j) => j !== targetIdx[k] && unrelated.push(c))
    })
    const sortedU = [...unrelated].sort((a, b) => a - b)
    const q = (p) => sortedU[Math.floor(p * (sortedU.length - 1))]
    const base = q(0.75) // 这个前缀方案自己的"无关基线"
    const semRanks = cosRows.map((cos, k) => rankOf(cos, targetIdx[k]))
    // 新打分：线性归一化（不截断，保住排序）+ BM25 饱和加分，网格搜索加分权重
    const fusedByBonus = {}
    for (const B of BONUS) {
      fusedByBonus[B] = cosRows.map((cos, k) => {
        const bm = bmRows[k]
        const s = cos.map((c, j) => (c - base) / (1 - base) + B * (bm[j] / (bm[j] + 3)))
        return rankOf(s, targetIdx[k])
      })
    }
    // 修复前的插件打分（旧代码已改，这里按原公式还原）：固定基线截断到 0 + BM25/最大值 与语义 5:5 前的版本 → 饱和加分上限 0.3
    const OLD_BASE = { 'onnx-community/Qwen3-Embedding-0.6B-ONNX': 0.34, 'Xenova/bge-base-zh-v1.5': 0.38, 'Xenova/bge-small-zh-v1.5': 0.37 }
    const ob = OLD_BASE[model] ?? 0.3
    const oldRanks = cosRows.map((cos, k) => {
      const bm = bmRows[k]
      return rankOf(cos.map((c, j) => Math.max(0, Math.min(1, (c - ob) / (1 - ob))) + 0.3 * (bm[j] / (bm[j] + 3))), targetIdx[k])
    })
    // 当前插件代码：直接调用插件里的 normalizeSim + fuseRelevance，用面板默认的关键词加分
    const pluginRanks = cosRows.map((cos, k) => {
      const bm = bmRows[k]
      const bmMax = Math.max(0, ...bm) || 1
      return rankOf(cos.map((c, j) => fuseRelevance(normalizeSim(c, preset.baseline), bm[j], bmMax, CONFIG_META.keywordBonus.default)), targetIdx[k])
    })
    variants.push({
      name: v.name, isPreset: v.name === '插件预设', prefix: v.prefix, base,
      semRanks, fusedByBonus, oldRanks, pluginRanks,
      relatedMean: related.reduce((s, x) => s + x, 0) / related.length,
      unrelatedQ: { p50: q(0.5), p75: q(0.75), p95: q(0.95) },
    })
  }
  console.log(JSON.stringify({ ok: true, mode: 'accuracy', model, dtype: args.dtype || 'q8', loadMs, modelMB: (rss1 - rss0) / 1048576, determinism, consistency, variants }))
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, model: args.model, error: String(e?.stack || e) }))
  process.exitCode = 1
})
