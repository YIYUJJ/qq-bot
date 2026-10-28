import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

const start = L.findIndex((l) => l.includes('// 只读诊断工具交给 lib/tools-status.mjs'))
if (start < 0) throw new Error('找不到工具注册块起点')
const end = L.findIndex((l, i) => i > start && l.trim().startsWith('log('))
if (end < 0) throw new Error('找不到工具注册块终点')
const block = L.slice(start, end)

const idx = L.join('\n')
const outer = new Set()
for (const m of idx.matchAll(/^  (?:async )?function ([A-Za-z_$][\w$]*)\(/gm)) outer.add(m[1])
for (const m of idx.matchAll(/^  (?:const|let) ([A-Za-z_$][\w$]*)\s*=/gm)) outer.add(m[1])
for (const m of idx.matchAll(/^  const \{([^}]+)\} =/gm)) {
  for (const part of m[1].split(',')) {
    const n = part.trim().replace(/\s+as\s+.*/, '')
    if (/^[A-Za-z_$][\w$]*$/.test(n)) outer.add(n)
  }
}
for (const m of idx.matchAll(/^import \{([^}]+)\} from/gm)) {
  for (const part of m[1].split(',')) {
    const n = part.trim().replace(/\s+as\s+.*/, '')
    if (/^[A-Za-z_$][\w$]*$/.test(n)) outer.add(n)
  }
}
const tokens = new Set([...block.join('\n').matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
const kw = new Set('if else for of in return true false null undefined function async await try catch finally throw new typeof const let var switch case break default while do this import export new delete void'.split(' '))
const deps = [...tokens].filter((t) => outer.has(t) && !kw.has(t) && t !== 'ctx' && t !== 'safeRegister').sort()

const header = `/**
 * 工具注册：把各 tools-*.mjs 工厂产出的工具挂到 ctx 上。
 *
 * 纯装配，不含业务逻辑；依赖通过 d 传入。
 */
import { statusTools } from './tools-status.mjs'
import { diagnosticTools } from './tools-diagnostics.mjs'
import { readTools } from './tools-read.mjs'
import { inspectTools } from './tools-inspect.mjs'
import { stickerTools } from './tools-stickers.mjs'
import { actionTools } from './tools-actions.mjs'
import { configTools } from './tools-config.mjs'
import { contentTools } from './tools-content.mjs'
import { videoTools } from './tools-media.mjs'
import { simulateTools } from './tools-simulate.mjs'
import { opsTools } from './tools-ops.mjs'
import { replyTools } from './tools-reply.mjs'
import { miscTools } from './tools-misc.mjs'
import { selftestTools } from './tools-selftest.mjs'
import { memoryTools } from './tools-memory.mjs'
import { panelTools } from './tools-panel.mjs'

export function registerAllTools(ctx, safeRegister, d) {
`
const body = block
  .join('\n')
  .replace(/\b(statusTools|diagnosticTools|readTools|inspectTools|stickerTools|actionTools|configTools|contentTools|videoTools|simulateTools|opsTools|replyTools|miscTools|selftestTools|memoryTools|panelTools)\(\{/g, '$1({ ...d,')
writeFileSync('lib/register-tools.mjs', header + body + '\n}\n', 'utf8')

const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const call = [
  '  // 工具注册交给 lib/register-tools.mjs',
  '  registerAllTools(ctx, safeRegister, {',
  ...chunk(deps, 6).map((g) => '    ' + g.join(', ') + ','),
  '  })',
  '',
]
L.splice(start, end - start, ...call)

let out = L.join('\n')
if (!out.includes("from './register-tools.mjs'")) {
  const a = out.indexOf("import { createScheduler } from './scheduler.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { registerAllTools } from './register-tools.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('register-tools 抽取完成，依赖', deps.length, '项')
