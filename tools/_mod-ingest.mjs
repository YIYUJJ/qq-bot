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
const pushImport = lines.findIndex((l) => l.includes("from './push-server.mjs'"))
if (pushImport < 0) throw new Error('找不到 push-server 导入')
lines.splice(pushImport + 1, 0, "import { createIngest } from './ingest.mjs'")

// 2) 删除原 ingestHistory
const s = findFn('ingestHistory')
if (s < 0) throw new Error('找不到 ingestHistory')
const e = fnEnd(s)
lines.splice(s, e - s + 1)

// 3) 在 ob 定义之后创建 ingestHistory
const obLine = lines.findIndex((l) => l.includes('const ob = (testHooks && testHooks.onebot)'))
if (obLine < 0) throw new Error('找不到 ob 定义')
lines.splice(obLine + 2, 0,
  '  // 原始消息归一化交给 lib/ingest.mjs',
  '  const ingestHistory = createIngest({ normalizeEvent, getSelfId: () => ob.status.self?.user_id })',
)

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('ingest 抽取完成')
