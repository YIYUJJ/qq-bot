import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

function findFn(name) {
  return lines.findIndex((l) => l.includes('function ' + name + '('))
}
function fnEnd(start) {
  let depth = 0
  let started = false
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth++
        started = true
      } else if (ch === '}') depth--
    }
    if (started && depth === 0) return i
  }
  throw new Error('没闭合：' + lines[start])
}

// 1) import
const noticesImport = lines.findIndex((l) => l.includes("from './notices.mjs'"))
if (noticesImport < 0) throw new Error('找不到 notices 导入')
lines.splice(noticesImport + 1, 0, "import { createPushServer } from './push-server.mjs'")

// 2) 删除 let pushServer / stopPushServer / startPushServer 三段
const ps = lines.findIndex((l) => l.includes('let pushServer = null'))
if (ps < 0) throw new Error('找不到 pushServer 变量')
const stopS = findFn('stopPushServer')
const startS = findFn('startPushServer')
if (stopS < 0 || startS < 0) throw new Error('找不到 push 函数')
const startE = fnEnd(startS)
lines.splice(ps, startE - ps + 1,
  '  // 推送接收端交给 lib/push-server.mjs（安全边界集中在一处）',
  '  const push = createPushServer({ config, log, stats, onEvent, ingestHistory })',
  '  const startPushServer = () => push.start()',
  '  const stopPushServer = () => push.stop()',
  '  const getPushServer = () => push.server',
)

// 3) connectInfo 里的 pushServer?.listening → push.listening（保留可读性）
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('pushServer?.listening')) {
    lines[i] = lines[i].replace('pushServer?.listening', 'push.listening')
  }
}

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('push-server 抽取完成')
