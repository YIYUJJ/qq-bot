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

for (const name of ['qqbot_ask', 'qqbot_say']) {
  const [s, e] = blockRange(`name: '${name}'`)
  lines.splice(s, e - s + 1)
}

const anchor = lines.findIndex((l) => l.includes('opsTools({'))
if (anchor < 0) throw new Error('找不到 opsTools 注册')
let closeAnchor = anchor
while (closeAnchor < lines.length && lines[closeAnchor] !== '  }') closeAnchor++
lines.splice(closeAnchor + 1, 0,
  '',
  '  // 发送类工具（say/ask）交给 lib/tools-reply.mjs',
  '  for (const tool of replyTools({',
  '    assertGroupAllowed, roomState, config, sendWithRetry, stats,',
  '    buildSearchNote, buildTranscript, generate, systemPrompt, sendReply, log, textOut,',
  '  })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

const opsImport = lines.findIndex((l) => l.includes("from './tools-ops.mjs'"))
lines.splice(opsImport + 1, 0, "import { replyTools } from './tools-reply.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-reply 抽取完成，行数', lines.length)
