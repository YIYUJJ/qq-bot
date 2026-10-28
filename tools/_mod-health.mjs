import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

// 删除 qqbot_health 块
const idx = lines.findIndex((l) => l.includes("name: 'qqbot_health'"))
if (idx < 0) throw new Error('找不到 qqbot_health')
let start = idx
while (start >= 0 && !lines[start].includes('ctx.effect(() =>')) start--
let close = -1
for (let i = idx; i < lines.length; i++) {
  if (lines[i] === '  )') {
    close = i
    break
  }
}
if (start < 0 || close < 0) throw new Error('找不到块边界')
lines.splice(start, close - start + 1)

// 更新注册调用，补 ob/discover/config
const reg = lines.findIndex((l) => l.includes('diagnosticTools({'))
if (reg < 0) throw new Error('找不到注册调用')
lines[reg] = "  for (const tool of diagnosticTools({ getLlm: () => ctx.get?.('llm'), stickers, existsSync, textOut, ob, discover, config })) {"

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('qqbot_health 合并进 tools-diagnostics')
