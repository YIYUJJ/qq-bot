import { readFileSync, writeFileSync } from 'node:fs'

let m = readFileSync('lib/backup.mjs', 'utf8')
m = m.replace('"setRoomOverrides","sleep"', '"setRoomOverrides","getSleep"')
m = m.replace('setRoomOverrides, sleep, writeJson } = deps', 'setRoomOverrides, getSleep, writeJson } = deps')
m = m.replace(/\bawait sleep\(/g, 'await getSleep()(')
writeFileSync('lib/backup.mjs', m, 'utf8')

let s = readFileSync('lib/index.js', 'utf8')
s = s.replace('    roomTextCache: { clear: () => memoryStore.clearRoomTextCache() }, sleep, writeJson,', '    roomTextCache: { clear: () => memoryStore.clearRoomTextCache() }, getSleep: () => sleep, writeJson,')
s = s.replace('    sleep, writeJson,', '    getSleep: () => sleep, writeJson,')
writeFileSync('lib/index.js', s, 'utf8')
console.log('backup 的 sleep 改为 getter')
