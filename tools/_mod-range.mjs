import { readFileSync, writeFileSync } from 'node:fs'

const startName = process.argv[2]
const endName = process.argv[3]
const modFile = process.argv[4]
const exportName = process.argv[5]
const depsArg = process.argv[6]
const deps = depsArg.split(',').map((s) => s.trim()).filter(Boolean)

const L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const findStart = (n) => L.findIndex((l) => new RegExp('^  (async )?function ' + n + '\\(').test(l))
const s = findStart(startName)
if (s < 0) throw new Error('找不到 ' + startName)
// 结束：endName 的下一个顶层函数定义前
const eNextFn = (() => {
  const startIdx = findStart(endName)
  if (startIdx < 0) throw new Error('找不到 ' + endName)
  for (let i = startIdx + 1; i < L.length; i++) {
    if (/^  (async )?function [A-Za-z0-9_]+\(/.test(L[i])) return i - 1
    if (/^  \/\/ ──/.test(L[i])) return i - 1
  }
  return L.length - 1
})()
const block = L.slice(s, eNextFn + 1)
const header = `/**
 * 长期记忆（模型侧）：提炼事实 / 翻旧账 / 群内关系。
 */
export const ${exportName.toUpperCase()}_DEPS = ${JSON.stringify(deps)}

export function ${exportName}(deps) {
  const missing = ${exportName.toUpperCase()}_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('记忆模型侧缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const footer = `
  return { ${block.filter((l) => /^  (async )?function /.test(l)).map((l) => l.trim().replace(/^(async )?function /, '').replace(/\(.*/, '')).join(', ')} }
}
`
writeFileSync(modFile, header + block.map((l) => (l.startsWith('  ') ? l : '  ' + l)).join('\n') + footer, 'utf8')

const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const call = [
  `  // 记忆模型侧交给 ${modFile}`,
  `  const memoryAi = ${exportName}({`,
  ...chunk(deps, 5).map((g) => '    ' + g.join(', ') + ','),
  '  })',
  '  const { extractFacts, searchMemory, updateRelations } = memoryAi',
  '',
]
L.splice(s, eNextFn - s + 1, ...call)
let out = L.join('\n')
if (!out.includes(`from './${modFile.split('/').pop()}'`)) {
  const a = out.indexOf("import { createMemoryStore } from './memory-store.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + `import { ${exportName} } from './${modFile.split('/').pop()}'\n` + out.slice(i)
}
writeFileSync('lib/index.js', out, 'utf8')
console.log('已抽取', startName, '..', endName, '共', block.length, '行')
