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

// 从后往前删
const b2 = blockRange("name: 'qqbot_outbox'")
lines.splice(b2[0], b2[1] - b2[0] + 1)
const b1 = blockRange("name: 'qqbot_history'")
lines.splice(b1[0], b1[1] - b1[0] + 1)

// 在 diagnosticTools 注册之后加 readTools 注册
const anchor = lines.findIndex((l) => l.includes("diagnosticTools({"))
if (anchor < 0) throw new Error('找不到 diagnosticTools 注册')
let closeAnchor = anchor
while (closeAnchor < lines.length && lines[closeAnchor] !== '  }') closeAnchor++
lines.splice(closeAnchor + 1, 0,
  '',
  '  // 只读查看工具（历史/重发队列）交给 lib/tools-read.mjs',
  '  for (const tool of readTools({ rooms, outbox, flushOutbox, textOut })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

// import
const diagImport = lines.findIndex((l) => l.includes("from './tools-diagnostics.mjs'"))
lines.splice(diagImport + 1, 0, "import { readTools } from './tools-read.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-read 抽取完成，行数', lines.length)
