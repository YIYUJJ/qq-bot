import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

// 1) 删掉识图缓存 + key/MIME 助手块（从注释到 guessMediaType 结束）
const start = L.findIndex((l) => l.includes('// ── 识图（图片 / 表情包）'))
if (start < 0) throw new Error('找不到识图块')
const guessIdx = L.findIndex((l, i) => i > start && l.includes('function guessMediaType(res, url)'))
if (guessIdx < 0) throw new Error('找不到 guessMediaType')
let end = guessIdx
let depth = 0
let started = false
for (let i = guessIdx; i < L.length; i++) {
  for (const ch of L[i]) {
    if (ch === '{') {
      depth++
      started = true
    } else if (ch === '}') depth--
  }
  if (started && depth === 0) {
    end = i
    break
  }
}

const block = [
  '  // 识图缓存 / 媒体 key 交给 lib/media-cache.mjs',
  '  const media = createMediaCache({ DATA_DIR, config, log, readJson, writeJson })',
  '  const { vision, visionCache, visionKey, trimVisionCache, mediaKey, guessMediaType } = media',
]
L.splice(start, end - start + 1, ...block)

let s = L.join('\n')
if (!s.includes("from './media-cache.mjs'")) {
  const a = s.indexOf("import { createRoomConfig } from './room-config.mjs'")
  const i = s.indexOf('\n', a) + 1
  s = s.slice(0, i) + "import { createMediaCache } from './media-cache.mjs'\n" + s.slice(i)
}
writeFileSync(p, s, 'utf8')
console.log('media-cache 抽取完成')
