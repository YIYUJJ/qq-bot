import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/index.js', 'utf8')
const marker = '  // 长期记忆存储层交给 lib/memory-store.mjs'
const start = s.indexOf(marker)
if (start < 0) throw new Error('找不到记忆存储块')
const end = s.indexOf('  const { isGroupRoom, isManagedRoom', start)
const nl = s.indexOf('\n', end)
const blockEnd = s.indexOf('\n', nl + 1) // 这一行的换行
const block = s.slice(start, blockEnd + 1)
s = s.slice(0, start) + s.slice(blockEnd + 1)

// 插到 memory-auto 工厂之前
const anchor = s.indexOf('  // maybeAutoExtract 交给 lib/memory-auto.mjs')
if (anchor < 0) throw new Error('找不到 memory-auto 锚点')
s = s.slice(0, anchor) + block + '\n' + s.slice(anchor)
writeFileSync('lib/index.js', s, 'utf8')
console.log('memoryStore 已前移')
