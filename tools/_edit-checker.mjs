import { readFileSync, writeFileSync } from 'node:fs'

const p = 'tools/check-module-deps.mjs'
let s = readFileSync(p, 'utf8')
if (!s.includes('const props = new Set')) {
  s = s.replace(
    '  const tokens = new Set(',
    `  const props = new Set([...src.matchAll(/(?<![.\\w$])([A-Za-z_$][\\w$]*)\\s*:/g)].map((m) => m[1]))
  const tokens = new Set(`,
  )
  s = s.replace('!KW.has(t)).sort()', '!KW.has(t) && !props.has(t)).sort()')
  writeFileSync(p, s, 'utf8')
  console.log('已加属性键过滤')
}
