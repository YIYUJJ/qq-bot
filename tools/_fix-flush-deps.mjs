import { readFileSync, writeFileSync } from 'node:fs'

const extra = ['humanizeText', 'isQuiet', 'pickCanned', 'pickVideoLinks', 'pickWebLink', 'rmSync']

let m = readFileSync('lib/flush.mjs', 'utf8')
const deps = JSON.parse(m.match(/FLUSH_DEPS = (\[[^\]]*\])/)[1])
for (const name of extra) if (!deps.includes(name)) deps.push(name)
deps.sort()
m = m.replace(/FLUSH_DEPS = \[[^\]]*\]/, 'FLUSH_DEPS = ' + JSON.stringify(deps))
m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
writeFileSync('lib/flush.mjs', m, 'utf8')

let i = readFileSync('lib/index.js', 'utf8')
const start = i.indexOf('const flush = createFlush({')
const end = i.indexOf('})', start)
if (start < 0 || end < 0) throw new Error('找不到 createFlush 调用')
const call = 'const flush = createFlush({\n' + chunk(deps, 5).map((g) => '    ' + g.join(', ') + ',').join('\n') + '\n  })'
i = i.slice(0, start) + call + i.slice(end + 2)
writeFileSync('lib/index.js', i, 'utf8')

function chunk(list, size) {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
console.log('flush 依赖补全：', extra.join(', '))
