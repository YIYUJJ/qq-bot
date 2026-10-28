import { readFileSync, writeFileSync } from 'node:fs'

let m = readFileSync('lib/ops.mjs', 'utf8')
m = m.replace('"softReload","version"', '"getSoftReload","version"')
m = m.replace('const { BACKUP_DIR, DATA_DIR, config, getKeywords, log, getOb, softReload, version } = deps', 'const { BACKUP_DIR, DATA_DIR, config, getKeywords, log, getOb, getSoftReload, version } = deps')
m = m.replace(/\bsoftReload\(\)/g, 'getSoftReload()()')
writeFileSync('lib/ops.mjs', m, 'utf8')

let s = readFileSync('lib/index.js', 'utf8')
s = s.replace('    softReload,\n', '    getSoftReload: () => softReload,\n')
s = s.replace('    softReload, getOb:', '    getSoftReload: () => softReload, getOb:')
s = s.replace('    softReload,\r\n', '    getSoftReload: () => softReload,\r\n')
s = s.replace('    getKeywords: () => keywordsOf, log, getOb: () => ob,\n    version,', '    getKeywords: () => keywordsOf, log, getOb: () => ob,\n    getSoftReload: () => softReload,\n    version,')
// 兜底：如果 ops 调用里仍出现裸 softReload，替换成 getter
s = s.replace(/^(\s*)softReload,$/m, '$1getSoftReload: () => softReload,')
writeFileSync('lib/index.js', s, 'utf8')

let t = readFileSync('lib/test-ops.mjs', 'utf8')
t = t.replace('    softReload: () => reloaded.push(1),', '    getSoftReload: () => () => reloaded.push(1),')
writeFileSync('lib/test-ops.mjs', t, 'utf8')
console.log('ops softReload 改为惰性 getter')
