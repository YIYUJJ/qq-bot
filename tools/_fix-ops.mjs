import { readFileSync, writeFileSync } from 'node:fs'

// 1) 模块：ob → getOb，补 import
let m = readFileSync('lib/ops.mjs', 'utf8')
m = m.replace('"log","ob","softReload"', '"log","getOb","softReload"')
m = m.replace('const { BACKUP_DIR, DATA_DIR, config, keywordsOf, log, ob, softReload } = deps', 'const { BACKUP_DIR, DATA_DIR, config, keywordsOf, log, getOb, softReload } = deps')
m = m.replace(/\bob\./g, 'getOb().')
m = m.replace(
  "import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'",
  "import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'",
)
if (!m.includes("from './store.mjs'")) {
  m = m.replace(
    "import { join } from 'node:path'",
    "import { join } from 'node:path'\nimport { atomicWriteJson } from './store.mjs'\nimport { normalizeEvent } from './onebot.mjs'",
  )
}
writeFileSync('lib/ops.mjs', m, 'utf8')

// 2) index：挪到 config 之后
let s = readFileSync('lib/index.js', 'utf8')
const marker = '  // 运维工具交给 lib/ops.mjs'
const start = s.indexOf(marker)
const destr = s.indexOf('const { backupRestore, searchHistory, tailLines, writeJson, connectInfo } = ops', start)
const end = s.indexOf('\n', destr) + 1
let block = s.slice(start, end)
block = block.replace('    ob,', '    getOb: () => ob,')
s = s.slice(0, start) + s.slice(end)

const anchor = s.indexOf('  for (const w of configStore.warnings) log("配置校验：" + w)')
const insertAt = s.indexOf('\n', anchor) + 1
s = s.slice(0, insertAt) + '\n' + block + s.slice(insertAt)
writeFileSync('lib/index.js', s, 'utf8')
console.log('ops 已前移 + getOb 改造')
