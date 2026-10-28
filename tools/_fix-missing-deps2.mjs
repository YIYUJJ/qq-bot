import { readFileSync, writeFileSync } from 'node:fs'

// 1) http-api：补齐 import（fs / memory / autostart / roomcfg / ingest）
let h = readFileSync('lib/http-api.mjs', 'utf8')
const imports = [
  "import { existsSync, rmSync } from 'node:fs'",
  "import { graphPath, readRoomMemory, readRoomText, writeRoomFacts } from './memory.mjs'",
  "import { autostartFile, isAutostartEnabled, setAutostart, startupDir } from './autostart.mjs'",
  "import { countOverrides } from './roomcfg.mjs'",
  "import { normalizeEvent } from './ingest.mjs'",
]
let added = []
for (const line of imports) {
  if (!h.includes(line)) {
    const idx = h.indexOf("import { readFileSync } from 'node:fs'")
    h = h.slice(0, idx) + line + '\n' + h.slice(idx)
    added.push(line.split('{')[1].split('}')[0])
  }
}
// memDirOf 仍需注入：加进 API_DEPS
const dn = 'API_DEPS'
let deps = JSON.parse(h.match(new RegExp(dn + ' = (\\[[^\\]]*\\])'))[1])
if (!deps.includes('memDirOf')) {
  deps.push('memDirOf')
  deps.sort()
  h = h.replace(new RegExp(dn + ' = \\[[^\\]]*\\]'), dn + ' = ' + JSON.stringify(deps))
  h = h.replace(/const \{ [A-Z_]+[^}]*\} = deps/, (mm) => mm.replace(/\}$/, ', memDirOf }'))
  added.push('memDirOf(dep)')
}
writeFileSync('lib/http-api.mjs', h, 'utf8')
console.log('http-api 补 import：', added.join(' / '))

// 2) startup：补 renameSync
let st = readFileSync('lib/startup.mjs', 'utf8')
if (!st.includes("from 'node:fs'")) {
  st = st.replace("export const STARTUP_DEPS", "import { renameSync } from 'node:fs'\n\nexport const STARTUP_DEPS")
  writeFileSync('lib/startup.mjs', st, 'utf8')
  console.log('startup 补 renameSync')
}

// 3) index：memoryAuto / notes / http-api 的依赖补进调用
let idx = readFileSync('lib/index.js', 'utf8')
if (!idx.includes('readRoomMemory,') && idx.includes('const memoryAi = createMemoryAi({')) {
  idx = idx.replace('    readRoomText,', '    readRoomMemory, readRoomText,')
}
// notes：补 4 个
idx = idx.replace('const notes = createNotes({ config, log, stats, cfgFor })', 'const notes = createNotes({ config, log, stats, cfgFor, isManagedRoom, factsOf, addFact, delFact })')
// memory-auto：补 memDirOf / readRoomMemory
idx = idx.replace('const maybeAutoExtract = createMaybeAutoExtract({', 'const maybeAutoExtract = createMaybeAutoExtract({\n    memDirOf, readRoomMemory,')
// api：补 memDirOf
idx = idx.replace('    getService,\n  })', '    getService, memDirOf,\n  })')
writeFileSync('lib/index.js', idx, 'utf8')
console.log('index 调用参数已补')
