import { readFileSync, writeFileSync } from 'node:fs'

let L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)

// 删掉错位插入的三行
for (let i = L.length - 1; i >= 0; i--) {
  const t = L[i].trim()
  if (t === 'const polls = readJson(POLLS_FILE, {})' && i < 200) L.splice(i, 1)
  else if (t === 'const reminders = readJson(REMINDERS_FILE, [])' && i < 200) L.splice(i, 1)
  else if (t === "const REMINDERS_FILE = join(DATA_DIR, 'reminders.json')" && i < 200) L.splice(i, 1)
}

const pi = L.findIndex((l) => l.trim().startsWith('const POLLS_FILE = join('))
if (pi < 0) throw new Error('找不到 POLLS_FILE')
const insert = ["  const REMINDERS_FILE = join(DATA_DIR, 'reminders.json')", '  const reminders = readJson(REMINDERS_FILE, [])']
for (let k = insert.length - 1; k >= 0; k--) L.splice(pi, 0, insert[k])

writeFileSync('lib/index.js', L.join('\n'), 'utf8')
console.log('reminders 常量已就位，polls 去重')
