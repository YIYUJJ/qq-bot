/**
 * 运行期调度：主动说话（proactive）与轮询定时器。
 *
 * 从 index.js 抽出；pollTimer 由模块自己持有，dispose 时调 stopPolling。
 */
export const SCHEDULER_DEPS = ["config","rooms","cfgFor","allowedHere","isQuiet","quietWindowsFor","generate","systemPrompt","buildTranscript","humanizeText","sendReply","log","safeTick","timers","pollOnce","privateTargets"]

export function createScheduler(deps) {
  const missing = SCHEDULER_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('调度模块缺少依赖：' + missing.join(', '))
  const { config, rooms, cfgFor, allowedHere, isQuiet, quietWindowsFor, generate, systemPrompt, buildTranscript, humanizeText, sendReply, log, safeTick, timers, pollOnce, privateTargets } = deps
  let pollTimer = null

  function proactiveTick() {
    if (!config.enabled) return
    const now = Date.now()
    for (const r of rooms.values()) {
      if (!allowedHere(r)) continue
      if (r.flushing) continue
      const c = cfgFor(r.roomId)
      if (!c.proactive) continue
      // 安静时段不主动；10 分钟回复上限也管着（否则主动说话会把额度用光）
      if (isQuiet(quietWindowsFor(c.quietHours))) continue
      if (r.replyTimes.filter((t) => now - t < 600000).length >= Number(c.maxRepliesPer10Min)) continue
      if (!inHours(c.proactiveHours, new Date(now))) continue
      if (!r.lastActivityAt || now - r.lastActivityAt < Number(c.proactiveIdleMs)) continue
      if (r.lastProactiveAt && now - r.lastProactiveAt < Number(c.proactiveMinGapMs)) continue
      if (Math.random() >= Number(c.proactiveChance)) continue
      void (async () => {
        r.flushing = true
        try {
          const user = [
            `群「${r.roomName || r.roomId}」已经 ${Math.round((now - r.lastActivityAt) / 60000)} 分钟没人说话了。`,
            buildTranscript(r, 10),
            '',
            '你可以主动起个话头（一句，口语，别用"在吗"），或者干脆不吭声。',
          ].join('\n')
          const { text } = await generate({ system: systemPrompt(r), user })
          if (!text) return
          // 主动说的话也要过一遍去 AI 味（否则只有被动回复是"人话"，偶尔冒一句很机械）
          const say = c.humanize ? humanizeText(text, { dropPeriod: Number(c.humanizeDropPeriod) || 0 }) : text
          if (!String(say || '').trim()) return
          const sent = await sendReply(r, { text: say, priority: 'ambient' })
          if (sent.length) r.lastProactiveAt = Date.now()
          log(`主动说话 ${r.roomName || r.roomId}：${text.slice(0, 40)}`)
        } catch (e) {
          log('主动说话失败：' + String(e?.message || e))
        } finally {
          r.flushing = false
        }
      })()
    }
  }

  function inHours(spec, date) {
    const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(spec || '').trim())
    if (!m) return true
    const cur = date.getHours() * 60 + date.getMinutes()
    const s = Number(m[1]) * 60 + Number(m[2])
    const e = Number(m[3]) * 60 + Number(m[4])
    return s <= e ? cur >= s && cur < e : cur >= s || cur < e
  }

  function startPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      timers.delete(pollTimer)
      pollTimer = null
    }
    const ms = Number(config.pollMs) || 0
    if (!(ms > 0)) {
      log('轮询已关闭（pollMs=0）：只靠 HTTP 推送')
      return
    }
    pollTimer = setInterval(safeTick('轮询', () => pollOnce()), Math.max(200, ms))
    if (pollTimer.unref) pollTimer.unref()
    timers.add(pollTimer)
    log(
      `轮询兜底已开：每 ${ms}ms 拉一次（群 ${config.allowGroups.join(',') || '无'}｜私聊 ${privateTargets().join(',') || '无'}）`,
    )
  }
  function stopPolling() {
    if (!pollTimer) return
    clearInterval(pollTimer)
    try {
      timers.delete(pollTimer)
    } catch {
      /* ignore */
    }
    pollTimer = null
  }

  return { proactiveTick, inHours, startPolling, stopPolling }
}
