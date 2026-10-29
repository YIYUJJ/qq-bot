/**
 * 语义检索（可选）：本地向量模型，让"猫"也能搜到"养了只橘子"。
 *
 * 依赖 @huggingface/transformers（可选依赖）：没装、没开、模型没下好，都只是"语义分数为空"，
 * 检索自动退回 BM25，不影响其它功能。
 *
 * 不同模型的用法不一样（用错了效果会明显变差），统一放在 EMBED_PRESETS 里：
 *   pooling      bge 系列取 [CLS]；Qwen3 是解码器，取最后一个 token（必须左侧补齐）
 *   queryPrefix  查询前加的任务说明（Qwen3 必须加；记忆本身不加）
 *   baseline     毫不相关的两句话的余弦大概在多少，低于它的当 0 分（由 tools/bench-embed.mjs 实测）
 *
 * 向量缓存：每个会话目录一个 embed.json（{ model, vecs: { 文本哈希: [..] } }），换模型自动作废。
 * 回复时不等模型：模型还没加载就先在后台加载，这一次回复只用 BM25。
 */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { atomicWriteJson } from './store.mjs'

export const DEFAULT_EMBED_MODEL = 'Xenova/bge-base-zh-v1.5'

/*
 * 预设参数来自 tools/bench-embed.mjs 在本机的严格测试（2026-10-29，155 道题、90 条记忆、一条一条算，报告见 qqbot-docs/向量模型实测.md）：
 *   - 千问3：英文指令 Top1 95/155，中文指令 91，不加 87 → 用英文指令
 *   - bge-base：加官方检索前缀 110/155，不加 107 → 加前缀
 *   - bge-small：加不加都是 96/155 → 不加
 *   baseline = 用插件预设前缀时无关句子余弦的 75 分位
 */
export const EMBED_PRESETS = {
  'onnx-community/Qwen3-Embedding-0.6B-ONNX': {
    label: '千问3 向量模型 0.6B｜onnx-community/Qwen3-Embedding-0.6B-ONNX（原始：阿里通义 Qwen/Qwen3-Embedding-0.6B，ONNX int8 量化，585 MB）',
    short: '千问3-0.6B（Qwen/Qwen3-Embedding-0.6B，int8）',
    origin: 'Qwen/Qwen3-Embedding-0.6B',
    vendor: '阿里通义千问',
    file: 'onnx/model_quantized.onnx',
    bytes: 613527631,
    sha256: '87cd124e0ef1fd1f223ebc283efccbaeac386d0b08344701c46975d0657b591f',
    arch: '解码器 Qwen3，28 层，1024 维',
    pooling: 'last_token',
    paddingSide: 'left',
    queryPrefix: 'Instruct: Given a group chat message, retrieve memories about the people and events it mentions\nQuery:',
    baseline: 0.34,
  },
  'Xenova/bge-base-zh-v1.5': {
    label: 'bge 中文 base 版｜Xenova/bge-base-zh-v1.5（原始：智源 BAAI/bge-base-zh-v1.5，ONNX int8 量化，98 MB）',
    short: 'bge-base-zh-v1.5（BAAI/bge-base-zh-v1.5，int8）',
    origin: 'BAAI/bge-base-zh-v1.5',
    vendor: '北京智源人工智能研究院（BAAI）',
    file: 'onnx/model_quantized.onnx',
    bytes: 102868746,
    sha256: 'b665f3bba56c3119bc76ba131ebcc544d720a7408cb11581bdf354aaa0198d43',
    arch: '编码器 BERT，12 层，768 维',
    pooling: 'cls',
    queryPrefix: '为这个句子生成表示以用于检索相关文章：',
    baseline: 0.3,
  },
  'Xenova/bge-small-zh-v1.5': {
    label: 'bge 中文 small 版｜Xenova/bge-small-zh-v1.5（原始：智源 BAAI/bge-small-zh-v1.5，ONNX int8 量化，23 MB）',
    short: 'bge-small-zh-v1.5（BAAI/bge-small-zh-v1.5，int8）',
    origin: 'BAAI/bge-small-zh-v1.5',
    vendor: '北京智源人工智能研究院（BAAI）',
    file: 'onnx/model_quantized.onnx',
    bytes: 24010842,
    sha256: '15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc',
    arch: '编码器 BERT，4 层，512 维',
    pooling: 'cls',
    queryPrefix: '',
    baseline: 0.38,
  },
}

/** 模型下载源。ModelScope 国内直连；hf-mirror / huggingface 在部分网络下连不上。 */
export const EMBED_SOURCES = {
  modelscope: { host: 'https://www.modelscope.cn/models/', template: '{model}/resolve/master/' },
  'hf-mirror': { host: 'https://hf-mirror.com/', template: '{model}/resolve/{revision}/' },
  huggingface: { host: 'https://huggingface.co/', template: '{model}/resolve/{revision}/' },
}

/** 没在预设表里的模型：按 bge 的用法兜底。 */
export function presetOf(model) {
  return EMBED_PRESETS[model] || { label: model, short: model, origin: '未知', pooling: 'cls', queryPrefix: '', baseline: 0.3 }
}

/** 下载源：semanticSource=custom 时用 semanticMirror 这个地址（按 HF 的路径格式）。 */
export function sourceOf(config) {
  const key = String(config?.semanticSource || 'modelscope')
  if (key === 'custom') {
    const host = String(config?.semanticMirror || '').trim()
    if (host) return { host: host.endsWith('/') ? host : host + '/', template: '{model}/resolve/{revision}/' }
  }
  return EMBED_SOURCES[key] || EMBED_SOURCES.modelscope
}

/** 两个已归一化向量的余弦相似度 */
export function cosine(a, b) {
  const n = Math.min(a?.length || 0, b?.length || 0)
  let s = 0
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

export function hashText(t) {
  return createHash('sha1').update(String(t || '')).digest('hex').slice(0, 16)
}

/** 按模型的"无关基线"线性归一化：基线 = 0，余弦 1 = 1。不截断——截断到 0 会让正确答案和一堆无关的并列，实测 Top1 掉 8~21 道。 */
export function normalizeSim(c, baseline = 0.3) {
  const b = Math.max(0, Math.min(0.95, Number(baseline) || 0))
  return (Number(c) - b) / (1 - b)
}

/**
 * 加载一个向量模型，返回 { embed(texts, {query}), model, preset }。
 * 插件和 tools/bench-embed.mjs 共用，保证"测的就是插件实际用的"。
 */
export async function loadEmbedModel({ model, config = {}, cacheDir, threads = 0, progress = null, offline = false, dtype = 'q8', importer = (m) => import(m) }) {
  let mod
  try {
    mod = await importer('@huggingface/transformers')
  } catch {
    throw new Error('没装 @huggingface/transformers：在插件目录执行 npm i @huggingface/transformers')
  }
  const { pipeline, env } = mod
  const src = sourceOf(config)
  if (env) {
    if (cacheDir) env.cacheDir = cacheDir
    env.remoteHost = src.host
    env.remotePathTemplate = src.template
    // offline：只用本地已下载的文件（测试时用，保证不会偷偷重新下载）
    env.allowRemoteModels = !offline
  }
  const preset = presetOf(model)
  const n = Math.max(0, Math.floor(Number(threads) || 0))
  const pipe = await pipeline('feature-extraction', model, {
    dtype,
    ...(n ? { session_options: { intraOpNumThreads: n, interOpNumThreads: 1 } } : {}),
    ...(typeof progress === 'function' ? { progress_callback: progress } : {}),
  })
  if (preset.paddingSide && pipe.tokenizer) pipe.tokenizer.padding_side = preset.paddingSide
  async function embed(texts, { query = false } = {}) {
    const list = texts.map((t) => (query && preset.queryPrefix ? preset.queryPrefix + String(t) : String(t)))
    const out = await pipe(list, { pooling: preset.pooling, normalize: true })
    const rows = typeof out?.tolist === 'function' ? out.tolist() : out
    return rows.map((v) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4))
  }
  return { embed, model, preset, pipe }
}

export function createEmbedder({ config, log = () => {}, memDirOf, dataDir, importer = (m) => import(m) }) {
  let loaded = null // { embed, model, preset, pipe, sig }
  let loading = null
  let error = ''
  const caches = new Map() // dir -> { model, vecs: Map, dirty }
  const inflight = new Map() // dir -> Promise（同一个会话的建索引串行，不重复算）

  const enabled = () => !!config.semanticSearch
  const modelName = () => String(config.semanticModel || '').trim() || DEFAULT_EMBED_MODEL
  /** 模型 + 线程数 + 下载源：任一变了都要重新加载 */
  const signature = () => `${modelName()}|${Number(config.semanticThreads) || 0}|${sourceOf(config).host}`
  const isReady = () => !!loaded && loaded.sig === signature()

  function ensure() {
    if (!enabled()) return Promise.reject(new Error('语义检索没开（记忆增强 → 语义检索）'))
    const want = modelName()
    const sig = signature()
    if (loaded && loaded.sig === sig) return Promise.resolve(loaded)
    if (loading) return loading
    loading = (async () => {
      log('语义检索：开始加载模型 ' + want + '（没下载过的会从 ' + sourceOf(config).host + ' 下载）')
      const t0 = Date.now()
      const m = await loadEmbedModel({
        model: want,
        config,
        cacheDir: join(dataDir, 'models'),
        threads: Number(config.semanticThreads) || 0,
        importer,
      })
      const old = loaded
      loaded = { ...m, sig }
      error = ''
      try {
        await old?.pipe?.dispose?.()
      } catch {
        /* ignore */
      }
      log(`语义检索：模型已加载 ${want}（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`)
      return loaded
    })()
      .catch((e) => {
        error = String(e?.message || e)
        log('语义检索：模型加载失败：' + error)
        throw e
      })
      .finally(() => {
        loading = null
      })
    return loading
  }

  async function embed(texts, opts) {
    const m = await ensure()
    return m.embed(texts, opts)
  }

  function cacheOf(dir) {
    let c = caches.get(dir)
    if (c && c.model === modelName()) return c
    c = { model: modelName(), vecs: new Map(), dirty: false }
    try {
      const j = JSON.parse(readFileSync(join(dir, 'embed.json'), 'utf8'))
      if (j && j.model === c.model && j.vecs) for (const [k, v] of Object.entries(j.vecs)) c.vecs.set(k, v)
    } catch {
      /* 没有或坏了：重建 */
    }
    caches.set(dir, c)
    return c
  }

  function saveCache(dir) {
    const c = caches.get(dir)
    if (!c || !c.dirty) return
    atomicWriteJson(join(dir, 'embed.json'), { model: c.model, vecs: Object.fromEntries(c.vecs) })
    c.dirty = false
  }

  /**
   * 给一批文本补向量（已有的跳过），并清掉不再用到的旧向量。记忆本身不加查询前缀。
   * 同一个会话的调用串行执行：写入时、回复前、启动预热可能同时触发，不会重复算、不会互相覆盖。
   */
  function indexTexts(roomId, texts, { prune = true } = {}) {
    const dir = memDirOf(roomId)
    if (!dir) return Promise.resolve({ ok: false, error: '该会话不在记忆托管名单里' })
    const prev = inflight.get(dir) || Promise.resolve()
    const run = prev.then(() => indexNow(dir, texts, prune))
    const tail = run.catch(() => {})
    inflight.set(dir, tail)
    void tail.finally(() => {
      if (inflight.get(dir) === tail) inflight.delete(dir)
    })
    return run
  }

  async function indexNow(dir, texts, prune) {
    const c = cacheOf(dir)
    const want = new Map()
    for (const t of texts) if (String(t || '').trim()) want.set(hashText(t), String(t))
    const missing = [...want.entries()].filter(([h]) => !c.vecs.has(h))
    let added = 0
    // 一条一条算：int8 动态量化下批量补齐会让向量随"同批的其他句子"变化（实测千问3 一致度只有 0.94）
    for (const [h, t] of missing) {
      const [vec] = await embed([t])
      c.vecs.set(h, vec)
      added += 1
      c.dirty = true
    }
    if (prune) {
      for (const h of [...c.vecs.keys()]) {
        if (!want.has(h)) {
          c.vecs.delete(h)
          c.dirty = true
        }
      }
    }
    saveCache(dir)
    return { ok: true, added, total: c.vecs.size }
  }

  /** 还缺几条向量（不计算，只数） */
  function missingCount(roomId, texts) {
    const dir = memDirOf(roomId)
    if (!dir) return 0
    const c = cacheOf(dir)
    let n = 0
    for (const t of texts) if (String(t || '').trim() && !c.vecs.has(hashText(t))) n += 1
    return n
  }

  /** 查询向量：模型没加载好就后台加载、这次返回 null（不拖慢回复）。 */
  async function queryVec(text, timeoutMs = 1200) {
    if (!enabled() || !String(text || '').trim()) return null
    if (!isReady()) {
      ensure().catch(() => {})
      return null
    }
    let timer
    const timeout = new Promise((r) => {
      timer = setTimeout(() => r(null), timeoutMs)
    })
    try {
      const got = await Promise.race([embed([String(text).slice(0, 500)], { query: true }).then((v) => v[0]), timeout])
      return got || null
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  /** 对一组文本打语义分（0~1）；没有向量的文本记 0；一个都没有返回 null。 */
  function scores(roomId, vec, texts) {
    if (!vec || !enabled()) return null
    const dir = memDirOf(roomId)
    if (!dir) return null
    const c = cacheOf(dir)
    const base = presetOf(modelName()).baseline
    let any = false
    const out = texts.map((t) => {
      const v = c.vecs.get(hashText(t))
      if (!v) return 0
      any = true
      return normalizeSim(cosine(vec, v), base)
    })
    return any ? out : null
  }

  /** 某条记忆文本已经算好的向量（没有返回 null；联想 / 每晚整理用，不触发计算） */
  function vecOf(roomId, text) {
    if (!enabled()) return null
    const dir = memDirOf(roomId)
    if (!dir) return null
    return cacheOf(dir).vecs.get(hashText(text)) || null
  }
  /** 当前模型的"无关基线"（归一化用） */
  function baseline() {
    return presetOf(modelName()).baseline
  }

  function status(roomId) {
    let cached = 0
    if (roomId) {
      const dir = memDirOf(roomId)
      if (dir) cached = cacheOf(dir).vecs.size
    }
    const want = modelName()
    return {
      enabled: enabled(),
      ready: isReady(),
      loading: !!loading,
      error,
      model: want,
      label: presetOf(want).label,
      source: sourceOf(config).host,
      cached,
    }
  }

  return { ensure, embed, indexTexts, missingCount, queryVec, scores, status, isReady, modelName, vecOf, baseline }
}
