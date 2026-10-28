import { readFileSync, writeFileSync } from 'node:fs'

const name = process.argv[2]
const moduleName = process.argv[3]
const exportName = process.argv[4]
const depsArg = process.argv[5]

if (!name || !moduleName || !exportName || !depsArg) throw new Error('用法: node tools/_mod-fn.mjs <函数名> <模块文件> <导出工厂名> <依赖,逗号分隔>')

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
const L = raw.split(/\r?\n/)

const start = L.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l))
if (start < 0) throw new Error('找不到函数 ' + name)
let depth = 0
let end = -1
let inStr = null
let inLine = false
for (let i = start; i < L.length && end < 0; i++) {
  for (let k = 0; k < L[i].length; k++) {
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
if (end < 0) throw new Error('函数没有闭合')

const deps = depsArg.split(',').map((s) => s.trim()).filter(Boolean)
const body = L.slice(start, end + 1)
// 去掉函数自身的名字行，保留内部实现
const inner = body.slice(1, -1)
const isAsync = /^  async function/.test(body[0])

const header = `/**
 * 自动抽取的模块：${name}
 *
 * 依赖注入（缺一个启动即报错，避免运行到一半才炸）。
 */
export const ${exportName.toUpperCase()}_DEPS = ${JSON.stringify(deps)}

export function ${exportName}(deps) {
  const missing = ${exportName.toUpperCase()}_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('${name} 缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const fn = [`  ${isAsync ? 'async ' : ''}function ${name}(...) {`.replace('(...)', ''), ...inner, '  }', '', `  return ${name}`, '}', '']
// 直接用原始签名行
fn[0] = body[0]
writeFileSync(moduleName, header + fn.join('\n'), 'utf8')

// index 替换
const call = [
  `  // ${name} 交给 ${moduleName}`,
  `  const ${name} = ${exportName}({`,
  ...chunk(deps, 5).map((g) => '    ' + g.join(', ') + ','),
  '  })',
]
function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
L.splice(start, end - start + 1, ...call)
let out = L.join(crlf ? '\r\n' : '\n')
out = out.replace(/(import \{ createSelfcheck \} from '\.\/selfcheck\.mjs'\n)/, `$1import { ${exportName} } from './${moduleName.split('/').pop()}'\n`)
writeFileSync(p, out, 'utf8')
console.log(name, '抽取完成：', body.length, '行，依赖', deps.length)
