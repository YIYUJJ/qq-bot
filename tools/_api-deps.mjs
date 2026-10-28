import { readFileSync } from 'node:fs'

const L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const start = L.findIndex((l) => l.includes('async function handleRequest('))
let end = L.length
for (let i = start + 1; i < L.length; i++) {
  if (L[i].startsWith('  async function ') || L[i].startsWith('  ctx.effect(')) {
    end = i
    break
  }
}
const body = L.slice(start, end).join('\n')

// 外层作用域里定义的名字
const outer = new Set()
for (const line of L) {
  let m
  if ((m = line.match(/^  (?:async )?function ([A-Za-z_$][\w$]*)\(/))) outer.add(m[1])
  if ((m = line.match(/^  (?:const|let) ([A-Za-z_$][\w$]*)\s*=/))) outer.add(m[1])
  if ((m = line.match(/^  (?:const|let) \{([^}]+)\}\s*=/))) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) outer.add(name)
    }
  }
  if ((m = line.match(/^  (?:const|let) \[([^\]]+)\]\s*=/))) {
    for (const part of m[1].split(',')) {
      const name = part.trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) outer.add(name)
    }
  }
}

// handler 内自己声明的局部名
const local = new Set()
for (const line of body.split('\n')) {
  let m
  if ((m = line.match(/^\s*(?:const|let|var) ([A-Za-z_$][\w$]*)\s*=/))) local.add(m[1])
  if ((m = line.match(/^\s*(?:const|let|var) \{([^}]+)\}\s*=/))) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim()
      if (/^[A-Za-z_$][\w$]*$/.test(name)) local.add(name)
    }
  }
  if ((m = line.match(/^\s*for \(const ([A-Za-z_$][\w$]*)/))) local.add(m[1])
  if ((m = line.match(/^\s*(?:async )?function ([A-Za-z_$][\w$]*)\(/))) local.add(m[1])
  if ((m = line.match(/^\s*try \{\s*$/) )) local.add('__noop__')
}

const tokens = new Set([...body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
const jsBuiltins = new Set(['if', 'else', 'for', 'of', 'in', 'return', 'true', 'false', 'null', 'undefined', 'function', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'new', 'typeof', 'const', 'let', 'var', 'switch', 'case', 'break', 'default', 'while', 'do', 'delete', 'void', 'this', 'class', 'extends', 'super', 'import', 'export', 'yield', 'instanceof'])
const deps = [...tokens].filter((t) => outer.has(t) && !local.has(t) && !jsBuiltins.has(t)).sort()
console.log('body 行数', end - start)
console.log('候选依赖', deps.length)
console.log(deps.join(', '))
