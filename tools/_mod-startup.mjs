import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const L = readFileSync(p, 'utf8').split(/\r?\n/)

const start = L.findIndex((l) => l.trim() === 'void (async () => {')
if (start < 0) throw new Error('找不到启动 IIFE')
const end = L.findIndex((l, i) => i > start && l.trim() === '})()')
if (end < 0) throw new Error('找不到 IIFE 结束')

// 取 IIFE 内部（去掉首尾两行），并将顶层缩进从 4 空格降到 2
let body = L.slice(start + 1, end).map((l) => (l.startsWith('    ') ? l.slice(2) : l))

const deps = ['ob', 'config', 'log', 'getDisposed', 'groupNames', 'isAllowedGroup', 'migrateLegacy', 'MEMORY_DIR', 'FACTS_FILE', 'pruneUnmanagedMemory', 'primeAllowed', 'startPushServer', 'selfcheck', 'startPolling', 'sweepStickerLibrary', 'flushOutbox', 'outbox', 'safeTick', 'timers']
const header = `/**
 * 启动序列：连接 SnowLuma → 群名缓存 → 记忆迁移 → 基线 → 推送/轮询 → 图库/重发队列。
 */
export const STARTUP_DEPS = ${JSON.stringify(deps)}

export function createStartup(deps) {
  const missing = STARTUP_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('启动序列缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

  async function run() {
`
const footer = `
  }

  return { run }
}
`
// disposed → getDisposed()
const bodyText = body.join('\n').replace(/\bdisposed\b/g, 'getDisposed()')
writeFileSync('lib/startup.mjs', header + bodyText + footer, 'utf8')

// index：替换为 startup.run()
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
L.splice(start, end - start + 1,
  '  // 启动序列交给 lib/startup.mjs',
  '  const startup = createStartup({',
  ...chunk(deps.filter((d) => d !== 'getDisposed'), 5).map((g) => '    ' + g.join(', ') + ','),
  '    getDisposed: () => disposed,',
  '  })',
  '  void startup.run()',
)

let out = L.join('\n')
if (!out.includes("from './startup.mjs'")) {
  const a = out.indexOf("import { registerAllTools } from './register-tools.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createStartup } from './startup.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('startup 抽取完成：', body.length, '行')
