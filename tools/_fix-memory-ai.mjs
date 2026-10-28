import { readFileSync, writeFileSync } from 'node:fs'

const modFile = 'lib/memory-ai.mjs'
const depsName = 'CREATEMEMORYAI_DEPS'
const extra = ['analyze', 'buildRelationGraph', 'graphPath', 'normalizeEvent', 'ob', 'patchMeta', 'relationsPath', 'writeJson', 'writeTextSafe']

let m = readFileSync(modFile, 'utf8')
let deps = JSON.parse(m.match(new RegExp(depsName + ' = (\\[[^\\]]*\\])'))[1])
for (const e of extra) if (!deps.includes(e)) deps.push(e)
deps = deps.filter((d) => d !== 'createMemoryAi')
deps.sort()
m = m.replace(new RegExp(depsName + ' = \\[[^\\]]*\\]'), depsName + ' = ' + JSON.stringify(deps))
m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
writeFileSync(modFile, m, 'utf8')

let s = readFileSync('lib/index.js', 'utf8')
// 更新工厂参数
const start = s.indexOf('const memoryAi = createMemoryAi({')
const end = s.indexOf('})', start)
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const call = 'const memoryAi = createMemoryAi({\n' + chunk(deps, 5).map((g) => '    ' + g.join(', ') + ',').join('\n') + '\n  })'
s = s.slice(0, start) + call + s.slice(end + 2)

// 把整块（注释 + 工厂 + 解构）移到 memory-auto 之前
const marker = '  // 记忆模型侧交给 lib/memory-ai.mjs'
const blockStart = s.indexOf(marker)
const destructureEnd = s.indexOf('\n', s.indexOf('const { extractFacts, searchMemory, updateRelations } = memoryAi', blockStart))
let blockEnd = s.indexOf('\n', destructureEnd + 1)
const block = s.slice(blockStart, blockEnd + 1)
s = s.slice(0, blockStart) + s.slice(blockEnd + 1)
const anchor = s.indexOf('  // maybeAutoExtract 交给 lib/memory-auto.mjs')
s = s.slice(0, anchor) + block + '\n' + s.slice(anchor)
writeFileSync('lib/index.js', s, 'utf8')
console.log('memory-ai 依赖补全并前移')
