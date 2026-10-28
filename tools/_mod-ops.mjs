import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

function grabFn(name) {
  const start = L.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l))
  if (start < 0) throw new Error('找不到 ' + name)
  const bc = L[start].lastIndexOf('{')
  let depth = 0
  let inStr = null
  let inLine = false
  for (let i = start; i < L.length; i++) {
    const from = i === start ? bc : 0
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
          const lines = L.slice(start, i + 1)
          L.splice(start, i - start + 1)
          return lines
        }
      }
    }
    inLine = false
  }
  throw new Error(name + ' 没闭合')
}

const parts = {}
for (const n of ['backupRestore', 'searchHistory', 'tailLines', 'writeJson', 'connectInfo']) parts[n] = grabFn(n)

const deps = ['BACKUP_DIR', 'DATA_DIR', 'config', 'keywordsOf', 'log', 'ob', 'softReload']
const header = `/**
 * 运维/诊断工具：备份恢复、历史检索、日志尾巴、原子写 JSON、连接信息。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const OPS_DEPS = ${JSON.stringify(deps)}

export function createOps(deps) {
  const missing = OPS_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('运维模块缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const footer = `
  return { backupRestore, searchHistory, tailLines, writeJson, connectInfo }
}
`
writeFileSync('lib/ops.mjs', header + Object.values(parts).map((x) => x.join('\n')).join('\n\n') + footer, 'utf8')

const anchor = L.findIndex((l) => l.includes('// 推送接收端交给 lib/push-server.mjs'))
if (anchor < 0) throw new Error('找不到 push 锚点')
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
L.splice(anchor, 0,
  '  // 运维工具交给 lib/ops.mjs',
  '  const ops = createOps({',
  ...chunk(deps, 5).map((g) => '    ' + g.join(', ') + ','),
  '  })',
  '  const { backupRestore, searchHistory, tailLines, writeJson, connectInfo } = ops',
  '',
)

let out = L.join('\n')
if (!out.includes("from './ops.mjs'")) {
  const a = out.indexOf("import { createConfigStore } from './config-store.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createOps } from './ops.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('ops 抽取完成')
