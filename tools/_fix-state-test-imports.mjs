import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-state-store.mjs', 'utf8')
if (!s.includes("from 'node:fs'")) {
  s = s.replace(
    "import { createStateStore } from './state-store.mjs'",
    "import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'\nimport { join } from 'node:path'\nimport { tmpdir } from 'node:os'\nimport { createStateStore } from './state-store.mjs'",
  )
  writeFileSync('lib/test-state-store.mjs', s, 'utf8')
  console.log('已补 import')
}
