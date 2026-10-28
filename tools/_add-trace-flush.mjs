import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/flush.mjs', 'utf8')

// 1) 依赖：newTraceId
s = s.replace('"metrics","moodName"', '"metrics","moodName","newTraceId"')
s = s.replace('metrics, moodName,', 'metrics, moodName, newTraceId,')

// 2) trigger 之后建立 trace 与计时
s = s.replace(
  '    const trigger = batch[batch.length - 1]',
  '    const trigger = batch[batch.length - 1]\n    const trace = r.traceId || (r.traceId = newTraceId())\n    const tBegin = Date.now()',
)

// 3) decide 前记时间
s = s.replace('    const d = decide(r, { priority, quiet, now, text: trigger.text, force })', '    const tDecide = Date.now()\n    const d = decide(r, { priority, quiet, now, text: trigger.text, force })')

// 4) skip 事件带 trace
s = s.replace(
  "      stats.skipped += 1\n      metrics.inc('skipped')\n      return",
  "      stats.skipped += 1\n      metrics.inc('skipped')\n      metrics.event('skip', { trace, room: r.roomId, priority, reason: d.reason })\n      return",
)

// 5) 生成计时
s = s.replace('      const t0 = Date.now()', '      const t0 = Date.now()\n      const tGen = t0')

// 6) 发送计时 + 结构化阶段事件
s = s.replace(
  "      metrics.event('reply', { room: r.roomId, priority, firstTokenMs: out.firstTokenMs, totalMs: Date.now() - t0, trace: r.traceId })",
  "      metrics.event('reply', {\n        trace, room: r.roomId, priority, firstTokenMs: out.firstTokenMs, totalMs: Date.now() - t0,\n        stages: { decideMs: tDecide - tBegin, queueMs: t0 - tDecide, generateMs: tSentAt - t0, sendMs: Date.now() - tSentAt },\n        parts: sent.length, tokens: out.usage || null,\n      })",
)

// 7) 发送开始时间（在 sendReply 之前）
s = s.replace(
  "      const quote = priority === 'at' || trigger.replyId ? trigger.id : ''",
  "      const quote = priority === 'at' || trigger.replyId ? trigger.id : ''\n      const tSentAt = Date.now()",
)

// 8) observe 阶段延迟
s = s.replace(
  "      metrics.observe('totalMs', Date.now() - t0)",
  "      metrics.observe('totalMs', Date.now() - t0)\n      metrics.observe('decideMs', tDecide - tBegin)\n      metrics.observe('sendMs', Date.now() - tSentAt)",
)

writeFileSync('lib/flush.mjs', s, 'utf8')
console.log('flush 已加 trace 与阶段计时')
