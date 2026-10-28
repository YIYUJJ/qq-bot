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

const systemPrompt = grabFn('systemPrompt')
const buildTranscript = grabFn('buildTranscript')
const inferMood = grabFn('inferMood')
const moodName = grabFn('moodName')

const deps = ['MOODS', 'MOOD_TTL_MS', 'config', 'cfgFor', 'getFeatures', 'isManagedRoom', 'memDirOf', 'pickFacts', 'roomTextOf', 'setMood']
const header = `/**
 * 提示词拼装：情绪（mood）、聊天记录转录、系统提示词（人设 + 记忆 + 画像 + 关系）。
 */
export const PROMPT_DEPS = ${JSON.stringify(deps)}

export function createPrompt(deps) {
  const missing = PROMPT_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('提示词模块缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const footer = `
  return { moodName, inferMood, buildTranscript, systemPrompt }
}
`
writeFileSync('lib/prompt.mjs', header + [moodName, inferMood, buildTranscript, systemPrompt].map((x) => x.join('\n')).join('\n\n') + footer, 'utf8')

const anchor = L.findIndex((l) => l.includes('// 回复决策交给 lib/decision.mjs'))
if (anchor < 0) throw new Error('找不到 decision 锚点')
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
L.splice(anchor, 0,
  '  // 提示词拼装交给 lib/prompt.mjs',
  '  const prompt = createPrompt({',
  ...chunk(deps, 5).map((g) => '    ' + g.join(', ') + ','),
  '  })',
  '  const { moodName, inferMood, buildTranscript, systemPrompt } = prompt',
  '',
)

let out = L.join('\n')
if (!out.includes("from './prompt.mjs'")) {
  const a = out.indexOf("import { createDecision } from './decision.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createPrompt } from './prompt.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('prompt 抽取完成')
