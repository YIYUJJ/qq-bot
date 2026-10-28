import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const L = readFileSync(p, 'utf8').split(/\r?\n/)

function findFn(name) {
  return L.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l))
}
function bodyStart(sig) {
  for (let i = sig; i < L.length; i++) {
    const idx = L[i].lastIndexOf('{')
    if (idx >= 0) return { line: i, col: idx }
  }
  throw new Error('找不到函数体')
}
function fnRange(name) {
  const start = findFn(name)
  if (start < 0) throw new Error('找不到 ' + name)
  const { line: bl, col: bc } = bodyStart(start)
  let depth = 0
  let inStr = null
  let inLine = false
  for (let i = bl; i < L.length; i++) {
    const from = i === bl ? bc : 0
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
        if (depth === 0) return [start, i]
      }
    }
    inLine = false
  }
  throw new Error(name + ' 没闭合')
}

const names = ['generate', 'analyze', 'keywordsOf', 'whoHint']
const parts = []
for (const n of names) {
  const [s, e] = fnRange(n)
  parts.push({ name: n, start: s, end: e, lines: L.slice(s, e + 1) })
}
parts.sort((a, b) => b.start - a.start)
for (const part of parts) L.splice(part.start, part.end - part.start + 1)

const deps = ['config', 'llm', 'log', 'metrics', 'noteUsage', 'resolveModel', 'stats', 'track', 'untrack', 'HIST_STOP']
const header = `/**
 * 模型调用封装：generate / analyze（结构化分析）/ 关键词与人名提示。
 */
export const MODEL_DEPS = ${JSON.stringify(deps)}

export function createModel(deps) {
  const missing = MODEL_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('模型模块缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const ordered = ['generate', 'analyze', 'keywordsOf', 'whoHint'].map((n) => parts.find((x) => x.name === n))
const bodyText = ordered.map((x) => x.lines.join('\n')).join('\n\n')
const footer = `

  return { generate, analyze, keywordsOf, whoHint }
}
`
writeFileSync('lib/model.mjs', header + bodyText + footer, 'utf8')

// 插工厂：在 const llm = ... 之后
const llmLine = L.findIndex((l) => l.includes('const llm = (testHooks && testHooks.llm)'))
if (llmLine < 0) throw new Error('找不到 llm 定义')
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const call = [
  '  // 模型调用封装交给 lib/model.mjs',
  '  const model = createModel({',
  ...chunk(deps.filter((d) => d !== 'llm' && d !== 'HIST_STOP'), 5).map((g) => '    ' + g.join(', ') + ','),
  '    llm, HIST_STOP,',
  '  })',
  '  const { generate, analyze, keywordsOf, whoHint } = model',
  '',
]
L.splice(llmLine + 1, 0, ...call)

let out = L.join('\n')
if (!out.includes("from './model.mjs'")) {
  const a = out.indexOf("import { createMemoryAi } from './memory-ai.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createModel } from './model.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('model 抽取完成：', parts.reduce((n, x) => n + x.lines.length, 0), '行')
