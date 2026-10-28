import { readFileSync, writeFileSync } from 'node:fs'

const modFile = 'lib/model.mjs'
const depsName = 'MODEL_DEPS'
const extra = ['createUserMessage']

let m = readFileSync(modFile, 'utf8')
let deps = JSON.parse(m.match(new RegExp(depsName + ' = (\\[[^\\]]*\\])'))[1])
for (const e of extra) if (!deps.includes(e)) deps.push(e)
deps = deps.filter((d) => d !== 'createModel')
deps.sort()
m = m.replace(new RegExp(depsName + ' = \\[[^\\]]*\\]'), depsName + ' = ' + JSON.stringify(deps))
m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
writeFileSync(modFile, m, 'utf8')

let s = readFileSync('lib/index.js', 'utf8')
const start = s.indexOf('const model = createModel({')
const end = s.indexOf('})', start)
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const call = 'const model = createModel({\n' + chunk(deps.filter((d) => d !== 'HIST_STOP'), 5).map((g) => '    ' + g.join(', ') + ',').join('\n') + '\n    HIST_STOP,\n  })'
s = s.slice(0, start) + call + s.slice(end + 2)
writeFileSync('lib/index.js', s, 'utf8')
console.log('model 补 createUserMessage')
