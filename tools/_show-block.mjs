import { readFileSync } from 'node:fs'

const names = process.argv.slice(2)
const lines = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
for (const name of names) {
  const idx = lines.findIndex((l) => l.includes(`name: '${name}'`))
  if (idx < 0) {
    console.log(`== ${name} == 未找到`)
    continue
  }
  let start = idx
  while (start >= 0 && !lines[start].includes('ctx.effect(() =>')) start--
  let close = -1
  for (let i = idx; i < lines.length; i++) {
    if (lines[i] === '  )') {
      close = i
      break
    }
  }
  console.log(`== ${name} == L${start + 1}..L${close + 1} (${close - start + 1} 行)`)
  for (let i = start; i <= close; i++) console.log(String(i + 1).padStart(5) + '| ' + lines[i])
  console.log('')
}
