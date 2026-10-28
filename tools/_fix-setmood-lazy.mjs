import { readFileSync, writeFileSync } from 'node:fs'

const L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const i = L.findIndex((l) => l.trim() === 'setMood,' && L[L.indexOf(l) + 1]?.includes('scheduleFlush'))
const idx = L.findIndex((line, k) => line.trim() === 'setMood,' && L[k + 1] && L[k + 1].includes('scheduleFlush'))
if (idx < 0) throw new Error('找不到 setMood 依赖行')
L[idx] = '    setMood: (r, n, i) => setMood(r, n, i),'
writeFileSync('lib/index.js', L.join('\n'), 'utf8')
console.log('已改为惰性 setMood')
