import { readFileSync, writeFileSync } from 'node:fs'

const p = 'tools/check-module-deps.mjs'
let s = readFileSync(p, 'utf8')
s = s.replace(/^\s*main\(\)\s*$/m, "if (process.argv[1] && process.argv[1].endsWith('check-module-deps.mjs')) main()")
writeFileSync(p, s, 'utf8')
console.log('CLI 已加 import 守卫')
