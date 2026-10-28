import { readFileSync } from 'node:fs'

const modFile = process.argv[2]
const depsName = process.argv[3]
const mod = readFileSync(modFile, 'utf8')
const idx = readFileSync('lib/index.js', 'utf8')
const deps = JSON.parse(mod.match(new RegExp(depsName + ' = (\\[[^\\]]*\\])'))[1])

const locals = new Set()
for (const m of mod.matchAll(/\b(?:const|let|var) ([A-Za-z_$][\w$]*)\s*=/g)) locals.add(m[1])
const outer = new Set()
for (const m of idx.matchAll(/^  (?:async )?function ([A-Za-z_$][\w$]*)\(/gm)) outer.add(m[1])
for (const m of idx.matchAll(/^  (?:const|let) ([A-Za-z_$][\w$]*)\s*=/gm)) outer.add(m[1])
for (const m of idx.matchAll(/^import \{([^}]+)\} from/gm)) {
  for (const part of m[1].split(',')) {
    const n = part.trim()
    if (/^[A-Za-z_$][\w$]*$/.test(n)) outer.add(n)
  }
}
const tokens = new Set([...mod.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
const kw = new Set('if else for of in return true false null undefined function async await try catch finally throw new typeof const let var switch case break default while do this import export new delete void'.split(' '))
const missing = [...tokens].filter((t) => !deps.includes(t) && !locals.has(t) && !kw.has(t) && outer.has(t)).sort()
console.log('缺失依赖:', missing.join(', ') || '(无)')
