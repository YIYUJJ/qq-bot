import { readFileSync, writeFileSync } from 'node:fs'

const modFile = 'lib/send-reply.mjs'
const depsName = 'CREATESENDREPLY_DEPS'
const extra = ['cleanReply', 'gapMs', 'shouldRetrySend', 'splitMessage']

let m = readFileSync(modFile, 'utf8')
let deps = JSON.parse(m.match(new RegExp(depsName + ' = (\\[[^\\]]*\\])'))[1])
for (const e of extra) if (!deps.includes(e)) deps.push(e)
deps = deps.filter((d) => d !== 'createSendReply' && d !== 'sendReply')
deps.sort()
m = m.replace(new RegExp(depsName + ' = \\[[^\\]]*\\]'), depsName + ' = ' + JSON.stringify(deps))
m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
writeFileSync(modFile, m, 'utf8')

let i = readFileSync('lib/index.js', 'utf8')
const start = i.indexOf('const sendReply = createSendReply({')
const end = i.indexOf('})', start)
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const call = 'const sendReply = createSendReply({\n' + chunk(deps, 5).map((g) => '    ' + g.join(', ') + ',').join('\n') + '\n  })'
i = i.slice(0, start) + call + i.slice(end + 2)
writeFileSync('lib/index.js', i, 'utf8')
console.log('send-reply 依赖补全：', deps.length, '项')
