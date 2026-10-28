import { readFileSync, writeFileSync } from 'node:fs'

const modFile = 'lib/memory-ai.mjs'
const depsName = 'CREATEMEMORYAI_DEPS'
const extra = ['isManagedRoom']

let m = readFileSync(modFile, 'utf8')
let deps = JSON.parse(m.match(new RegExp(depsName + ' = (\\[[^\\]]*\\])'))[1])
for (const e of extra) if (!deps.includes(e)) deps.push(e)
deps.sort()
m = m.replace(new RegExp(depsName + ' = \\[[^\\]]*\\]'), depsName + ' = ' + JSON.stringify(deps))
m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
writeFileSync(modFile, m, 'utf8')

let s = readFileSync('lib/index.js', 'utf8')
const start = s.indexOf('const memoryAi = createMemoryAi({')
const end = s.indexOf('})', start)
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const call = 'const memoryAi = createMemoryAi({\n' + chunk(deps, 5).map((g) => '    ' + g.join(', ') + ',').join('\n') + '\n  })'
s = s.slice(0, start) + call + s.slice(end + 2)
writeFileSync('lib/index.js', s, 'utf8')

// 测试依赖补上
let t = readFileSync('lib/test-memory-ai.mjs', 'utf8')
if (!t.includes('isManagedRoom:')) {
  t = t.replace("    keywordsOf: (t) => String(t).split(/\\s+/).filter(Boolean),", "    keywordsOf: (t) => String(t).split(/\\s+/).filter(Boolean),\n    isManagedRoom: () => true,")
  writeFileSync('lib/test-memory-ai.mjs', t, 'utf8')
}
console.log('memory-ai 补 isManagedRoom')
