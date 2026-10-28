import { readFileSync, writeFileSync } from 'node:fs'

const deps = ['CONFIG_FILE', 'LOG_FILE', 'MEMORY_DIR', 'STICKERS_FILE', 'config', 'facts', 'features', 'groupNames', 'healthCache', 'log', 'roomSnapshot', 'rooms', 'stats', 'stickers', 'usage', 'usageView', 'version', 'DEFAULT_CONFIG', 'publicMeta', 'GROUPS', 'FEATURES', 'ob']

let m = readFileSync('lib/panel-state.mjs', 'utf8')
if (!m.includes("from 'node:fs'")) {
  m = m.replace(
    'export const PANEL_STATE_DEPS',
    "import { existsSync, statSync } from 'node:fs'\nimport { dirname, join } from 'node:path'\nimport { fileURLToPath } from 'node:url'\n\nexport const PANEL_STATE_DEPS",
  )
}
m = m.replace(/export const PANEL_STATE_DEPS = \[[^\]]*\]/, 'export const PANEL_STATE_DEPS = ' + JSON.stringify(deps))
m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
writeFileSync('lib/panel-state.mjs', m, 'utf8')

let i = readFileSync('lib/index.js', 'utf8')
if (!i.includes('version, DEFAULT_CONFIG, publicMeta, GROUPS, FEATURES, ob,')) {
  i = i.replace('const panelState = createPanelState({', 'const panelState = createPanelState({\n    version, DEFAULT_CONFIG, publicMeta, GROUPS, FEATURES, ob,')
  writeFileSync('lib/index.js', i, 'utf8')
}
console.log('panel-state 依赖与 index 工厂参数已补全')
