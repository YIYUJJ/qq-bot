import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

const defStart = lines.findIndex((l) => l.startsWith('const DEFAULT_CONFIG = {'))
const cfgKeys = lines.findIndex((l) => l.startsWith('const CONFIG_KEYS ='))
if (defStart < 0 || cfgKeys < 0) throw new Error('找不到边界')
// DEFAULT_CONFIG 的结束 = CONFIG_KEYS 之前最后一个 '}' 行
let defEnd = -1
for (let i = cfgKeys - 1; i > defStart; i--) {
  if (lines[i] === '}') {
    defEnd = i
    break
  }
}
if (defEnd < 0) throw new Error('找不到结束大括号')

// 删除范围：defStart .. apply 之前（包含 CONFIG_KEYS / BOOLEAN / NUMERIC / LIST）
let applyLine = lines.findIndex((l) => l.startsWith('export function apply('))
if (applyLine < 0) throw new Error('找不到 apply')
lines = [...lines.slice(0, defStart), ...lines.slice(applyLine)]

const metaImport = lines.findIndex((l) => l.includes("from './meta.mjs'"))
if (metaImport < 0) throw new Error('找不到 meta 导入')
lines.splice(metaImport + 1, 0, "import { DEFAULT_CONFIG, CONFIG_KEYS, BOOLEAN, NUMERIC, LIST, ROOM_KEYS, validateConfig } from './schema.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('index.js: 删除本地配置定义，改用 schema（行数', lines.length, '）')
