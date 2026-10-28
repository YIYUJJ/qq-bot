/**
 * 回复决策：优先级（@/叫名字/对话延续）→ 静音/必回/安静时段/防重复/冷却/概率。
 *
 * 纯逻辑 + 每群配置，不碰网络；测试可以完整覆盖。
 */
import { detectTrigger } from './policy.mjs'

export const DECISION_DEPS = ["config","cfgFor"]

export function createDecision(deps) {
  const missing = DECISION_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('决策模块缺少依赖：' + missing.join(', '))
  const { config, cfgFor } = deps

  function priorityOf(msg, r) {
    const base = detectTrigger(
      { isAtMe: msg.isAtMe, atAll: msg.atAll, text: msg.text },
      { aliases: config.aliases, selfNames: [config.botName] },
    )
    if (base === 'at' || base === 'name') return base
    // 刚跟我聊过的人接着说 → 对话延续（真人不会聊到一半突然不理）
    if (
      r &&
      r.lastSender &&
      String(msg.sender) === r.lastSender &&
      r.lastReplyAt &&
      Date.now() - r.lastReplyAt < Number(config.conversationWindowMs)
    ) {
      return 'continuation'
    }
    return base
  }

  /** 判定用的文本归一（去标点/空白/表情），用于「同一句话不重复回」。 */
  function normText(s) {
    return String(s || '')
      .replace(/\[[^\]]{1,6}\]/g, '')
      .replace(/[\s\p{P}\p{S}]/gu, '')
      .toLowerCase()
      .slice(0, 80)
  }

  function decide(r, { priority, quiet, now, text, force }) {
    const c = cfgFor(r.roomId)
    // 管理员遥控的静音优先于一切（包括必回）
    if (r.isGroup && r.muteUntil && now < r.muteUntil) {
      return { reply: false, reason: `管理员静音中（还剩 ${Math.ceil((r.muteUntil - now) / 60000)} 分钟）`, priority }
    }
    // 管理员私聊 / 该群必回：不看概率、不看安静时段、不复读检测
    if (force) return { reply: true, reason: '强制回复（管理员/必回群）', priority }
    if (quiet && !(priority === 'at' && c.quietAllowAt)) {
      return { reply: false, reason: '安静时段', priority }
    }
    // 同一句话刚回过就别复读（只对"长句"生效：真人本来就会反复说"嗯""行吧"）
    const norm = normText(text)
    const win = Number(c.repeatWindowMs) || 0
    if (norm && win > 0 && norm.length >= 6) {
      const hit = (r.repliedTexts || []).find((x) => x.norm === norm && now - x.at < win)
      if (hit) return { reply: false, reason: '刚回过这句（防重复）', priority }
    }
    const last10 = r.replyTimes.filter((t) => now - t < 600000).length
    if (last10 >= Number(c.maxRepliesPer10Min)) {
      return { reply: false, reason: `10 分钟上限 ${last10}`, priority }
    }
    const gap = now - r.lastReplyAt
    const minGap = Number(c.minReplyGapMs) || 0
    if (priority !== 'at' && r.lastReplyAt && gap < minGap) {
      return { reply: false, reason: `冷却中（还差 ${Math.ceil((minGap - gap) / 1000)}s）`, priority }
    }
    const p =
      priority === 'at'
        ? Number(c.atChance)
        : priority === 'name'
          ? Number(c.nameChance)
          : priority === 'continuation'
            ? Number(c.continuationChance)
            : priority === 'question'
              ? Number(c.questionChance)
              : Number(c.replyProbability)
    const roll = Math.random()
    if (roll >= p) return { reply: false, reason: `概率未中（${priority} ${Math.round(p * 100)}%）`, priority }
    return { reply: true, reason: `${priority} 命中`, priority }
  }
  return { priorityOf, normText, decide }
}
