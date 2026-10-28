import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/index.js', 'utf8')
const marker = '  // 链接/搜索笔记交给 lib/notes.mjs'
const start = s.indexOf(marker)
if (start < 0) throw new Error('找不到 notes 块')
const destr = s.indexOf('const { buildWebLinkNote, buildVideoLinkNote, buildSearchNote, extractSearchQuery, sensitiveQuery, webSearch, rememberVideo } = notes', start)
const end = s.indexOf('\n', destr) + 1
const block = s.slice(start, end)
s = s.slice(0, start) + s.slice(end)

const anchor = s.indexOf('  // onEvent 交给 lib/on-event.mjs')
if (anchor < 0) throw new Error('找不到 onEvent 锚点')
s = s.slice(0, anchor) + block + '\n' + s.slice(anchor)
writeFileSync('lib/index.js', s, 'utf8')
console.log('notes 工厂已前移')
