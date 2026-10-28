import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

const statusIdx = lines.findIndex((l) => l.includes("name: 'qqbot_status'"))
const historyIdx = lines.findIndex((l) => l.includes("name: 'qqbot_history'"))
if (statusIdx < 0 || historyIdx < 0) throw new Error('找不到工具块')

// 起点：status 之前最近的 ctx.effect
let start = statusIdx
while (start >= 0 && !lines[start].includes('ctx.effect(() =>')) start--
if (start < 0) throw new Error('找不到 status 的 ctx.effect')

// 终点：rooms 块结束（history 的 ctx.effect 之前最后一个恰好 '  )' 的行）
let end = historyIdx
while (end >= 0 && !lines[end].includes('ctx.effect(() =>')) end--
if (end < 0) throw new Error('找不到 history 的 ctx.effect')
// 从 end-1 往上找 '  )'
let close = -1
for (let i = end - 1; i > start; i--) {
  if (lines[i] === '  )') {
    close = i
    break
  }
}
if (close < 0) throw new Error('找不到块结束')

// 删除 [start..close]
lines.splice(start, close - start + 1)

// 在 apply 末尾（最后一个 '  log(' 之前）插入注册
let lastLog = -1
for (let i = lines.length - 1; i > 0; i--) {
  if (lines[i] === '  log(') {
    lastLog = i
    break
  }
}
if (lastLog < 0) throw new Error('找不到末尾 log')
const block = [
  '  // 只读诊断工具交给 lib/tools-status.mjs',
  '  for (const tool of statusTools({',
  '    connectInfo, stats, config, push, rooms, groupNames, allowedHere, mustReply, factsOf, cfgFor, textOut,',
  '  })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
  '',
]
lines.splice(lastLog, 0, ...block)

// import
const ingestImport = lines.findIndex((l) => l.includes("from './ingest.mjs'"))
lines.splice(ingestImport + 1, 0, "import { statusTools } from './tools-status.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-status 抽取完成，行数', lines.length)
