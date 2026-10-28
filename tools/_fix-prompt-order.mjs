import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/index.js', 'utf8')
const marker = '  // 提示词拼装交给 lib/prompt.mjs'
const start = s.indexOf(marker)
if (start < 0) throw new Error('找不到 prompt 块')
const destr = s.indexOf('const { moodName, inferMood, buildTranscript, systemPrompt } = prompt', start)
const end = s.indexOf('\n', destr) + 1
const block = s.slice(start, end)
s = s.slice(0, start) + s.slice(end)

const anchor = s.indexOf('  // ── 管理员私聊遥控（指令 → 确认 → 执行）')
if (anchor < 0) throw new Error('找不到管理员流程锚点')
s = s.slice(0, anchor) + block + '\n' + s.slice(anchor)
writeFileSync('lib/index.js', s, 'utf8')
console.log('prompt 工厂已前移到 adminFlow 之前')
