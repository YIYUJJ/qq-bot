import { readFileSync, writeFileSync } from 'node:fs'

let m = readFileSync('lib/ops.mjs', 'utf8')
if (!m.includes('"getSoftReload"')) {
  m = m.replace('"softReload"', '"getSoftReload"')
  m = m.replace('softReload, version } = deps', 'getSoftReload, version } = deps')
}
writeFileSync('lib/ops.mjs', m, 'utf8')

let s = readFileSync('lib/index.js', 'utf8')
s = s.replace('    version, softReload,', '    version, getSoftReload: () => softReload,')
s = s.replace(/^(\s*)softReload,$/m, '$1getSoftReload: () => softReload,')
writeFileSync('lib/index.js', s, 'utf8')
console.log('ops softReload 改为 getter')
