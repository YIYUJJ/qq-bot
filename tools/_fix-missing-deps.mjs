import { readFileSync, writeFileSync } from 'node:fs'

// 1) http-api：补 schema 常量 import
let h = readFileSync('lib/http-api.mjs', 'utf8')
if (!h.includes("from './schema.mjs'")) {
  h = h.replace("import { readFileSync } from 'node:fs'", "import { readFileSync } from 'node:fs'\nimport { CONFIG_KEYS, ROOM_KEYS } from './schema.mjs'")
  writeFileSync('lib/http-api.mjs', h, 'utf8')
  console.log('http-api 补 CONFIG_KEYS/ROOM_KEYS import')
}

// 2) memory-auto：补 memDirOf / readRoomMemory
let m = readFileSync('lib/memory-auto.mjs', 'utf8')
const dn = 'CREATEMAYBEAUTOEXTRACT_DEPS'
let deps = JSON.parse(m.match(new RegExp(dn + ' = (\\[[^\\]]*\\])'))[1])
let changed = false
for (const extra of ['memDirOf', 'readRoomMemory']) {
  if (!deps.includes(extra)) {
    deps.push(extra)
    changed = true
  }
}
if (changed) {
  deps.sort()
  m = m.replace(new RegExp(dn + ' = \\[[^\\]]*\\]'), dn + ' = ' + JSON.stringify(deps))
  m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
  if (!m.includes("from './memory.mjs'")) {
    m = m.replace("export const CREATEMAYBEAUTOEXTRACT_DEPS", "import { readRoomMemory } from './memory.mjs'\n\nexport const CREATEMAYBEAUTOEXTRACT_DEPS")
  }
  writeFileSync('lib/memory-auto.mjs', m, 'utf8')
  console.log('memory-auto 补 memDirOf/readRoomMemory')
}

// 3) notes：补 isManagedRoom/factsOf/addFact/delFact
let n = readFileSync('lib/notes.mjs', 'utf8')
const nd = 'NOTES_DEPS'
let ndeps = JSON.parse(n.match(new RegExp(nd + ' = (\\[[^\\]]*\\])'))[1])
let nChanged = false
for (const extra of ['isManagedRoom', 'factsOf', 'addFact', 'delFact']) {
  if (!ndeps.includes(extra)) {
    ndeps.push(extra)
    nChanged = true
  }
}
if (nChanged) {
  ndeps.sort()
  n = n.replace(new RegExp(nd + ' = \\[[^\\]]*\\]'), nd + ' = ' + JSON.stringify(ndeps))
  n = n.replace(/const \{[^}]*\} = deps/, 'const { ' + ndeps.join(', ') + ' } = deps')
  writeFileSync('lib/notes.mjs', n, 'utf8')
  console.log('notes 补 4 个依赖')
}

// 4) startup：补 renameSync import
let st = readFileSync('lib/startup.mjs', 'utf8')
if (!st.includes('renameSync')) {
  st = st.replace('export const STARTUP_DEPS', "import { renameSync } from 'node:fs'\n\nexport const STARTUP_DEPS")
  writeFileSync('lib/startup.mjs', st, 'utf8')
  console.log('startup 补 renameSync import')
}

// 5) sticker-net：补 readFileSync import
let sk = readFileSync('lib/sticker-net.mjs', 'utf8')
sk = sk.replace(
  "import { closeSync, existsSync, mkdirSync, openSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'",
  "import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'",
)
writeFileSync('lib/sticker-net.mjs', sk, 'utf8')
console.log('sticker-net 补 readFileSync import')

// 6) backup：roomOverrides 赋值改成 setRoomOverrides
let b = readFileSync('lib/backup.mjs', 'utf8')
if (b.includes('roomOverrides = ov')) {
  b = b.replace('roomOverrides = ov && typeof ov === "object" && !Array.isArray(ov) ? ov : {}', 'setRoomOverrides(ov && typeof ov === "object" && !Array.isArray(ov) ? ov : {})')
  b = b.replace('roomOverrides = ov && typeof ov === \'object\' && !Array.isArray(ov) ? ov : {}', 'setRoomOverrides(ov && typeof ov === \'object\' && !Array.isArray(ov) ? ov : {})')
  writeFileSync('lib/backup.mjs', b, 'utf8')
  console.log('backup 改走 setRoomOverrides')
}
