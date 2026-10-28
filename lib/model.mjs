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
