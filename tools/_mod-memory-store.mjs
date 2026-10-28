import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const L = readFileSync(p, 'utf8').split(/\r?\n/)

const start = L.findIndex((l) => l.includes('// ── 长期记忆（每个会话一个文件夹'))
if (start < 0) throw new Error('找不到记忆块起点')
const end = L.findIndex((l, i) => i > start && l.trim() === '}' && L[i - 1].includes('return list.slice(-n)'))
if (end < 0) throw new Error('找不到记忆块终点')

const block = L.slice(start, end + 1)
const deps = ['config', 'rooms', 'groupNames', 'facts', 'memoryDir', 'log', 'keywordsOf']
const header = `/**
 * 长期记忆存储层（每个会话一个文件夹）。
 *
 * 只负责"事实"的读写与去重相似度；提炼/画像/摘要/关系这些需要模型的部分仍在 index.js。
 */
import { ensureRoom, readRoomMemory, writeRoomFacts, readRoomText, readDiary, readSelf } from './memory.mjs'

export const MEMORY_STORE_DEPS = ${JSON.stringify(deps)}

export function createMemoryStore(deps) {
  const missing = MEMORY_STORE_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('记忆存储缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const footer = `
  return { isGroupRoom, isManagedRoom, memDirOf, loadFacts, factsOf, factNorm, addFact, delFact, pickFacts, roomTextOf, invalidateRoomText, similarity }
}
`
writeFileSync('lib/memory-store.mjs', header + block.map((l) => (l.startsWith('  ') ? l : '  ' + l)).join('\n') + footer, 'utf8')

const call = [
  '  // 长期记忆存储层交给 lib/memory-store.mjs',
  '  const memoryStore = createMemoryStore({ config, rooms, groupNames, facts, memoryDir: MEMORY_DIR, log, keywordsOf })',
  '  const { isGroupRoom, isManagedRoom, memDirOf, loadFacts, factsOf, factNorm, addFact, delFact, pickFacts, roomTextOf, invalidateRoomText, similarity } = memoryStore',
  '',
]
L.splice(start, end - start + 1, ...call)
let out = L.join('\n')
if (!out.includes("from './memory-store.mjs'")) {
  const a = out.indexOf("import { createPolling } from './polling.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createMemoryStore } from './memory-store.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('memory-store 抽取完成：', block.length, '行')
