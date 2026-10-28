import { readFileSync } from 'node:fs'

const name = process.argv[2]
if (!name) throw new Error('用法: node tools/_fn-deps.mjs <函数名>')
const L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const start = L.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l))
if (start < 0) throw new Error('找不到函数 ' + name)

// 括号计数
let depth = 0
let end = -1
let inStr = null
let inLine = false
for (let i = start; i < L.length && end < 0; i++) {
  for (let p = 0; p < L[i].length; p++) {
    const c = L[i][p]
    const n = L[i][p + 1]
    if (inLine) break
    if (inStr) {
      if (c === '\\') {
        p++
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
const body = L.slice(start, end + 1).join('\n')

const outer = new Set()
for (const line of L) {
  let m
  if ((m = line.match(/^  (?:async )?function ([A-Za-z_$][\w$]*)\(/))) outer.add(m[1])
  if ((m = line.match(/^  (?:const|let) ([A-Za-z_$][\w$]*)\s*=/))) outer.add(m[1])
  if ((m = line.match(/^  (?:const|let) \{([^}]+)\}\s*=/))) {
    for (const part of m[1].split(',')) {
      const nm = part.split(':').pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) outer.add(nm)
    }
  }
}
const local = new Set()
for (const line of body.split('\n')) {
  let m
  if ((m = line.match(/^\s*(?:const|let|var) ([A-Za-z_$][\w$]*)\s*=/))) local.add(m[1])
  if ((m = line.match(/^\s*(?:const|let|var) \{([^}]+)\}\s*=/))) {
    for (const part of m[1].split(',')) {
      const nm = part.split(':').pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) local.add(nm)
    }
  }
  if ((m = line.match(/^\s*for \(const ([A-Za-z_$][\w$]*)/))) local.add(m[1])
}
const tokens = new Set([...body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
const js = new Set('if else for of in return true false null undefined function async await try catch finally throw new typeof const let var switch case break default while do this import export'.split(' '))
const deps = [...tokens].filter((t) => outer.has(t) && !local.has(t) && !js.has(t)).sort()
console.log('函数', name, '行数', end - start + 1)
console.log('候选依赖', deps.length)
console.log(deps.join(' '))
