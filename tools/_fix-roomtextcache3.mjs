import { readFileSync, writeFileSync } from 'node:fs'

let L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
L = L.map((line) => {
  if (line.trim() === 'roomTextCache.clear()') return '      memoryStore.clearRoomTextCache()'
  if (line.includes('roomTextCache, writeJson,')) {
    return line.replace('roomTextCache, writeJson,', "roomTextCache: { clear: () => memoryStore.clearRoomTextCache() }, writeJson,")
  }
  return line
})
writeFileSync('lib/index.js', L.join('\n'), 'utf8')
console.log('roomTextCache 引用已修正')
