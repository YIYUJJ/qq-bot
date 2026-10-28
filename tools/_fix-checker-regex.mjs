import { readFileSync, writeFileSync } from 'node:fs'

const p = 'tools/check-module-deps.mjs'
let s = readFileSync(p, 'utf8')
s = s.replace(
  "for (const m of src.matchAll(/\\b(?:const|let|var)\\s+\\{([^}]*)\\}\\s*=/g)) for (const n of names(m[1])) known.add(n)",
  "for (const m of src.matchAll(/\\b(?:const|let|var)\\s+\\{([\\s\\S]*?)\\}\\s*=/g)) for (const n of names(m[1])) known.add(n)",
)
s = s.replace(
  "for (const m of src.matchAll(/export function (\\w+)\\(\\s*(\\{[^}]*\\}|\\w+)/g)) {",
  "for (const m of src.matchAll(/export function (\\w+)\\(\\s*(\\{[^}]*\\}|\\w+)/g)) {",
)
writeFileSync(p, s, 'utf8')
console.log('destructure 正则已放宽')
