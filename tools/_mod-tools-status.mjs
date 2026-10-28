import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

// 1) import
const ingestImport = lines.findIndex((l) => l.includes("from './ingest.mjs'"))
if (ingestImport < 0) throw new Error('找不到 ingest 导入')
lines.splice(ingestImport + 1, 0, "import { statusTools } from './tools-status.mjs'")

// 2) 删掉 qqbot_status / qqbot_rooms 两块（从 status 的 ctx.effect 到 rooms 块结束）
const statusName = lines.findIndex((l) => l.includes("name: 'qqbot_status'"))
const historyName = lines.findIndex((l) => l.includes("name: 'qqbot_history'"))
if (statusName < 0 || historyName < 0) throw new Error('找不到工具块')
// 起点：statusName 往上找最近的 ctx.effect
let start = statusName
while (start > 0 && !lines[start].includes('ctx.effect(')) start--
// 终点：historyName 往上找最近的 ctx.effect，再往上退一行空白
let end = historyName
while (end > 0 && !lines[end].includes('ctx.effect(')) end--
// end 指向 history 的 ctx.effect 行；删除到它前一行
lines.splice(start, end - start,
  '  // 只读诊断工具交给 lib/tools-status.mjs',
  '  for (const tool of statusTools({',
  '    connectInfo, stats, config, push, rooms, groupNames, allowedHere, mustReply, factsOf, cfgFor, textOut,',
  '  })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-status 抽取完成')
