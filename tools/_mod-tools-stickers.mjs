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

const b2 = blockRange("name: 'qqbot_sticker_sweep'")
lines.splice(b2[0], b2[1] - b2[0] + 1)
const b1 = blockRange("name: 'qqbot_sticker_del'")
lines.splice(b1[0], b1[1] - b1[0] + 1)

const anchor = lines.findIndex((l) => l.includes('inspectTools({'))
if (anchor < 0) throw new Error('找不到 inspectTools 注册')
let closeAnchor = anchor
while (closeAnchor < lines.length && lines[closeAnchor] !== '  }') closeAnchor++
lines.splice(closeAnchor + 1, 0,
  '',
  '  // 图库维护工具交给 lib/tools-stickers.mjs',
  '  for (const tool of stickerTools({',
  '    stickers, writeJson, stickersFile: STICKERS_FILE, markStickersDirty, log, rmSync, existsSync,',
  '    sweepStickerLibrary, stickerDir: STICKER_DIR, textOut,',
  '  })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

const inspectImport = lines.findIndex((l) => l.includes("from './tools-inspect.mjs'"))
lines.splice(inspectImport + 1, 0, "import { stickerTools } from './tools-stickers.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-stickers 抽取完成，行数', lines.length)
