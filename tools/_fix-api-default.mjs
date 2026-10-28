import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/http-api.mjs'
const L = readFileSync(p, 'utf8').split(/\r?\n/)
const s = L.findIndex((l) => l.includes('switch (op) {'))
if (s < 0) throw new Error('找不到 switch')
let depth = 0
let end = -1
for (let i = s; i < L.length; i++) {
  for (const ch of L[i]) {
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end >= 0) break
}
if (end < 0) throw new Error('switch 没闭合')
// 找到 switch 内最后一个非空行，在其后插入 default
let insertAt = end
for (let i = end - 1; i > s; i--) {
  if (L[i].trim()) {
    insertAt = i + 1
    break
  }
}
const indent = '            '
L.splice(insertAt, 0,
  indent + 'default:',
  indent + '  return json(res, 404, { ok: false, error: "未知操作：" + op })',
)
writeFileSync(p, L.join('\n'), 'utf8')
console.log('已给 switch 加 default 404')
