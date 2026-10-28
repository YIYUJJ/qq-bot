import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-flush.mjs', 'utf8')
if (!s.includes('trace 事件')) {
  s = s.replace(
    "// 生成失败不崩溃",
    `// trace：回复事件带 trace 与阶段耗时
const replyEvents = events.filter((e) => e.type === 'reply')
ok(replyEvents.length >= 1, '发出 reply 事件')
if (replyEvents.length) {
  const d = replyEvents[0].data
  ok(typeof d.trace === 'string' && d.trace.length > 0, 'trace 事件带 traceId')
  ok(d.stages && typeof d.stages.decideMs === 'number', '阶段耗时包含 decideMs')
}

// 生成失败不崩溃`,
  )
  writeFileSync('lib/test-flush.mjs', s, 'utf8')
  console.log('已补 trace 断言')
}
