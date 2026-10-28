import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

function blockRange(nameMarker) {
  const idx = lines.findIndex((l) => l.includes(nameMarker))
  if (idx < 0) throw new Error('找不到 ' + nameMarker)
  let start = idx
  while (start >= 0 && !lines[start].includes('ctx.effect(() =>')) start--
  let close = -1
  for (let i = idx; i < lines.length; i++) {
    if (lines[i] === '  )') {
      close = i
      break
    }
  }
  if (start < 0 || close < 0) throw new Error('找不到块边界 ' + nameMarker)
  return [start, close]
}

const [s, e] = blockRange("name: 'qqbot_memory'")
lines.splice(s, e - s + 1)

const anchor = lines.findIndex((l) => l.includes('selftestTools({'))
if (anchor < 0) throw new Error('找不到 selftestTools 注册')
let closeAnchor = anchor
while (closeAnchor < lines.length && lines[closeAnchor] !== '  }') closeAnchor++
lines.splice(closeAnchor + 1, 0,
  '',
  '  // 长期记忆工具交给 lib/tools-memory.mjs',
  '  for (const tool of memoryTools({',
  '    config, isManagedRoom, cfgFor, roomState, facts, factsOf, loadFacts, factNorm,',
  '    addFact, delFact, writeRoomFacts, memDirOf, readRoomText, readJson, graphPath,',
  '    updateProfile, updateSummary, updateRelations, extractFacts, searchMemory, exportMemory, textOut,',
  '  })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

const selftestImport = lines.findIndex((l) => l.includes("from './tools-selftest.mjs'"))
lines.splice(selftestImport + 1, 0, "import { memoryTools } from './tools-memory.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-memory 抽取完成，行数', lines.length)
