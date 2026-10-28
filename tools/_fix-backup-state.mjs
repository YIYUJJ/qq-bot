import { readFileSync, writeFileSync } from 'node:fs'

const L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const i = L.findIndex((l) => /const BACKUP_DIR = /.test(l))
if (i < 0) throw new Error('找不到 BACKUP_DIR')
if (!L.some((l) => l.includes('const BACKUP_STATE_FILE'))) {
  L.splice(i + 1, 0, "  const BACKUP_STATE_FILE = join(DATA_DIR, 'backup-state.json')")
}
writeFileSync('lib/index.js', L.join('\n'), 'utf8')
console.log('BACKUP_STATE_FILE 已补')
