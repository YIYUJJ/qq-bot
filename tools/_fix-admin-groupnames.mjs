import { readFileSync, writeFileSync } from 'node:fs'

let m = readFileSync('lib/admin-flow.mjs', 'utf8')
const depsName = 'ADMIN_FLOW_DEPS'
let deps = JSON.parse(m.match(new RegExp(depsName + ' = (\\[[^\\]]*\\])'))[1])
if (!deps.includes('groupNames')) {
  deps.push('groupNames')
  deps.sort()
  m = m.replace(new RegExp(depsName + ' = \\[[^\\]]*\\]'), depsName + ' = ' + JSON.stringify(deps))
  m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
  writeFileSync('lib/admin-flow.mjs', m, 'utf8')
  console.log('admin-flow 补 groupNames')
}

let s = readFileSync('lib/index.js', 'utf8')
const start = s.indexOf('const adminFlow = createAdminFlow({')
const end = s.indexOf('})', start)
if (start > 0) {
  const chunk = (list, size) => {
    const out = []
    for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
    return out
  }
  const call = 'const adminFlow = createAdminFlow({\n' + chunk(deps, 5).map((g) => '    ' + g.join(', ') + ',').join('\n') + '\n  })'
  s = s.slice(0, start) + call + s.slice(end + 2)
  writeFileSync('lib/index.js', s, 'utf8')
  console.log('index adminFlow 参数已更新')
}
