import { readFileSync, writeFileSync } from 'node:fs'

let m = readFileSync('lib/state-init.mjs', 'utf8')
m = m.replace("'isAllowedGroup'", "'getIsAllowedGroup'")
m = m.replace('const { DATA_DIR, config, isAllowedGroup, log,', 'const { DATA_DIR, config, getIsAllowedGroup, log,')
m = m.replace(/\bisAllowedGroup\(item\.roomId\)/g, 'getIsAllowedGroup()(item.roomId)')
writeFileSync('lib/state-init.mjs', m, 'utf8')

let s = readFileSync('lib/index.js', 'utf8')
s = s.replace('    DATA_DIR, config, isAllowedGroup, log, mediaKey: (u) => mediaKey(u),', '    DATA_DIR, config, getIsAllowedGroup: () => isAllowedGroup, log, mediaKey: (u) => mediaKey(u),')
writeFileSync('lib/index.js', s, 'utf8')
console.log('stateInit isAllowedGroup 改惰性')
