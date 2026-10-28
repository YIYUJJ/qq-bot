import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/index.js', 'utf8')
const marker = '  // 运行期调度交给 lib/scheduler.mjs'
const start = s.indexOf(marker)
if (start < 0) throw new Error('找不到 scheduler 块')
const destr = s.indexOf('const { proactiveTick, inHours, startPolling, stopPolling } = scheduler', start)
const end = s.indexOf('\n', destr) + 1
const block = s.slice(start, end)
s = s.slice(0, start) + s.slice(end)

const anchor = s.indexOf('const { primeAllowed, pollOnce, privateTargets } = polling')
const insertAt = s.indexOf('\n', anchor) + 1
s = s.slice(0, insertAt) + '\n' + block + s.slice(insertAt)
writeFileSync('lib/index.js', s, 'utf8')
console.log('scheduler 已移到 polling 之后')
