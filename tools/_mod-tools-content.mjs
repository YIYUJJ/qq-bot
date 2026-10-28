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

const b2 = blockRange("name: 'qqbot_vision'")
lines.splice(b2[0], b2[1] - b2[0] + 1)
const b1 = blockRange("name: 'qqbot_diary'")
lines.splice(b1[0], b1[1] - b1[0] + 1)

const anchor = lines.findIndex((l) => l.includes('configTools({'))
if (anchor < 0) throw new Error('找不到 configTools 注册')
let closeAnchor = anchor
while (closeAnchor < lines.length && lines[closeAnchor] !== '  }') closeAnchor++
lines.splice(closeAnchor + 1, 0,
  '',
  '  // 内容类工具（日记/识图）交给 lib/tools-content.mjs',
  '  for (const tool of contentTools({',
  '    getFeatures, isManagedRoom, memDirOf, readDiary, readSelf, rooms,',
  '    describeImage, config, assertGroupAllowed, roomState, textOut,',
  '  })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

const cfgImport = lines.findIndex((l) => l.includes("from './tools-config.mjs'"))
lines.splice(cfgImport + 1, 0, "import { contentTools } from './tools-content.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-content 抽取完成，行数', lines.length)
