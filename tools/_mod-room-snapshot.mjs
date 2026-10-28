import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
const L = raw.split(/\r?\n/)

const start = L.findIndex((l) => /^  function roomSnapshot\(/.test(l))
if (start < 0) throw new Error('找不到 roomSnapshot')
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
  '  // 房间快照交给 lib/room-snapshot.mjs',
  '  const roomSnapshot = createRoomSnapshot({',
  '    factsOf, countOverrides, roomOverrideOf, allowedHere, cfgFor, config, panelRoomCache,',
  '  })',
]
L.splice(start, end - start + 1, ...call)
writeFileSync(p, L.join(crlf ? '\r\n' : '\n'), 'utf8')

let s2 = readFileSync(p, 'utf8')
const anchor = s2.indexOf("import { createPanelState } from './panel-state.mjs'")
const insertAt = s2.indexOf('\n', anchor) + 1
s2 = s2.slice(0, insertAt) + "import { createRoomSnapshot } from './room-snapshot.mjs'\n" + s2.slice(insertAt)
writeFileSync(p, s2, 'utf8')
console.log('roomSnapshot 抽取完成')
