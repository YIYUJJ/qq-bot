import { readFileSync, writeFileSync } from 'node:fs'

const modFile = 'lib/memory-ai.mjs'
const depsName = 'CREATEMEMORYAI_DEPS'
const imports = [
  "import { existsSync, mkdirSync, readFileSync } from 'node:fs'",
  "import { join } from 'node:path'",
  "import { profilePath, summaryPath, roomSlug, readRoomText } from './memory.mjs'",
]
const remove = ['existsSync', 'join', 'mkdirSync', 'profilePath', 'readFileSync', 'readRoomText', 'roomSlug', 'summaryPath']
const add = ['DATA_DIR', 'whoHint']

let m = readFileSync(modFile, 'utf8')
let deps = JSON.parse(m.match(new RegExp(depsName + ' = (\\[[^\\]]*\\])'))[1])
deps = deps.filter((d) => !remove.includes(d) && d !== 'createMemoryAi')
for (const a of add) if (!deps.includes(a)) deps.push(a)
deps.sort()
for (const line of imports) if (!m.includes(line)) {
  const idx = m.indexOf('export const')
  m = m.slice(0, idx) + line + '\n' + m.slice(idx)
}
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
console.log('memory-ai 依赖整理完成')
