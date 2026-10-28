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

const b2 = blockRange("name: 'qqbot_search'")
lines.splice(b2[0], b2[1] - b2[0] + 1)
const b1 = blockRange("name: 'qqbot_poke'")
lines.splice(b1[0], b1[1] - b1[0] + 1)

const anchor = lines.findIndex((l) => l.includes('stickerTools({'))
if (anchor < 0) throw new Error('找不到 stickerTools 注册')
let closeAnchor = anchor
while (closeAnchor < lines.length && lines[closeAnchor] !== '  }') closeAnchor++
lines.splice(closeAnchor + 1, 0,
  '',
  '  // 轻量动作工具（拍一拍/联网搜索）交给 lib/tools-actions.mjs',
  '  for (const tool of actionTools({ assertGroupAllowed, config, ob, sensitiveQuery, webSearch, textOut })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

const stickerImport = lines.findIndex((l) => l.includes("from './tools-stickers.mjs'"))
lines.splice(stickerImport + 1, 0, "import { actionTools } from './tools-actions.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-actions 抽取完成，行数', lines.length)
