#!/usr/bin/env node
/** 跑 lib/test-*.mjs 全部单测，任一失败则非 0 退出。 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const suites = readdirSync(join(ROOT, 'lib')).filter((f) => f.startsWith('test-') && f.endsWith('.mjs')).sort()
let failed = 0
for (const s of suites) {
  const out = execFileSync(process.execPath, [join(ROOT, 'lib', s)], { encoding: 'utf8' })
  const m = /通过 (\d+) 项，失败 (\d+) 项/.exec(out)
  const pass = m ? m[1] : '?'
  const fail = m ? Number(m[2]) : 1
  if (fail) failed += 1
  console.log(`${fail ? '❌' : '✅'} ${s.padEnd(20)} 通过 ${pass} 项`)
}
console.log(failed ? `\n${failed} 组失败` : '\n全部通过')
process.exit(failed ? 1 : 0)
