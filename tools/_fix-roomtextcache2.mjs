import { readFileSync, writeFileSync } from 'node:fs'

let L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
L = L.map((line) => {
  if (line.trim() === 'roomTextCache.clear()') return '      memoryStore.clearRoomTextCache()'
  if (line.includes('roomTextCache, sleep, writeJson,')) {
    return line.replace('roomTextCache, sleep, writeJson,', "roomTextCache: { clear: () => memoryStore.clearRoomTextCache() }, sleep, writeJson,")
  }
  return line
})
writeFileSync('lib/index.js', L.join('\n'), 'utf8')
console.log('roomTextCache 引用已修正')
