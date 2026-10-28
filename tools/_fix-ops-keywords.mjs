import { readFileSync, writeFileSync } from 'node:fs'

let m = readFileSync('lib/ops.mjs', 'utf8')
m = m.replace('"config","keywordsOf","log"', '"config","getKeywords","log"')
m = m.replace('const { BACKUP_DIR, DATA_DIR, config, keywordsOf, log, getOb, softReload } = deps', 'const { BACKUP_DIR, DATA_DIR, config, getKeywords, log, getOb, softReload } = deps')
m = m.replace(/\bkeywordsOf\(/g, 'getKeywords()(')
writeFileSync('lib/ops.mjs', m, 'utf8')

let s = readFileSync('lib/index.js', 'utf8')
s = s.replace('    config, keywordsOf, log, getOb:', '    config, getKeywords: () => keywordsOf, log, getOb:')
s = s.replace('    keywordsOf,\n    log,', '    getKeywords: () => keywordsOf,\n    log,')
writeFileSync('lib/index.js', s, 'utf8')
console.log('ops keywordsOf 改为惰性')
