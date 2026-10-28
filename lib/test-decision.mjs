/** decision.mjs 回归测试：优先级、静音、必回、安静时段、防重复、冷却、概率。 运行：node lib/test-decision.mjs */
import { DECISION_DEPS, createDecision } from './decision.mjs'

let pass = 0
const fails = []
const ok = (c, n) => {
  if (c) {
    pass += 1
    console.log('  PASS  ' + n)
  } else {
    fails.push(n)
    console.log('  FAIL  ' + n)
  }
}

let threw = ''
try {
  createDecision({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(DECISION_DEPS.includes('cfgFor'), '依赖清单')

const baseCfg = {
  replyProbability: 1,
  minReplyGapMs: 0,
  maxRepliesPer10Min: 200,
  repeatWindowMs: 600000,
  quietAllowAt: true,
  conversationWindowMs: 60000,
}
const decision = createDecision({
  config: { aliases: ['小鲸鱼'], botName: '小鲸鱼', conversationWindowMs: 60000 },
  cfgFor: () => baseCfg,
})
const { priorityOf, normText, decide } = decision

// 优先级
const mkRoom = (over = {}) => ({ roomId: '900001', isGroup: true, replyTimes: [], lastReplyAt: 0, repliedTexts: [], lastSender: '', ...over })
ok(priorityOf({ isAtMe: true, text: '在吗' }, mkRoom()) === 'at', '@ 优先级最高')
ok(priorityOf({ isAtMe: false, text: '小鲸鱼在吗' }, mkRoom()) === 'name', '叫名字识别')
ok(priorityOf({ isAtMe: false, text: '今天吃什么' }, mkRoom()) === 'ambient', '普通聊天 ambient')
ok(priorityOf({ isAtMe: false, text: '接着说', sender: '42' }, mkRoom({ lastSender: '42', lastReplyAt: Date.now() - 1000 })) === 'continuation', '对话延续')

// normText
ok(normText('哈哈，[表情] 真的吗？！') === '哈哈真的吗', 'normText 去标点/表情')

// 决策：必回
const now = Date.now()
ok(decide(mkRoom(), { priority: 'ambient', quiet: false, now, text: 'x', force: true }).reply === true, 'force 必回')

// 静音
ok(decide(mkRoom({ muteUntil: now + 60000 }), { priority: 'at', quiet: false, now, text: 'x' }).reply === false, '静音中不回复')

// 安静时段（非 @）
ok(decide(mkRoom(), { priority: 'ambient', quiet: true, now, text: 'x' }).reply === false, '安静时段不回复')
ok(decide(mkRoom(), { priority: 'at', quiet: true, now, text: 'x' }).reply === true, '@ 在安静时段仍回复（quietAllowAt）')

// 防重复（长句）
const dup = mkRoom({ repliedTexts: [{ norm: normText('这句话刚刚说过了'), at: now }] })
ok(decide(dup, { priority: 'ambient', quiet: false, now, text: '这句话刚刚说过了！' }).reply === false, '长句重复被拦')
ok(decide(dup, { priority: 'ambient', quiet: false, now, text: '哈哈！' }).reply === true, '短句允许重复')

// 10 分钟上限
const busy = mkRoom({ replyTimes: Array.from({ length: 200 }, () => now - 1000) })
ok(decide(busy, { priority: 'ambient', quiet: false, now, text: 'x' }).reply === false, '10 分钟上限触发')

// 冷却
const cool = mkRoom({ lastReplyAt: now - 1000 })
// 冷却 3 秒
const decisionCool = createDecision({ config: { aliases: [], botName: 'bot', conversationWindowMs: 60000 }, cfgFor: () => ({ ...baseCfg, minReplyGapMs: 3000 }) })
ok(decisionCool.decide(cool, { priority: 'ambient', quiet: false, now, text: 'x' }).reply === false, '冷却中不回复')
ok(decide(cool, { priority: 'at', quiet: false, now, text: 'x' }).reply === true, '@ 不受冷却限制')

console.log('')
if (fails.length) {
  console.log(`❌ test-decision.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-decision.mjs 通过 ${pass} 项，失败 0 项`)
