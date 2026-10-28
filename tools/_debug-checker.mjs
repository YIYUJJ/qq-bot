import { readFileSync } from 'node:fs'
import { auditFile } from '../tools/check-module-deps.mjs'

for (const f of ['lib/config-store.mjs', 'lib/onebot.mjs', 'lib/outbox.mjs', 'lib/policy.mjs']) {
  console.log(f, '→', auditFile(f).join(', '))
  const src = readFileSync(f, 'utf8')
  for (const n of ['log', 'validateConfig', 'OneBot', 'onEvent', 'Outbox', 'flush', 'decide']) {
    const m = src.match(new RegExp('(?:function|const|let)\\s+' + n + '\\b'))
    if (m) console.log('   声明:', m[0])
  }
}
