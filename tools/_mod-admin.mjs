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
const visionImport = lines.findIndex((l) => l.includes("from './vision-cache.mjs'"))
if (visionImport < 0) throw new Error('找不到 vision-cache 导入')
lines.splice(visionImport + 1, 0, "import { createAdminCommands } from './admin-commands.mjs'")

// 2) 删除 5 个函数（从后往前删，避免索引位移）
const names = ['normalizePlannedActions', 'describeAdminAction', 'parseAdminCommand', 'detectIntents', 'findRoomByText']
const ranges = []
for (const n of names) {
  const s = findFn(n)
  if (s < 0) throw new Error('找不到 ' + n)
  ranges.push([s, fnEnd(s)])
}
ranges.sort((a, b) => b[0] - a[0])
for (const [s, e] of ranges) lines.splice(s, e - s + 1)

// 3) 在 runtime 之后建立 adminCommands 并解构
const runtimeLine = lines.findIndex((l) => l.includes('const runtime = createRuntime()'))
if (runtimeLine < 0) throw new Error('找不到 runtime')
lines.splice(runtimeLine + 1, 0,
  '  // 管理员指令的规则解析/描述/归一化交给 lib/admin-commands.mjs',
  '  const adminCommands = createAdminCommands({ rooms, groupNames, config })',
  '  const { findRoomByText, detectIntents, parseAdminCommand, describeAdminAction, normalizePlannedActions } = adminCommands',
)

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('admin-commands 抽取完成')
