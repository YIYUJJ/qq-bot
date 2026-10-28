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

const ensureStickerFile = grabFn('ensureStickerFile')
const sweepStickerLibrary = grabFn('sweepStickerLibrary')
const favoriteSticker = grabFn('favoriteSticker')
const sendStickerTo = grabFn('sendStickerTo')

const deps = ['config', 'log', 'ob', 'roomState', 'sendWithRetry', 'sleep', 'stats', 'stickers', 'STICKER_DIR', 'hashStr', 'mediaKey', 'markStickersDirty']
const header = `/**
 * 表情包网络链路：本地化（下载到本地）、收进 QQ 收藏、按图库 id 发送、图库维护。
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const STICKER_NET_DEPS = ${JSON.stringify(deps)}

export function createStickerNet(deps) {
  const missing = STICKER_NET_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('表情链路缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const footer = `
  return { ensureStickerFile, favoriteSticker, sendStickerTo, sweepStickerLibrary }
}
`
writeFileSync('lib/sticker-net.mjs', header + [ensureStickerFile, favoriteSticker, sendStickerTo, sweepStickerLibrary].map((x) => x.join('\n')).join('\n\n') + footer, 'utf8')

const anchor = L.findIndex((l) => l.includes('// 图库持久化交给 lib/sticker-store.mjs'))
if (anchor < 0) throw new Error('找不到 sticker-store 锚点')
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
L.splice(anchor, 0,
  '  // 表情包网络链路交给 lib/sticker-net.mjs',
  '  const stickerNet = createStickerNet({',
  ...chunk(deps, 5).map((g) => '    ' + g.join(', ') + ','),
  '  })',
  '  const { ensureStickerFile, favoriteSticker, sendStickerTo, sweepStickerLibrary } = stickerNet',
  '',
)

let out = L.join('\n')
if (!out.includes("from './sticker-net.mjs'")) {
  const a = out.indexOf("import { createNotes } from './notes.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createStickerNet } from './sticker-net.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('sticker-net 抽取完成')
