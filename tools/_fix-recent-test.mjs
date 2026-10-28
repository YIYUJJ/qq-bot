import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-metrics.mjs', 'utf8')
const bad = `m.event('reply', { trace: 't1', stages: { decideMs: 1 } })
m.event('skip', { trace: 't2', reason: 'x' })
m.event('other', { a: 1 })
const snap2 = m.snapshot()`
const good = `const m2 = createMetrics({ version: 't2' })
m2.event('reply', { trace: 't1', stages: { decideMs: 1 } })
m2.event('skip', { trace: 't2', reason: 'x' })
m2.event('other', { a: 1 })
const snap2 = m2.snapshot()`
s = s.replace(bad, good)
writeFileSync('lib/test-metrics.mjs', s, 'utf8')
console.log('已改用独立实例')
