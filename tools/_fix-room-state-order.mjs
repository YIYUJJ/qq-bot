import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/index.js', 'utf8')
const marker = '  // 会话状态交给 lib/room-state.mjs'
const start = s.indexOf(marker)
if (start < 0) throw new Error('找不到 roomState 块')
const end = s.indexOf('const { roomState } = roomStateApi', start)
const endLine = s.indexOf('\n', end) + 1
const block = s.slice(start, endLine)
s = s.slice(0, start) + s.slice(endLine)

const anchor = '  // 每群配置运行时交给 lib/room-config.mjs'
const idx = s.indexOf(anchor)
if (idx < 0) throw new Error('找不到 roomCfg 锚点')
s = s.slice(0, idx) + block + '\n' + s.slice(idx)
writeFileSync('lib/index.js', s, 'utf8')
console.log('roomState 已前移')
