import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const L = readFileSync(p, 'utf8').split(/\r?\n/)

const start = L.findIndex((l) => l.includes('function priorityOf(msg, r)'))
if (start < 0) throw new Error('找不到 priorityOf')
// 结束：decide 函数结束
const di = L.findIndex((l) => l.includes('function decide(r, {'))
if (di < 0) throw new Error('找不到 decide')
const bc = L[di].lastIndexOf('{')
let depth = 0
let inStr = null
let inLine = false
let end = -1
for (let i = di; i < L.length && end < 0; i++) {
  const from = i === di ? bc : 0
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
        end = i
        break
      }
    }
  }
  inLine = false
}
if (end < 0) throw new Error('decide 没闭合')
const block = L.slice(start, end + 1)

const deps = ['config', 'cfgFor']
const header = `/**
 * 回复决策：优先级（@/叫名字/对话延续）→ 静音/必回/安静时段/防重复/冷却/概率。
 *
 * 纯逻辑 + 每群配置，不碰网络；测试可以完整覆盖。
 */
import { detectTrigger } from './policy.mjs'

export const DECISION_DEPS = ${JSON.stringify(deps)}

export function createDecision(deps) {
  const missing = DECISION_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('决策模块缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const footer = `
  return { priorityOf, normText, decide }
}
`
writeFileSync('lib/decision.mjs', header + block.join('\n') + footer, 'utf8')

L.splice(start, end - start + 1,
  '  // 回复决策交给 lib/decision.mjs',
  '  const decision = createDecision({ config, cfgFor })',
  '  const { priorityOf, normText, decide } = decision',
  '',
)
let out = L.join('\n')
if (!out.includes("from './decision.mjs'")) {
  const a = out.indexOf("import { createNotes } from './notes.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createDecision } from './decision.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('decision 抽取完成：', block.length, '行')
