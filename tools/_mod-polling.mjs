import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let lines = readFileSync(p, 'utf8').split(/\r?\n/)

// 删除 primeAllowed / privateTargets / pollOnce 三个函数（用括号计数，从后往前删）
function range(name) {
  const start = lines.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l))
  if (start < 0) throw new Error('找不到 ' + name)
  // 函数体起点：签名行最后一个 {
  let bl = start
  let bc = lines[bl].lastIndexOf('{')
  while (bc < 0) {
    bl++
    bc = lines[bl].lastIndexOf('{')
  }
  let depth = 0
  let inStr = null
  let inLine = false
  for (let i = bl; i < lines.length; i++) {
    const from = i === bl ? bc : 0
    for (let k = from; k < lines[i].length; k++) {
      const c = lines[i][k]
      const n = lines[i][k + 1]
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
        if (depth === 0) return [start, i]
      }
    }
    inLine = false
  }
  throw new Error(name + ' 没闭合')
}

for (const name of ['pollOnce', 'privateTargets', 'primeAllowed']) {
  const [s, e] = range(name)
  lines.splice(s, e - s + 1)
}

// 删除 let polling = false
const pi = lines.findIndex((l) => l.trim() === 'let polling = false')
if (pi >= 0) lines.splice(pi, 1)

// 插入工厂（放在原来 primeAllowed 附近：push server 之前）
const anchor = lines.findIndex((l) => l.includes('// 推送接收端交给 lib/push-server.mjs'))
if (anchor < 0) throw new Error('找不到 push server 锚点')
lines.splice(
  anchor,
  0,
  '  // 轮询兜底交给 lib/polling.mjs',
  '  const polling = createPolling({ config, ob, ingestHistory, onEvent, roomState, log })',
  '  const { primeAllowed, pollOnce, privateTargets } = polling',
  '',
)

let s2 = lines.join('\n')
if (!s2.includes("from './polling.mjs'")) {
  const a = s2.indexOf("import { createOnEvent } from './on-event.mjs'")
  const i = s2.indexOf('\n', a) + 1
  s2 = s2.slice(0, i) + "import { createPolling } from './polling.mjs'\n" + s2.slice(i)
}
writeFileSync(p, s2, 'utf8')
console.log('polling 抽取完成')
