import { readFileSync, writeFileSync } from 'node:fs'

let L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)

function braceEnd(startLine, openIdx) {
  let depth = 0
  let inStr = null
  let inLine = false
  for (let i = startLine; i < L.length; i++) {
    const from = i === startLine ? openIdx : 0
    for (let k = from; k < L[i].length; k++) {
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
        if (depth === 0) return i
      }
    }
    inLine = false
  }
  throw new Error('没闭合')
}

// 抓 MOODS 对象 + MOOD_TTL_MS + setMood 函数
const mStart = L.findIndex((l) => l.trim().startsWith('const MOODS = {'))
if (mStart < 0) throw new Error('找不到 MOODS')
const mEnd = braceEnd(mStart, L[mStart].lastIndexOf('{'))
const moved = L.slice(mStart, mEnd + 1)
L.splice(mStart, mEnd - mStart + 1)

const ttlIdx = L.findIndex((l) => l.trim().startsWith('const MOOD_TTL_MS'))
if (ttlIdx >= 0) {
  moved.push('')
  moved.push(L[ttlIdx])
  L.splice(ttlIdx, 1)
}

const smIdx = L.findIndex((l) => l.includes('function setMood(r, name, intensity = 1)'))
if (smIdx >= 0) {
  const smEnd = braceEnd(smIdx, L[smIdx].lastIndexOf('{'))
  moved.push('')
  moved.push(...L.slice(smIdx, smEnd + 1))
  L.splice(smIdx, smEnd - smIdx + 1)
}

const anchor = L.findIndex((l) => l.includes('// 提示词拼装交给 lib/prompt.mjs'))
if (anchor < 0) throw new Error('找不到 prompt 锚点')
L.splice(anchor, 0, ...moved, '')

writeFileSync('lib/index.js', L.join('\n'), 'utf8')
console.log('MOODS/MOOD_TTL_MS/setMood 已前移')
