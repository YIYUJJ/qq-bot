import { readFileSync } from 'node:fs'

const L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)

/** 找到函数体起始（签名行里最后一个 '{'，没有就往下找），返回 {line, col} */
function bodyStart(sigLineIndex) {
  for (let i = sigLineIndex; i < L.length; i++) {
    const idx = L[i].lastIndexOf('{')
    if (idx >= 0) return { line: i, col: idx }
  }
  throw new Error('找不到函数体')
}

function fnRange(name) {
  const start = L.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l))
  if (start < 0) throw new Error('找不到 ' + name)
  const { line: bl, col: bc } = bodyStart(start)
  let depth = 0
  let inStr = null
  let inLine = false
  for (let i = bl; i < L.length; i++) {
    const from = i === bl ? bc : 0
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
        if (depth === 0) return [start, i]
      }
    }
    inLine = false
  }
  throw new Error(name + ' 没闭合')
}

const name = process.argv[2]
const [s, e] = fnRange(name)
const body = L.slice(s, e + 1).join('\n')

const outer = new Set()
for (const line of L) {
  let m
  if ((m = line.match(/^  (?:async )?function ([A-Za-z_$][\w$]*)\(/))) outer.add(m[1])
  if ((m = line.match(/^  (?:const|let) ([A-Za-z_$][\w$]*)\s*=/))) outer.add(m[1])
  if ((m = line.match(/^  (?:const|let) \{([^}]+)\}\s*=/))) {
    for (const part of m[1].split(',')) {
      const n = part.split(':').pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(n)) outer.add(n)
    }
  }
}
const local = new Set()
for (const line of body.split('\n')) {
  let m
  if ((m = line.match(/^\s*(?:const|let|var) ([A-Za-z_$][\w$]*)\s*=/))) local.add(m[1])
  if ((m = line.match(/^\s*(?:const|let|var) \{([^}]+)\}\s*=/))) {
    for (const part of m[1].split(',')) {
      const n = part.split(':').pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(n)) local.add(n)
    }
  }
  if ((m = line.match(/^\s*for \(const ([A-Za-z_$][\w$]*)/))) local.add(m[1])
}
const tokens = new Set([...body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
const js = new Set('if else for of in return true false null undefined function async await try catch finally throw new typeof const let var switch case break default while do this import export new delete void'.split(' '))
const deps = [...tokens].filter((t) => outer.has(t) && !local.has(t) && !js.has(t)).sort()
console.log('函数', name, '行数', e - s + 1)
console.log('候选依赖', deps.length, ':', deps.join(', '))
