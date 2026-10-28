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

for (const name of ['qqbot_backup', 'qqbot_send_sticker']) {
  const [s, e] = blockRange(`name: '${name}'`)
  lines.splice(s, e - s + 1)
}

const anchor = lines.findIndex((l) => l.includes('replyTools({'))
if (anchor < 0) throw new Error('找不到 replyTools 注册')
let closeAnchor = anchor
while (closeAnchor < lines.length && lines[closeAnchor] !== '  }') closeAnchor++
lines.splice(closeAnchor + 1, 0,
  '',
  '  // 杂项工具（发表情/备份）交给 lib/tools-misc.mjs',
  '  for (const tool of miscTools({',
  '    assertGroupAllowed, stickers, config, sendStickerTo,',
  '    backupTick, readJson, backupStateFile: BACKUP_STATE_FILE, backupNow, backupRestore, backupList, textOut,',
  '  })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

const replyImport = lines.findIndex((l) => l.includes("from './tools-reply.mjs'"))
lines.splice(replyImport + 1, 0, "import { miscTools } from './tools-misc.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-misc 抽取完成，行数', lines.length)
