/**
 * 失败告警：短时间内连续失败达到阈值，就私聊管理员一次。
 *
 * 目的：机器人半夜挂了没人知道；日志只有人主动看才有用。
 */
export const ALERT_DEPS = ['config', 'getOb', 'log']

export function createAlert(deps, options = {}) {
  const missing = ALERT_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('告警模块缺少依赖：' + missing.join(', '))
  const { config, getOb, log } = deps
  const windowMs = Number(options.windowMs) || 5 * 60 * 1000
  const threshold = Math.max(2, Number(options.threshold) || 3)
  const cooldownMs = Number(options.cooldownMs) || 30 * 60 * 1000
  const now = options.now || (() => Date.now())

  const hits = []
  let lastSentAt = 0

  function adminTarget() {
    const list = Array.isArray(config.adminQQ) ? config.adminQQ : []
    return list.length ? String(list[0]) : ''
  }

  /**
   * 记一次失败。达到阈值且不在冷却中就私聊管理员。
   * @returns {boolean} 本次是否真的发出了告警
   */
  function record(kind, error) {
    const t = now()
    const message = String(error?.message || error || '').slice(0, 200)
    hits.push({ t, kind: String(kind || '未知'), message })
    while (hits.length && t - hits[0].t > windowMs) hits.shift()
    if (hits.length < threshold) return false
    if (lastSentAt && t - lastSentAt < cooldownMs) return false
    const to = adminTarget()
    if (!to) return false
    lastSentAt = t
    const lines = hits
      .slice(-threshold)
      .map((h) => `· ${h.kind}：${h.message}`)
      .join('\n')
    const text = `⚠️ qq-bot 最近 ${windowMs / 60000} 分钟内连续失败 ${hits.length} 次\n${lines}\n（${cooldownMs / 60000} 分钟内不再重复提醒）`
    Promise.resolve()
      .then(() => getOb().sendPrivate(to, text))
      .then(() => log(`失败告警已发送给管理员 ${to}`))
      .catch((e) => log('失败告警发送失败：' + String(e?.message || e)))
    return true
  }

  function reset() {
    hits.length = 0
    lastSentAt = 0
  }

  return { record, reset, get count() { return hits.length } }
}
