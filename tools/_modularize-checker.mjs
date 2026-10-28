import { readFileSync, writeFileSync } from 'node:fs'

const p = 'tools/check-module-deps.mjs'
let s = readFileSync(p, 'utf8')
if (!s.includes('export function main')) {
  const idx = s.indexOf('const files = readdirSync')
  if (idx < 0) throw new Error('找不到 CLI 段')
  const cli = s.slice(idx)
  s = s.slice(0, idx) + 'export function main() {\n' + cli.replace(/^/gm, '  ') + '\n}\n\nmain()\n'
  writeFileSync(p, s, 'utf8')
  console.log('checker 已模块化')
}
