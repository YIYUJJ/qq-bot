import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/index.js', 'utf8')
const marker = '  // 表情包网络链路交给 lib/sticker-net.mjs'
const start = s.indexOf(marker)
if (start < 0) throw new Error('找不到 stickerNet 块')
const destr = s.indexOf('const { ensureStickerFile, favoriteSticker, sendStickerTo, sweepStickerLibrary } = stickerNet', start)
const end = s.indexOf('\n', destr) + 1
const block = s.slice(start, end)
s = s.slice(0, start) + s.slice(end)

const anchor = s.indexOf('const { describeVideo, videoKey, videoCacheGet, videoCacheSet } = videoChain')
const insertAt = s.indexOf('\n', anchor) + 1
s = s.slice(0, insertAt) + '\n' + block + s.slice(insertAt)
writeFileSync('lib/index.js', s, 'utf8')
console.log('stickerNet 已移到 videoChain 之后')
