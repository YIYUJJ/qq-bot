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

const attachVision = grabFn('attachVision')
const describeImage = grabFn('describeImage')
const describeBuffer = grabFn('describeBuffer')
const generateVision = grabFn('generateVision')

const deps = ['config', 'llm', 'log', 'noteUsage', 'resolveVisionRoute', 'track', 'untrack', 'usage', 'visionKey', 'trimVisionCache', 'visionCache', 'getVisionBroken', 'setVisionBroken', 'guessMediaType']
const header = `/**
 * 视觉链路：generateVision / describeBuffer / describeImage / attachVision。
 *
 * visionBroken（同类失败只记一次日志）通过 get/set 显式读写，避免隐式全局。
 */
import { shrinkImage } from './extras.mjs'

export const VISION_DEPS = ${JSON.stringify(deps)}

export function createVisionChain(deps) {
  const missing = VISION_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('视觉链路缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const body = [...generateVision, '', ...describeBuffer, '', ...describeImage, '', ...attachVision]
const footer = `
  return { generateVision, describeBuffer, describeImage, attachVision }
}
`
// 修正函数体内的 visionBroken 读写
const bodyText = body.join('\n').replace(/\bvisionBroken = /g, 'setVisionBroken(').replace(/if \(visionBroken !== msg\)/g, 'if (getVisionBroken() !== msg)')
writeFileSync('lib/vision.mjs', header + bodyText + footer, 'utf8')

// index: 插入工厂（放在 vision cache 之后、onEvent 之前）
const anchor = L.findIndex((l) => l.includes('// onEvent 交给 lib/on-event.mjs'))
if (anchor < 0) throw new Error('找不到 onEvent 锚点')
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
L.splice(anchor, 0,
  '  // 视觉链路交给 lib/vision.mjs',
  '  const visionChain = createVisionChain({',
  ...chunk(deps.filter((d) => d !== 'getVisionBroken' && d !== 'setVisionBroken'), 5).map((g) => '    ' + g.join(', ') + ','),
  "    getVisionBroken: () => visionBroken,",
  "    setVisionBroken: (v) => { visionBroken = v },",
  '  })',
  '  const { generateVision, describeBuffer, describeImage, attachVision } = visionChain',
  '',
)

let out = L.join('\n')
if (!out.includes("from './vision.mjs'")) {
  const a = out.indexOf("import { createNotes } from './notes.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createVisionChain } from './vision.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('vision 抽取完成')
