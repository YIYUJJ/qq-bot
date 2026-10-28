import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/meta.mjs'
let s = readFileSync(p, 'utf8')
const missing = ['persona', 'aliases', 'allowAt', 'visionOnImage', 'visionOnEmoticon', 'proactive', 'proactiveHours', 'pokeBack']
let fixed = 0
for (const k of missing) {
  const re = new RegExp('(\\n  ' + k + ': \\{)([^{}]*)(\\})')
  const mm = re.exec(s)
  if (!mm) {
    console.log('⚠️ 找不到 ' + k)
    continue
  }
  if (/room: true/.test(mm[2])) continue
  s = s.slice(0, mm.index) + mm[1] + ' room: true,' + mm[2] + mm[3] + s.slice(mm.index + mm[0].length)
  fixed++
}
writeFileSync(p, s, 'utf8')
console.log('补 room 标记:', fixed)
