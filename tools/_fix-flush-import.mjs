import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/index.js', 'utf8')
if (!s.includes("from './flush.mjs'")) {
  const a = s.indexOf("import { createSelfcheck } from './selfcheck.mjs'")
  if (a < 0) throw new Error('找不到 selfcheck import 锚点')
  const i = s.indexOf('\n', a) + 1
  s = s.slice(0, i) + "import { createFlush } from './flush.mjs'\n" + s.slice(i)
  writeFileSync('lib/index.js', s, 'utf8')
  console.log('flush import 已补')
} else {
  console.log('已有 flush import')
}
