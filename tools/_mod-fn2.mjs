import { readFileSync, writeFileSync } from 'node:fs'

const L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const name = process.argv[2]
const modFile = process.argv[3]
const exportName = process.argv[4]
const depsArg = process.argv[5]
const deps = depsArg.split(',').map((s) => s.trim()).filter(Boolean)

function bodyStart(sig) {
  for (let i = sig; i < L.length; i++) {
    const idx = L[i].lastIndexOf('{')
    if (idx >= 0) return { line: i, col: idx }
  }
  throw new Error('找不到函数体')
}
function fnRange(fn) {
  const start = L.findIndex((l) => new RegExp('^  (async )?function ' + fn + '\\(').test(l))
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
  throw new Error(fn + ' 没闭合')
}

const [s, e] = fnRange(name)
const callDeps = deps.filter((d) => d !== name && d !== exportName)
const header = `/**
 * 自动抽取：${name}
 */
export const ${exportName.toUpperCase()}_DEPS = ${JSON.stringify(callDeps)}

export function ${exportName}(deps) {
  const missing = ${exportName.toUpperCase()}_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('${name} 缺少依赖：' + missing.join(', '))
  const { ${callDeps.join(', ')} } = deps

`
writeFileSync(modFile, header + L.slice(s, e + 1).join('\n') + '\n\n  return ' + name + '\n}\n', 'utf8')

const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const call = [
  `  // ${name} 交给 ${modFile}`,
  `  const ${name} = ${exportName}({`,
  ...chunk(callDeps, 5).map((g) => '    ' + g.join(', ') + ','),
  '  })',
]
L.splice(s, e - s + 1, ...call)

let out = L.join('\n')
if (!out.includes(`from './${modFile.split('/').pop()}'`)) {
  const a = out.indexOf("import { createOnEvent } from './on-event.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + `import { ${exportName} } from './${modFile.split('/').pop()}'\n` + out.slice(i)
}
writeFileSync('lib/index.js', out, 'utf8')
console.log(name, '抽取完成：', e - s + 1, '行，依赖', callDeps.length)
