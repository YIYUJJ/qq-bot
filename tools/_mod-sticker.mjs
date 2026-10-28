import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

// 1) import
const runtimeImport = lines.findIndex((l) => l.includes("from './runtime.mjs'"))
if (runtimeImport < 0) throw new Error('找不到 runtime 导入')
lines.splice(runtimeImport + 1, 0, "import { createStickerStore } from './sticker-store.mjs'")

// 2) 用 store 替换 markStickersDirty / flushStickersNow / rememberSticker
const mkStart = lines.findIndex((l) => l.includes('function markStickersDirty()'))
if (mkStart < 0) throw new Error('找不到 markStickersDirty')
const mkEnd = lines.findIndex((l, i) => i > mkStart && l.includes('const usage = readJson(USAGE_FILE'))
if (mkEnd < 0) throw new Error('找不到 flush 结束')
lines.splice(mkStart, mkEnd - mkStart,
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
  '',
)

// 3) 删除原 rememberSticker 实现（现在在模块里）
const rsStart = lines.findIndex((l) => l.includes('function rememberSticker(url, from, subType)'))
if (rsStart < 0) throw new Error('找不到 rememberSticker')
let rsEnd = rsStart
while (rsEnd < lines.length && lines[rsEnd].trim() !== '}') rsEnd++
lines.splice(rsStart, rsEnd - rsStart + 2)

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('index.js: 图库持久化抽到 sticker-store.mjs')
