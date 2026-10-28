import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

// 1) 删掉 DEFAULT_CONFIG 块（94..246）与三个集合 + CONFIG_KEYS（248..270）
const defStart = lines.findIndex((l) => l.startsWith('const DEFAULT_CONFIG = {'))
const defEnd = lines.findIndex((l, i) => i > defStart && l === '}')
if (defStart < 0 || defEnd < 0) throw new Error('找不到 DEFAULT_CONFIG 边界')
const afterDef = defEnd + 1
if (!lines[afterDef].trim().startsWith('const CONFIG_KEYS')) throw new Error('结构不符合预期')
let lastSet = afterDef
while (lastSet < lines.length && !lines[lastSet].startsWith('export function apply(')) lastSet++
// 保留 export function apply 行
lines = [...lines.slice(0, defStart), ...lines.slice(lastSet)]

// 2) 加 schema 导入（放在 meta 导入之后）
const metaImport = lines.findIndex((l) => l.includes("from './meta.mjs'"))
if (metaImport < 0) throw new Error('找不到 meta 导入')
lines.splice(metaImport + 1, 0, "import { DEFAULT_CONFIG, CONFIG_KEYS, BOOLEAN, NUMERIC, LIST, ROOM_KEYS, validateConfig } from './schema.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('index.js: 删除本地配置定义，改用 schema（行数', lines.length, '）')
