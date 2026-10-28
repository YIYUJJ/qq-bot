import { readFileSync, writeFileSync } from 'node:fs'

let m = readFileSync('lib/memory-store.mjs', 'utf8')
if (!m.includes('clearRoomTextCache')) {
  m = m.replace(
    '  return { isGroupRoom,',
    '  function clearRoomTextCache() {\n    roomTextCache.clear()\n  }\n\n  return { isGroupRoom,',
  )
  m = m.replace('roomTextOf, invalidateRoomText, similarity }', 'roomTextOf, invalidateRoomText, clearRoomTextCache, similarity }')
  writeFileSync('lib/memory-store.mjs', m, 'utf8')
}

let s = readFileSync('lib/index.js', 'utf8')
s = s.replace('    roomTextCache,\n', "    roomTextCache: { clear: () => memoryStore.clearRoomTextCache() },\n")
s = s.replace('    roomTextCache, polls,', "    roomTextCache: { clear: () => memoryStore.clearRoomTextCache() }, polls,")
s = s.replace('roomTextCache, polls, readJson', 'roomTextCache: { clear: () => memoryStore.clearRoomTextCache() }, polls, readJson')
writeFileSync('lib/index.js', s, 'utf8')
console.log('roomTextCache 通过 memoryStore 清理')
