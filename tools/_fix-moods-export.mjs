import { readFileSync, writeFileSync } from 'node:fs'

let p = readFileSync('lib/prompt.mjs', 'utf8')
if (!p.includes('export const MOODS')) {
  p = p.replace('const MOODS = {', 'export const MOODS = {')
  writeFileSync('lib/prompt.mjs', p, 'utf8')
}

let L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const imp = L.findIndex((l) => l.includes("from './prompt.mjs'"))
if (imp < 0) throw new Error('找不到 prompt import')
if (!L[imp].includes('MOODS')) L[imp] = "import { createPrompt, MOODS } from './prompt.mjs'"
writeFileSync('lib/index.js', L.join('\n'), 'utf8')
console.log('MOODS 从 prompt 导出并引入 index')
