import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

// 删除 VIDEO_DIR 定义 + 清理块 + ffmpegBin/ffprobeBin
const start = L.findIndex((l) => l.includes("const VIDEO_DIR = join(DATA_DIR, 'video-tmp')"))
if (start < 0) throw new Error('找不到 VIDEO_DIR')
const probeIdx = L.findIndex((l, i) => i > start && l.includes('function ffprobeBin()'))
if (probeIdx < 0) throw new Error('找不到 ffprobeBin')
let depth = 0
let started = false
let end = probeIdx
for (let i = probeIdx; i < L.length; i++) {
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
  '  // 视频临时目录 / ffmpeg 路径交给 lib/video-files.mjs',
  '  const videoFiles = createVideoFiles({ DATA_DIR, config, log })',
  '  const { VIDEO_DIR, ffmpegBin, ffprobeBin } = videoFiles',
]
L.splice(start, end - start + 1, ...block)

let out = L.join('\n')
if (!out.includes("from './video-files.mjs'")) {
  const a = out.indexOf("import { createVideoChain } from './video-chain.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createVideoFiles } from './video-files.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('video-files 抽取完成')
