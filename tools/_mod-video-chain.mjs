import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

function grabFn(name) {
  const start = L.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l))
  if (start < 0) throw new Error('找不到 ' + name)
  const bc = L[start].lastIndexOf('{')
  let depth = 0
  let inStr = null
  let inLine = false
  for (let i = start; i < L.length; i++) {
    const from = i === start ? bc : 0
    for (let k = from; k < L[i].length; k++) {
      const c = L[i][k]
      const n = L[i][k + 1]
      if (inLine) break
      if (inStr) {
        if (c === '\\') {
          k++
          continue
        }
        if (c === inStr) inStr = null
        continue
      }
      if (c === '/' && n === '/') {
        inLine = true
        break
      }
      if (c === "'" || c === '"' || c === '`') {
        inStr = c
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          const lines = L.slice(start, i + 1)
          L.splice(start, i - start + 1)
          return lines
        }
      }
    }
    inLine = false
  }
  throw new Error(name + ' 没闭合')
}

const videoKey = grabFn('videoKey')
const videoCacheGet = grabFn('videoCacheGet')
const videoCacheSet = grabFn('videoCacheSet')
const describeVideo = grabFn('describeVideo')

const deps = ['config', 'log', 'describeBuffer', 'ffmpegBin', 'ffprobeBin', 'VIDEO_DIR', 'hashStr', 'videoCache', 'VIDEO_CACHE_FILE', 'writeJson']
const header = `/**
 * 视频链路：describeVideo（抽帧拼图 + 视觉描述）+ 视频结果缓存。
 */
import { makeContactSheet, downloadTo, probeDuration } from './video.mjs'

export const VIDEO_CHAIN_DEPS = ${JSON.stringify(deps)}

export function createVideoChain(deps) {
  const missing = VIDEO_CHAIN_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('视频链路缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const footer = `
  return { describeVideo, videoKey, videoCacheGet, videoCacheSet }
}
`
writeFileSync('lib/video-chain.mjs', header + [videoKey, videoCacheGet, videoCacheSet, describeVideo].map((x) => x.join('\n')).join('\n\n') + footer, 'utf8')

const anchor = L.findIndex((l) => l.includes('// 视觉链路交给 lib/vision.mjs'))
if (anchor < 0) throw new Error('找不到 vision 锚点')
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
L.splice(anchor, 0,
  '  // 视频链路交给 lib/video-chain.mjs',
  '  const videoChain = createVideoChain({',
  ...chunk(deps, 5).map((g) => '    ' + g.join(', ') + ','),
  '  })',
  '  const { describeVideo, videoKey, videoCacheGet, videoCacheSet } = videoChain',
  '',
)

let out = L.join('\n')
if (!out.includes("from './video-chain.mjs'")) {
  const a = out.indexOf("import { createVisionChain } from './vision.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createVideoChain } from './video-chain.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('video-chain 抽取完成')
