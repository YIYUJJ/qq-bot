/**
 * 后台定时任务：统一注册、统一兜底、统一清理。
 *
 * 之前 8 个 setInterval 散在 apply() 末尾，重复的 unref/add 容易漏。
 * 现在集中到这里：所有回调自动套 safe（异常只记日志），句柄进 timers，dispose 一次清空。
 */

export function startTimers({ safe, timers, config, handlers }) {
  const every = (name, fn, ms) => {
    const t = setInterval(safe('timer:' + name, fn), ms)
    if (t.unref) t.unref()
    timers.add(t)
    return t
  }

  // 主动找人（没人说话时自己冒泡）
  every('主动找人', handlers.proactive, 5 * 60_000)
  // 提醒到点检查
  every('提醒检查', handlers.reminders, 30_000)
  // 每日日记：每 10 分钟看一次是不是该写了
  every('每日日记', handlers.diary, 10 * 60_000)
  // 自动备份：每小时看一次
  every('每日备份', handlers.backup, 60 * 60_000)
  // 亲密度/成长曲线落盘
  every('亲密度/曲线落盘', handlers.bond, 60_000)
  // 定期自检，让面板上的「健康」不是一直"未检查"
  every('自检', handlers.health, Math.max(30_000, Number(config.healthCheckMs) || 300_000))
  // 记忆增强：每日摘要 + 过期原文清理（10 分钟看一次）、带日期的事主动跟进（5 分钟）
  if (handlers.memDaily) every('每日摘要', handlers.memDaily, 10 * 60_000)
  if (handlers.memFollow) every('主动跟进', handlers.memFollow, 5 * 60_000)
  // 记忆深化：每晚整理（consolidateHour:30）+ 反思归纳（reflectHour），10 分钟看一次是不是到点了
  if (handlers.memDeep) every('每晚整理与反思', handlers.memDeep, 10 * 60_000)

  return {
    stop() {
      for (const t of timers) {
        try {
          clearInterval(t)
        } catch {
          /* ignore */
        }
      }
      timers.clear()
    },
  }
}
