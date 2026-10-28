import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

function grab(name) {
  const s = L.findIndex((l) => new RegExp('^(  )(async )?function ' + name + '\\(').test(l))
  if (s < 0) return false
  let depth = 0
  let started = false
  let end = s
  for (let i = s; i < L.length; i++) {
    for (const ch of L[i]) {
      if (ch === '{') {
        depth++
        started = true
      } else if (ch === '}') depth--
    }
    if (started && depth === 0) {
      end = i
      break
    }
  }
  L.splice(s, end - s + 1)
  return true
}
for (const n of ['allowedHere', 'mustReply', 'assertGroupAllowed', 'isAllowedGroup']) console.log(n, grab(n))

const anchor = L.findIndex((l) => l.includes('// ── 运行时状态 ────────────────────────────────────────'))
if (anchor < 0) throw new Error('找不到运行时状态锚点')
L.splice(anchor, 0,
  '  // 访问控制（白名单闸）交给 lib/access.mjs',
  '  const access = createAccess({ config, getCfgFor: () => cfgFor })',
  '  const { isAllowedGroup, assertGroupAllowed, allowedHere, mustReply } = access',
  '',
)

let out = L.join('\n')
if (!out.includes("from './access.mjs'")) {
  const a = out.indexOf("import { createRoomConfig } from './room-config.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createAccess } from './access.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('access 抽取完成')
