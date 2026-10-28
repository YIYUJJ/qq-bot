import { readFileSync, writeFileSync } from 'node:fs'

const modFile = 'lib/admin-flow.mjs'
const depsName = 'ADMIN_FLOW_DEPS'
let m = readFileSync(modFile, 'utf8')
let deps = JSON.parse(m.match(new RegExp(depsName + ' = (\\[[^\\]]*\\])'))[1])
if (!deps.includes('isAllowedGroup')) deps.push('isAllowedGroup')
deps.sort()
m = m.replace(new RegExp(depsName + ' = \\[[^\\]]*\\]'), depsName + ' = ' + JSON.stringify(deps))
m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
writeFileSync(modFile, m, 'utf8')

let s = readFileSync('lib/index.js', 'utf8')
const start = s.indexOf('const adminFlow = createAdminFlow({')
const end = s.indexOf('})', start)
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const call = 'const adminFlow = createAdminFlow({\n' + chunk(deps, 5).map((g) => '    ' + g.join(', ') + ',').join('\n') + '\n  })'
s = s.slice(0, start) + call + s.slice(end + 2)
writeFileSync('lib/index.js', s, 'utf8')
console.log('admin-flow 补 isAllowedGroup')
