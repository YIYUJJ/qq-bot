import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

const start = L.findIndex((l) => l.trim() === 'let pendingAdmin = null')
if (start < 0) throw new Error('找不到 pendingAdmin')
// 结束：handleAdminCommand 的函数结束
const hs = L.findIndex((l) => l.includes('async function handleAdminCommand(r, trigger)'))
if (hs < 0) throw new Error('找不到 handleAdminCommand')
const bc = L[hs].lastIndexOf('{')
let depth = 0
let inStr = null
let inLine = false
let end = -1
for (let i = hs; i < L.length && end < 0; i++) {
  const from = i === hs ? bc : 0
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
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  inLine = false
}
if (end < 0) throw new Error('handleAdminCommand 没闭合')

const block = L.slice(start, end + 1)

const deps = ['ob', 'config', 'log', 'generate', 'systemPrompt', 'roomState', 'setRoomOverride', 'roomOverrides', 'sendWithRetry', 'parseAdminCommand', 'describeAdminAction', 'normalizePlannedActions', 'metrics', 'stats', 'sleep']
const header = `/**
 * 管理员遥控流程：规则解析 → 确认 → 执行；规则没命中时交给模型拆解。
 *
 * pendingAdmin（待确认指令）也放在模块内，避免 index.js 再存一份可变状态。
 */
export const ADMIN_FLOW_DEPS = ${JSON.stringify(deps)}

export function createAdminFlow(deps) {
  const missing = ADMIN_FLOW_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('管理员流程缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const footer = `
  return { handleAdminCommand, executeAdminAction, planAdminCommand, replyAdmin }
}
`
writeFileSync('lib/admin-flow.mjs', header + block.map((l) => l.replace(/^  /, '  ')).join('\n') + footer, 'utf8')

const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
L.splice(start, end - start + 1,
  '  // 管理员遥控流程交给 lib/admin-flow.mjs',
  '  const adminFlow = createAdminFlow({',
  ...chunk(deps, 5).map((g) => '    ' + g.join(', ') + ','),
  '  })',
  '  const { handleAdminCommand, executeAdminAction, planAdminCommand, replyAdmin } = adminFlow',
  '',
)
let out = L.join('\n')
if (!out.includes("from './admin-flow.mjs'")) {
  const a = out.indexOf("import { createNotes } from './notes.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createAdminFlow } from './admin-flow.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('admin-flow 抽取完成：', block.length, '行')
