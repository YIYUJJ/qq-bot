import { readFileSync, writeFileSync } from 'node:fs'

let idx = readFileSync('lib/index.js', 'utf8')

// 1) 抓当前 registerAllTools 调用里的名字
const start = idx.indexOf('registerAllTools(ctx, safeRegister, {')
const end = idx.indexOf('})', start)
const objText = idx.slice(start, end)
const names = [...objText.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0])
const skip = new Set(['registerAllTools', 'ctx', 'safeRegister'])
const raw = [...new Set(names)].filter((n) => !skip.has(n))

// 2) 只保留 index 里真实存在的
const defined = new Set()
for (const m of idx.matchAll(/^  (?:async )?function ([A-Za-z_$][\w$]*)\(/gm)) defined.add(m[1])
for (const m of idx.matchAll(/^  (?:const|let) ([A-Za-z_$][\w$]*)\s*=/gm)) defined.add(m[1])
for (const m of idx.matchAll(/^  const \{([^}]+)\} =/gm)) for (const p of m[1].split(',')) defined.add(p.trim().replace(/\s+as\s+.*/, ''))
for (const m of idx.matchAll(/^import \{([^}]+)\} from/gm)) for (const p of m[1].split(',')) defined.add(p.trim().replace(/\s+as\s+.*/, ''))
const kept = raw.filter((n) => defined.has(n))
const dropped = raw.filter((n) => !defined.has(n))

// 3) 重写 index 调用
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const call = [
  '  // 工具注册交给 lib/register-tools.mjs',
  '  registerAllTools(ctx, safeRegister, {',
  ...chunk(kept, 6).map((g) => '    ' + g.join(', ') + ','),
  '  })',
]
idx = idx.slice(0, start) + call.join('\n') + idx.slice(end + 2)
writeFileSync('lib/index.js', idx, 'utf8')

// 4) 重写模块
let mod = readFileSync('lib/register-tools.mjs', 'utf8')
mod = mod.replace(/\(\{ \.\.\.d,/g, '({')
mod = mod.replace(
  'export function registerAllTools(ctx, safeRegister, d) {\n',
  'export function registerAllTools(ctx, safeRegister, d) {\n  const { ' + kept.join(', ') + ' } = d\n',
)
writeFileSync('lib/register-tools.mjs', mod, 'utf8')
console.log('保留', kept.length, '项；丢弃', dropped.length, '项：', dropped.join(', '))
