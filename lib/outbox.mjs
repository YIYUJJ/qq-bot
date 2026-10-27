/**
 * 发送失败重试队列 —— 抽成独立模块，纯逻辑 + 可注入的 deliver/时钟/持久化。
 *
 * 为什么抽出来：这段逻辑（退避、次数上限、永久失败丢弃、跨重启续存）是最需要
 * 精确验证的部分，但塞在插件里只能靠"真的把网络掐了"来测。抽出来后可以注入
 * 一个假发送器和假时钟，把 5 次重试、10 分钟过期、永久失败这些分支全跑一遍。
 */

/** 只有"可能恢复了就能成"的错误才值得重发。 */
export function shouldRetrySend(err) {
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout|socket|network|HTTP 5\d\d|端点未就绪|WebSocket|连接/i.test(
    String(err || ''),
  )
}

export class Outbox {
  constructor({
    load = () => [],
    save = () => {},
    deliver = async () => {},
    log = () => {},
    maxItems = 50,
    maxAttempts = 5,
    maxAgeMs = 10 * 60_000,
    baseDelayMs = 5000,
    maxDelayMs = 300_000,
    now = () => Date.now(),
    random = Math.random,
  } = {}) {
    this.load = load
    this.save = save
    this.deliver = deliver
    this.log = log
    this.maxItems = maxItems
    this.maxAttempts = maxAttempts
    this.maxAgeMs = maxAgeMs
    this.baseDelayMs = baseDelayMs
    this.maxDelayMs = maxDelayMs
    this.now = now
    this.random = random
    const loaded = load()
    this.items = Array.isArray(loaded) ? loaded.filter((x) => x && x.id && x.roomId) : []
  }

  get count() {
    return this.items.length
  }

  persist() {
    if (this.items.length > this.maxItems) this.items = this.items.slice(-this.maxItems)
    this.save(this.items)
  }

  enqueue({ roomId, isGroup, kind, payload, error }) {
    const item = {
      id: `${this.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      roomId: String(roomId),
      isGroup: !!isGroup,
      kind,
      payload,
      at: this.now(),
      attempts: 0,
      nextAt: this.now() + this.baseDelayMs,
      lastError: String(error || '').slice(0, 200),
    }
    this.items.push(item)
    this.persist()
    this.log(`入队重发（${item.roomId}）：${String(error || '').slice(0, 120)}`)
    return item
  }

  remove(id) {
    this.items = this.items.filter((x) => x.id !== id)
    this.persist()
  }

  drop(item, why) {
    this.remove(item.id)
    this.log(`放弃重发（${item.roomId}）：${why}`)
    return 'dropped'
  }

  /** 跑一轮：到点的尝试发送，失败按退避排下一次。返回 {sent, failed, dropped}。 */
  async flush() {
    const stats = { sent: 0, failed: 0, dropped: 0 }
    if (!this.items.length) return stats
    const now = this.now()
    for (const item of [...this.items]) {
      if (item.nextAt > now) continue
      if (item.attempts >= this.maxAttempts || now - item.at > this.maxAgeMs) {
        this.drop(item, `超过次数/时效（${item.attempts} 次，${Math.round((now - item.at) / 1000)}s）`)
        stats.dropped += 1
        continue
      }
      try {
        await this.deliver(item)
        this.remove(item.id)
        this.log(`重发成功（${item.roomId}，第 ${item.attempts + 1} 次）`)
        stats.sent += 1
      } catch (e) {
        const msg = String(e?.message || e)
        item.attempts += 1
        item.lastError = msg.slice(0, 200)
        if (!shouldRetrySend(msg) || item.attempts >= this.maxAttempts) {
          this.drop(item, msg.slice(0, 120))
          stats.dropped += 1
          continue
        }
        // 指数退避：首次失败后 10s，然后 20s、40s…（封顶 5 分钟；入队本身先等 5s）
        const delay = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** item.attempts)
        item.nextAt = this.now() + delay
        this.persist()
        stats.failed += 1
        this.log(`重发失败（${item.roomId}，第 ${item.attempts} 次）：${msg.slice(0, 80)}，${Math.round(delay / 1000)}s 后再试`)
      }
    }
    return stats
  }

  list({ limit = 20 } = {}) {
    return this.items.slice(-limit).map((x) => ({
      id: x.id,
      roomId: x.roomId,
      isGroup: x.isGroup,
      kind: x.kind,
      attempts: x.attempts,
      at: x.at,
      nextAt: x.nextAt,
      lastError: x.lastError,
      preview: typeof x.payload === 'string' ? x.payload.slice(0, 60) : '[图片段]',
    }))
  }
}
