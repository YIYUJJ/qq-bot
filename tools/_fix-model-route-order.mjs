import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/index.js', 'utf8')
const marker = '  // 模型路由交给 lib/model-route.mjs'
const start = s.indexOf(marker)
if (start < 0) throw new Error('找不到 modelRoute 块')
const end = s.indexOf('const { resolveModel, resolveVisionRoute } = modelRoute', start)
const endLine = s.indexOf('\n', end) + 1
const block = s.slice(start, endLine)
s = s.slice(0, start) + s.slice(endLine)

const anchor = '  // 状态容器（持久化对象）交给 lib/state-init.mjs'
const idx = s.indexOf(anchor)
if (idx < 0) throw new Error('找不到 stateInit 锚点')
s = s.slice(0, idx) + block + '\n' + s.slice(idx)
writeFileSync('lib/index.js', s, 'utf8')
console.log('modelRoute 已前移')
