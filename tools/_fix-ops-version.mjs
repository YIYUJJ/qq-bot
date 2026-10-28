import { readFileSync, writeFileSync } from 'node:fs'

let m = readFileSync('lib/ops.mjs', 'utf8')
m = m.replace('"softReload"]', '"softReload","version"]')
m = m.replace('const { BACKUP_DIR, DATA_DIR, config, getKeywords, log, getOb, softReload } = deps', 'const { BACKUP_DIR, DATA_DIR, config, getKeywords, log, getOb, softReload, version } = deps')
writeFileSync('lib/ops.mjs', m, 'utf8')

let s = readFileSync('lib/index.js', 'utf8')
s = s.replace('    getOb: () => ob,', '    getOb: () => ob,\n    version,')
writeFileSync('lib/index.js', s, 'utf8')

let t = readFileSync('lib/test-ops.mjs', 'utf8')
if (!t.includes("version: 'test'")) {
  t = t.replace("    softReload: () => reloaded.push(1),", "    softReload: () => reloaded.push(1),\n    version: 'test',")
  writeFileSync('lib/test-ops.mjs', t, 'utf8')
}
console.log('ops 补 version 依赖')
