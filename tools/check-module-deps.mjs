/**
 * 依赖审计：模块里引用了 index.js 作用域中的名字，但既没在 *_DEPS 清单里、
 * 也没在模块内声明/import/参数解构里 → 大概率漏注入（运行到那条分支才炸）。
 *
 * 用法：node tools/check-module-deps.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'

const idx = readFileSync('lib/index.js', 'utf8')
const indexNames = new Set()
for (const m of idx.matchAll(/^  (?:async )?function ([A-Za-z_$][\w$]*)\(/gm)) indexNames.add(m[1])
for (const m of idx.matchAll(/^  (?:const|let) ([A-Za-z_$][\w$]*)\s*=/gm)) indexNames.add(m[1])
for (const m of idx.matchAll(/^  const \{([^}]+)\} =/gm)) for (const p of m[1].split(',')) indexNames.add(p.trim().split(':')[0].trim())
for (const m of idx.matchAll(/^import \{([^}]+)\} from/gm)) for (const p of m[1].split(',')) indexNames.add(p.trim().replace(/\s+as\s+.*/, ''))

const KW = new Set(
  'if else for of in return true false null undefined function async await try catch finally throw new typeof const let var switch case break default while do this import export delete void'.split(' '),
)

const strip = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/[^\n]*/gm, '')
    .replace(/`(?:[^`\\]|\\.)*`/g, '`x`')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')

const names = (list) => {
  const out = []
  for (const part of String(list).split(',')) {
    const n = part
      .replace(/[{}]/g, '')
      .replace(/^\.\.\./, '')
      .trim()
      .split(/[:=]/)[0]
      .trim()
    if (/^[A-Za-z_$][\w$]*$/.test(n)) out.push(n)
  }
  return out
}

export function auditFile(file) {
  const raw = readFileSync(file, 'utf8')
  const deps = new Set()
  const depsBlock = raw.match(/[A-Z_]+_DEPS = (\[[\s\S]*?\])/)
  if (depsBlock) for (const q of depsBlock[1].matchAll(/['"]([A-Za-z_$][\w$]*)['"]/g)) deps.add(q[1])

  const src = strip(raw)
  const known = new Set()
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) known.add(m[1])
  for (const m of src.matchAll(/\b(?:const|let|var)\s+\{([\s\S]*?)\}\s*=/g)) for (const n of names(m[1])) known.add(n)
  for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
    known.add(m[1])
    for (const n of names(m[2])) known.add(n)
  }
  for (const m of src.matchAll(/export function (\w+)\(\s*(\{[^}]*\}|\w+)/g)) {
    known.add(m[1])
    for (const n of names(m[2])) known.add(n)
  }
  for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g)) for (const n of names(m[1])) known.add(n)
  // 方法简写：decide(...) { / onEvent(cb) { —— 属于"声明"而不是引用
  for (const m of src.matchAll(/(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g)) {
    known.add(m[1])
    for (const n of names(m[2])) known.add(n)
  }
  for (const m of src.matchAll(/^import \{([^}]+)\}/gm)) for (const n of names(m[1])) known.add(n)

  const props = new Set([...src.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]))
  const tokens = new Set([...src.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
  return [...tokens].filter((t) => indexNames.has(t) && !deps.has(t) && !known.has(t) && !KW.has(t) && !props.has(t)).sort()
}

export function main() {
  // 这些文件里的告警属于类方法/文档注释，已人工确认不是漏注入
const KNOWN_SAFE = {
  'lib/onebot.mjs': ['OneBot'],
  'lib/outbox.mjs': ['Outbox', 'log'],
  'lib/policy.mjs': ['decide'],
}

const files = readdirSync('lib')
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('test-'))
    .map((f) => 'lib/' + f)
  let bad = 0
  for (const f of files) {
    const missing = auditFile(f)
    const safe = KNOWN_SAFE[f] || []
    const real = missing.filter((x) => !safe.includes(x))
    if (real.length) {
      bad += 1
      console.log('⚠️  ' + f + '：' + real.join(', '))
    }
  }
  if (!bad) console.log('✅ 依赖审计：没有未声明的注入名字')
  else console.log('共 ' + bad + ' 个文件可能漏依赖')
  process.exit(bad ? 1 : 0)
  
}
if (process.argv[1] && process.argv[1].endsWith('check-module-deps.mjs')) main()