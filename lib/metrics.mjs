/**
 * 轻量可观测性：计数器、延迟分位、结构化事件日志、traceId。
 *
 * 目标：出问题时不用翻聊天记录猜，能回答
 *   - 最近回复成功率多少？首字 P95 多少？
 *   - 识图/模型失败各多少次？最后一次错误是什么？
 *   - 某条消息的完整链路（收到 → 决策 → 模型 → 发送）
 */
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const RESERVOIR = 200

export function createMetrics({ version = '', logFile = '', maxBytes = 4 * 1024 * 1024 } = {}) {
  const counters = Object.create(null)
  const latency = Object.create(null) // name -> number[]
  const startedAt = Date.now()
  let eventCount = 0
  const recentEvents = [] // 最近 reply/skip，面板用（最多 20 条）
  let rotatedAt = 0

  const inc = (name, n = 1) => {
    counters[name] = (counters[name] || 0) + Number(n || 1)
  }
  const observe = (name, ms) => {
    const v = Number(ms)
    if (!Number.isFinite(v) || v < 0) return
    const arr = latency[name] || (latency[name] = [])
    arr.push(v)
    if (arr.length > RESERVOIR) arr.splice(0, arr.length - RESERVOIR)
  }
  const percentile = (arr, p) => {
    if (!arr.length) return null
    const sorted = [...arr].sort((a, b) => a - b)
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
    return Math.round(sorted[idx])
  }
  const latencies = () => {
    const out = {}
    for (const [k, arr] of Object.entries(latency)) {
      out[k] = { n: arr.length, p50: percentile(arr, 50), p95: percentile(arr, 95), max: arr.length ? Math.max(...arr) : null }
    }
    return out
  }

  /** 结构化事件：JSONL，按大小滚动。写失败绝不影响主流程。 */
  const event = (type, data = {}) => {
    eventCount += 1
    if (type === 'reply' || type === 'skip') {
      recentEvents.push({ type, at: Date.now(), ...data })
      if (recentEvents.length > 20) recentEvents.shift()
    }
    if (!logFile) return
    try {
      if (rotatedAt === 0) rotatedAt = Date.now()
      if (existsSync(logFile) && statSync(logFile).size > maxBytes) {
        try {
          renameSync(logFile, logFile + '.1')
        } catch {
          /* ignore */
        }
      }
      const line = JSON.stringify({ ts: Date.now(), type, ...data }) + '\n'
      appendFileSync(logFile, line, 'utf8')
    } catch {
      /* 可观测性不能拖垮主流程 */
    }
  }

  const snapshot = () => ({
    version,
    startedAt,
    uptimeMs: Date.now() - startedAt,
    counters: { ...counters },
    latency: latencies(),
    events: eventCount,
    recent: [...recentEvents],
  })

  return { inc, observe, event, snapshot, reset() {
    for (const k of Object.keys(counters)) delete counters[k]
    for (const k of Object.keys(latency)) delete latency[k]
    eventCount = 0
    recentEvents.length = 0
  } }
}

/** 每条消息一个短 traceId，贯穿日志与事件 */
export function newTraceId() {
  return randomUUID().replace(/-/g, '').slice(0, 10)
}
