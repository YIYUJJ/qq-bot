import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
const L = raw.split(/\r?\n/)

const start = L.findIndex((l) => /^  async function selfcheck\(/.test(l))
if (start < 0) throw new Error('找不到 selfcheck')
let depth = 0
let end = -1
let inStr = null
let inLine = false
for (let i = start; i < L.length && end < 0; i++) {
  for (let k = 0; k < L[i].length; k++) {
    const c = L[i][k]
    const n = L[i][k + 1]
    if (inLine) break
    if (inStr) {
      if (c === '\\') {
        k++
        continue
      }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '/' && n === '/') {
      inLine = true
      break
    }
    if (c === "'" || c === '"' || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  inLine = false
}
if (end < 0) throw new Error('没闭合')

const call = [
  '  // 自检交给 lib/selfcheck.mjs（healthCache 通过 getHealth/setHealth 显式读写）',
  '  const selfcheck = createSelfcheck({',
  "    ob, config, groupNames, resolveModel, getLlm: () => ctx.get?.('llm'), logFile: LOG_FILE,",
  '    getHealth: () => healthCache,',
  '    setHealth: (h) => { healthCache = h },',
  '  })',
]
L.splice(start, end - start + 1, ...call)
writeFileSync(p, L.join(crlf ? '\r\n' : '\n'), 'utf8')

let s2 = readFileSync(p, 'utf8')
const anchor = s2.indexOf("import { createRoomSnapshot } from './room-snapshot.mjs'")
const insertAt = s2.indexOf('\n', anchor) + 1
s2 = s2.slice(0, insertAt) + "import { createSelfcheck } from './selfcheck.mjs'\n" + s2.slice(insertAt)
writeFileSync(p, s2, 'utf8')
console.log('selfcheck 抽取完成')
