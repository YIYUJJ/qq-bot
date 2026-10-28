import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-metrics.mjs', 'utf8')
if (!s.includes('recent 只收')) {
  const block = `
// recent：只保留 reply/skip，最多 20 条
metrics.event('reply', { trace: 't1', stages: { decideMs: 1 } })
metrics.event('skip', { trace: 't2', reason: 'x' })
metrics.event('other', { a: 1 })
const snap2 = metrics.snapshot()
ok(snap2.recent.length === 2, 'recent 只收 reply/skip')
ok(snap2.recent[0].stages.decideMs === 1, 'recent 带阶段数据')

console.log('')`
  s = s.replace("\nconsole.log('')", block)
  writeFileSync('lib/test-metrics.mjs', s, 'utf8')
  console.log('已补 recent 断言')
} else {
  console.log('已存在')
}
