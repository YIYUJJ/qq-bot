import { readFileSync, writeFileSync } from 'node:fs'

let L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const i = L.findIndex((l) => l.includes('const BACKUP_STATE_FILE'))
if (i < 0) throw new Error('找不到 BACKUP_STATE_FILE 锚点')
const need = [
  "  const REMINDERS_FILE = join(DATA_DIR, 'reminders.json')",
  '  const reminders = readJson(REMINDERS_FILE, [])',
  "  const POLLS_FILE = join(DATA_DIR, 'polls.json')",
  '  const polls = readJson(POLLS_FILE, {})',
]
for (const line of need) {
  const exists = L.some((l) => l.trim() === line.trim())
  if (!exists) {
    L.splice(i + 1, 0, line)
  }
}
writeFileSync('lib/index.js', L.join('\n'), 'utf8')
console.log('REMINDERS_FILE / POLLS_FILE / reminders / polls 已补')
