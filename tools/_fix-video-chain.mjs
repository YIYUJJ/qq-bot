import { readFileSync, writeFileSync } from 'node:fs'

// 1) 模块补 import
let m = readFileSync('lib/video-chain.mjs', 'utf8')
const imports = [
  "import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'",
  "import { join } from 'node:path'",
  "import { fileURLToPath } from 'node:url'",
]
for (const line of imports) {
  if (!m.includes(line)) {
    const idx = m.indexOf('import { makeContactSheet')
    m = m.slice(0, idx) + line + '\n' + m.slice(idx)
  }
}
writeFileSync('lib/video-chain.mjs', m, 'utf8')

// 2) index 中把 videoChain 初始化移到 visionChain 之后
let s = readFileSync('lib/index.js', 'utf8')
const marker = '  // 视频链路交给 lib/video-chain.mjs'
const start = s.indexOf(marker)
if (start < 0) throw new Error('找不到 videoChain 块')
const destr = s.indexOf('const { describeVideo, videoKey, videoCacheGet, videoCacheSet } = videoChain', start)
const end = s.indexOf('\n', destr) + 1
const block = s.slice(start, end)
s = s.slice(0, start) + s.slice(end)

const visionEnd = s.indexOf('const { generateVision, describeBuffer, describeImage, attachVision } = visionChain')
const insertAt = s.indexOf('\n', visionEnd) + 1
s = s.slice(0, insertAt) + '\n' + block + s.slice(insertAt)
writeFileSync('lib/index.js', s, 'utf8')
console.log('videoChain 已移到 visionChain 之后')
