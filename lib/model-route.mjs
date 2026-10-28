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
