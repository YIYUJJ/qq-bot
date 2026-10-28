import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-memory-auto.mjs', 'utf8')
s = s.replace(
  "cfgFor: () => ({ memoryExtract: true, memoryExtractEvery: 5, profileEvery: 10, relationsEvery: 20 }),",
  "cfgFor: () => ({ memoryExtract: true, memoryExtractEvery: 5, profileEvery: 0, relationsEvery: 50, relationsCooldownMs: 3600000, memorySummaryEvery: 80 }),",
)
s = s.replace("e.run(mkRoom({ msgSinceExtract: 0, msgSinceRelations: 20 }))", "e.run(mkRoom({ msgSinceExtract: 0, msgSinceRelations: 50 }))")
writeFileSync('lib/test-memory-auto.mjs', s, 'utf8')
console.log('relations 阈值已按 Math.max(50,..) 修正')
