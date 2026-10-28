import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/index.js', 'utf8')
const marker = '  // 提示词拼装交给 lib/prompt.mjs'
const start = s.indexOf(marker)
if (start < 0) throw new Error('找不到 prompt 块')
const destr = s.indexOf('const { moodName, inferMood, buildTranscript, systemPrompt } = prompt', start)
const end = s.indexOf('\n', destr) + 1
const block = s.slice(start, end)
s = s.slice(0, start) + s.slice(end)

const mem = s.indexOf('const { isGroupRoom, isManagedRoom, memDirOf, loadFacts, factsOf, factNorm, addFact, delFact, pickFacts, roomTextOf, invalidateRoomText, similarity } = memoryStore')
if (mem < 0) throw new Error('找不到 memoryStore 解构')
const insertAt = s.indexOf('\n', mem) + 1
s = s.slice(0, insertAt) + '\n' + block + s.slice(insertAt)
writeFileSync('lib/index.js', s, 'utf8')
console.log('prompt 工厂已移到 memoryStore 之后')
