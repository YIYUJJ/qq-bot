import { readFileSync, writeFileSync } from 'node:fs'

let L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const bi = L.findIndex((l) => /const BACKUP_DIR = /.test(l))
if (bi < 0) throw new Error('找不到 BACKUP_DIR')
const line = L[bi]
L.splice(bi, 1)
const li = L.findIndex((l) => /const LOG_FILE = join\(/.test(l))
if (li < 0) throw new Error('找不到 LOG_FILE')
L.splice(li + 1, 0, line)
writeFileSync('lib/index.js', L.join('\n'), 'utf8')
console.log('BACKUP_DIR 已前移')
