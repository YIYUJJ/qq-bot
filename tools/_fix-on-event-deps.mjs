import { readFileSync, writeFileSync } from 'node:fs'

const moduleFile = 'lib/on-event.mjs'
const exportName = 'createOnEvent'
const fnName = 'onEvent'

let s = readFileSync('lib/index.js', 'utf8')
if (!s.includes("from './on-event.mjs'")) {
  const anchor = s.indexOf("import { createFlush } from './flush.mjs'")
  const i = s.indexOf('\n', anchor) + 1
  s = s.slice(0, i) + "import { createOnEvent } from './on-event.mjs'\n" + s.slice(i)
  writeFileSync('lib/index.js', s, 'utf8')
  console.log('import 已补')
}

// 比较模块里用到的、index 里存在的名字，补齐依赖
const mod = readFileSync(moduleFile, 'utf8')
const idx = readFileSync('lib/index.js', 'utf8')
const depName = exportName.toUpperCase() + '_DEPS'
const deps = JSON.parse(mod.match(new RegExp(depName + ' = (\\[[^\\]]*\\])'))[1])

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

if (missing.length) {
  for (const name of missing) deps.push(name)
  deps.sort()
  let m = mod.replace(new RegExp(depName + ' = \\[[^\\]]*\\]'), depName + ' = ' + JSON.stringify(deps))
  m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
  writeFileSync(moduleFile, m, 'utf8')

  let i = readFileSync('lib/index.js', 'utf8')
  const start = i.indexOf('const onEvent = createOnEvent({')
  const end = i.indexOf('})', start)
  const chunk = (list, size) => {
    const out = []
    for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
    return out
  }
  const call = 'const onEvent = createOnEvent({\n' + chunk(deps, 5).map((g) => '    ' + g.join(', ') + ',').join('\n') + '\n  })'
  i = i.slice(0, start) + call + i.slice(end + 2)
  writeFileSync('lib/index.js', i, 'utf8')
  console.log('已补齐并更新 index 工厂参数')
}
