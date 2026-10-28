import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

const obLine = lines.findIndex((l) => l.includes('const ob = new OneBot({ log })'))
if (obLine < 0) throw new Error('找不到 new OneBot')
lines[obLine] = '  // 测试接缝：集成测试可以注入假 OneBot / 假 LLM（生产环境永远走真实实现）\n  const testHooks = (rawConfig && rawConfig.__test) || null\n  const ob = (testHooks && testHooks.onebot) || new OneBot({ log })'

// llm 注入：替换两处 ctx.llm.stream
const llmLine = lines.findIndex((l) => l.includes('const ob = (testHooks'))
lines.splice(llmLine + 1, 0, '  const llm = (testHooks && testHooks.llm) || ctx.llm')

let replaced = 0
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('ctx.llm.stream(')) {
    lines[i] = lines[i].replace('ctx.llm.stream(', 'llm.stream(')
    replaced += 1
  }
}
writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('接缝已加：onebot/llm 可注入，替换 stream 调用', replaced, '处')
