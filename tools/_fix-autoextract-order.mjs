import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/index.js', 'utf8')
const startMarker = '  // maybeAutoExtract 交给 lib/memory-auto.mjs'
const start = s.indexOf(startMarker)
if (start < 0) throw new Error('找不到插入块')
const end = s.indexOf('  })', start)
if (end < 0) throw new Error('找不到块结束')
const block = s.slice(start, end + 5)
s = s.slice(0, start) + s.slice(end + 5)

const anchor = s.indexOf('  // flush 交给 lib/flush.mjs')
if (anchor < 0) throw new Error('找不到 flush 锚点')
s = s.slice(0, anchor) + block + '\n' + s.slice(anchor)
writeFileSync('lib/index.js', s, 'utf8')
console.log('maybeAutoExtract 工厂已前移')
