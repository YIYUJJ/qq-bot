import { readFileSync, writeFileSync } from 'node:fs'

let p = readFileSync('lib/prompt.mjs', 'utf8')
p = p.replace(/"roomTextOf","setMood"\]/, '"roomTextOf"]')
writeFileSync('lib/prompt.mjs', p, 'utf8')

let L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const i = L.findIndex((l) => l.includes('const prompt = createPrompt({'))
if (i < 0) throw new Error('找不到 createPrompt 调用')
L[i + 1] = '    config, cfgFor, getFeatures, isManagedRoom, memDirOf, pickFacts, roomTextOf,'
writeFileSync('lib/index.js', L.join('\n'), 'utf8')
console.log('prompt 依赖行已修复')
