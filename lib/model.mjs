

/**
 * 模型调用封装：generate / analyze（结构化分析）/ 关键词与人名提示。
 */
export const MODEL_DEPS = ["HIST_STOP","config","createUserMessage","llm","log","metrics","noteUsage","resolveModel","stats","track","untrack"]

export function createModel(deps) {
  const missing = MODEL_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('模型模块缺少依赖：' + missing.join(', '))
  const { HIST_STOP, config, createUserMessage, llm, log, metrics, noteUsage, resolveModel, stats, track, untrack } = deps

  async function generate({ system, user, maxTokens, temperature, reasoningEffort, onDelta }) {
    const { provider, model } = resolveModel()
    const ac = new AbortController()
    const killer = track(setTimeout(() => ac.abort(new Error('模型超时')), 90000))
    const t0 = Date.now()
    let firstTokenMs = 0
    let text = ''
    let usage = null
    let finish = null
    try {
      stats.llmCalls += 1
      metrics.inc('llmCalls')
      const stream = llm.stream({
        provider,
        model,
        messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: user }] })],
        system,
        temperature: Number(temperature ?? config.temperature),
        maxTokens: Number(maxTokens ?? config.maxTokens),
        ...((reasoningEffort ?? config.reasoningEffort)
          ? { reasoningEffort: reasoningEffort ?? config.reasoningEffort }
          : {}),
        signal: ac.signal,
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') {
          if (!firstTokenMs) firstTokenMs = Date.now() - t0
          text += chunk.text
          if (onDelta) {
            try {
              onDelta(text)
            } catch {
              /* 回调里的错误不能影响生成 */
            }
          }
        } else if (chunk.type === 'usage') {
          usage = chunk.usage
        } else if (chunk.type === 'finish') {
          finish = chunk.reason
        } else if (chunk.type === 'block-end' && !text && chunk.block?.type === 'text') {
          text = chunk.block.text || ''
        }
      }
    } catch (e) {
      stats.llmErrors += 1
      stats.lastError = String(e?.message || e)
      throw e
    } finally {
      untrack(killer)
    }
    noteUsage(usage)
    // 模型侧失败（如 provider 不可用 / 鉴权过期）通常 finish.kind = 'error' 且没有文本：
    // 以前这种情况只留下一条空的"回复"日志，很难查；这里显式记一条原因。
    if (!String(text || '').trim() && finish && finish.kind !== 'stop') {
      const f = finish.failure || {}
      stats.llmErrors += 1
      const msg = '生成失败：' + String(finish.kind || '?') + (f.message ? ' - ' + String(f.message).slice(0, 120) : '')
      stats.lastError = msg
      log(msg + '（' + provider + '/' + model + '）')
    }
    return { text, firstTokenMs, totalMs: Date.now() - t0, usage, finish }
  }

  async function analyze(system, user) {
    const req = { system, user, maxTokens: 2600, temperature: 0.3, reasoningEffort: 'low' }
    let out
    try {
      out = await generate(req)
    } catch (e) {
      out = await generate({ ...req, reasoningEffort: undefined })
    }
    return { text: String(out.text || '').trim(), finish: out.finish?.kind || '' }
  }

  function keywordsOf(text) {
    const tokens = String(text || '')
      .replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
    const out = []
    for (const t of tokens) {
      if (/^[0-9A-Za-z]+$/.test(t)) {
        if (t.length >= 2) out.push(t)
        continue
      }
      if (t.length <= 2) {
        if (!HIST_STOP.has(t)) out.push(t)
        continue
      }
      for (let i = 0; i + 2 <= t.length; i++) {
        const w = t.slice(i, i + 2)
        if (!HIST_STOP.has(w)) out.push(w)
      }
    }
    return [...new Set(out)].slice(0, 8)
  }

  function whoHint(r) {
    if (!r.isGroup && config.adminQQ.includes(String(r.roomId))) {
      return '（注意：这是管理员本人的私聊；对话里的"管理员"和对方是同一个人，不要写成两个人。）'
    }
    return ''
  }

  return { generate, analyze, keywordsOf, whoHint }
}

/**
 * 模型路由：resolveModel（对话模型）+ resolveVisionRoute（视觉模型，带缓存与自动回退）。
 */
export const MODEL_ROUTE_DEPS = ['config', 'ctx', 'getVisionRoute', 'log', 'setVisionRoute']

export function createModelRoute(deps) {
  const missing = MODEL_ROUTE_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('模型路由缺少依赖：' + missing.join(', '))
  const { config, ctx, getVisionRoute, log, setVisionRoute } = deps

  function resolveModel() {
    let provider = String(config.provider || '')
    let model = String(config.model || '')
    if (!provider || !model) {
      try {
        const sel = ctx.get?.('agentDefaultModel')?.currentSelection?.()
        provider = provider || String(sel?.provider || '')
        model = model || String(sel?.model || '')
      } catch {
        /* ignore */
      }
    }
    if (!provider || !model) throw new Error('没有可用的模型路由（config.provider/model 为空，且读不到 agent 默认模型）')
    return { provider, model }
  }

  async function resolveVisionRoute() {
    const cached = getVisionRoute()
    if (cached) return cached
    const llm = ctx.get?.('llm')
    const wantP = String(config.visionProvider || '')
    const wantM = String(config.visionModel || '')
    if (llm?.listProviders) {
      const providers = (llm.listProviders() || []).map((p) => p.id)
      if (wantP && providers.includes(wantP)) {
        try {
          const models = (await llm.listModels(wantP)) || []
          const exact = models.find((m) => m.id === wantM)
          if (exact) {
            setVisionRoute({ provider: wantP, model: exact.id })
            return getVisionRoute()
          }
          const visual = models.find((m) => (m.inputModalities || []).includes('image'))
          if (visual) {
            setVisionRoute({ provider: wantP, model: visual.id })
            log(`视觉模型回退：${wantM} 不可用 → ${visual.id}`)
            return getVisionRoute()
          }
        } catch {
          /* 继续试其它 provider */
        }
      }
      for (const p of providers) {
        try {
          const models = (await llm.listModels(p)) || []
          const visual = models.find((m) => (m.inputModalities || []).includes('image'))
          if (visual) {
            setVisionRoute({ provider: p, model: visual.id })
            log(`视觉模型自动选择：${p}/${visual.id}`)
            return getVisionRoute()
          }
        } catch {
          /* 下一个 */
        }
      }
    }
    if (wantP && wantM) {
      setVisionRoute({ provider: wantP, model: wantM })
      return getVisionRoute()
    }
    throw new Error('找不到支持图片的模型路由（面板「识图」里指定 provider/model）')
  }

  return { resolveModel, resolveVisionRoute }
}
