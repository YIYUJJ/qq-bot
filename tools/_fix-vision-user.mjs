import { readFileSync, writeFileSync } from 'node:fs'

const modFile = 'lib/vision.mjs'
const depsName = 'VISION_DEPS'
let m = readFileSync(modFile, 'utf8')
let deps = JSON.parse(m.match(new RegExp(depsName + ' = (\\[[^\\]]*\\])'))[1])
if (!deps.includes('createUserMessage')) deps.push('createUserMessage')
deps.sort()
m = m.replace(new RegExp(depsName + ' = \\[[^\\]]*\\]'), depsName + ' = ' + JSON.stringify(deps))
m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
writeFileSync(modFile, m, 'utf8')

let s = readFileSync('lib/index.js', 'utf8')
const start = s.indexOf('const visionChain = createVisionChain({')
const end = s.indexOf('})', start)
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const names = deps.filter((d) => d !== 'getVisionBroken' && d !== 'setVisionBroken')
const call = 'const visionChain = createVisionChain({\n' + chunk(names, 5).map((g) => '    ' + g.join(', ') + ',').join('\n') + "\n    getVisionBroken: () => visionBroken,\n    setVisionBroken: (v) => { visionBroken = v },\n  })"
s = s.slice(0, start) + call + s.slice(end + 2)
writeFileSync('lib/index.js', s, 'utf8')
console.log('vision 补 createUserMessage')
