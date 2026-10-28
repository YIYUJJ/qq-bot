import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const L = readFileSync(p, 'utf8').split(/\r?\n/)

const histIdx = L.findIndex((l) => /^  const HIST_STOP = new Set\(/.test(l))
if (histIdx < 0) throw new Error('找不到 HIST_STOP')
const line = L[histIdx]
L.splice(histIdx, 1)

const modelIdx = L.findIndex((l) => l.includes('const model = createModel({'))
if (modelIdx < 0) throw new Error('找不到 model 工厂')
L.splice(modelIdx, 0, line)
writeFileSync(p, L.join('\n'), 'utf8')
console.log('HIST_STOP 已前移')
