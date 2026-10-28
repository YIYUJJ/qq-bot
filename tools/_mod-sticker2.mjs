import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let text = raw.split(/\r?\n/).join('\n')
let lines = text.split('\n')

function findFn(name) {
  return lines.findIndex((l) => l.includes('function ' + name + '('))
}
function fnEnd(start) {
  // 从 function 行开始做括号计数，返回结束行（含）
  let depth = 0
  let started = false
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    for (const ch of line) {
      if (ch === '{') {
        depth++
        started = true
      } else if (ch === '}') depth--
    }
    if (started && depth === 0) return i
  }
  throw new Error('函数没有闭合：' + lines[start])
}

// 1) import
const runtimeImport = lines.findIndex((l) => l.includes("from './runtime.mjs'"))
if (runtimeImport < 0) throw new Error('找不到 runtime 导入')
if (!lines.some((l) => l.includes("from './sticker-store.mjs'"))) {
  lines.splice(runtimeImport + 1, 0, "import { createStickerStore } from './sticker-store.mjs'")
}

// 2) 用 store 替换 markStickersDirty + flushStickersNow
const mk = findFn('markStickersDirty')
const flush = findFn('flushStickersNow')
if (mk < 0 || flush < 0) throw new Error('找不到图库持久化函数')
const afterFlush = fnEnd(flush) + 1
lines.splice(mk, afterFlush - mk,
  '  // 图库持久化交给 lib/sticker-store.mjs（脏标记 + 3 秒合并写）',
  '  const stickerStore = createStickerStore({',
  '    stickers,',
  '    file: STICKERS_FILE,',
  '    config,',
  '    writeJson,',
  '    hashStr,',
  '    mediaKey,',
  '    log,',
  '  })',
  '  const { markStickersDirty, flushStickersNow, rememberSticker } = stickerStore',
)

// 3) 删除原 rememberSticker（括号计数）
const rs = findFn('rememberSticker')
if (rs < 0) throw new Error('找不到 rememberSticker')
const rsEnd = fnEnd(rs)
lines.splice(rs, rsEnd - rs + 1)

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('sticker-store 抽取完成，行数', lines.length)
