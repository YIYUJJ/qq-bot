/**
 * 生成 lib/schema.mjs：唯一真相。
 * 同时把 default / type 标记写回 meta.mjs（meta 变成"字段定义表"）。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const defaults = JSON.parse(readFileSync('tools/_defaults.json', 'utf8'))
const metaPath = 'lib/meta.mjs'
let meta = readFileSync(metaPath, 'utf8')

// ── 1) 找到 CONFIG_META 里每个顶层条目，补 default / room / hidden ──
const roomKeysSrc = readFileSync('lib/roomcfg.mjs', 'utf8')
const roomSection = roomKeysSrc.slice(roomKeysSrc.indexOf('export const ROOM_KEYS = ['), roomKeysSrc.indexOf(']', roomKeysSrc.indexOf('export const ROOM_KEYS = [')))
const roomKeys = [...roomSection.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1])

const metaStart = meta.indexOf('export const CONFIG_META = {')
if (metaStart < 0) throw new Error('找不到 CONFIG_META')
let i = meta.indexOf('{', metaStart)
let depth = 0
let inStr = null
let inLine = false
let end = -1
for (let p = i; p < meta.length; p++) {
  const c = meta[p]
  const n = meta[p + 1]
  if (inLine) {
    if (c === '\n') inLine = false
    continue
  }
  if (inStr) {
    if (c === '\\') {
      p++
      continue
    }
    if (c === inStr) inStr = null
    continue
  }
  if (c === '/' && n === '/') {
    inLine = true
    p++
    continue
  }
  if (c === "'" || c === '"' || c === '`') {
    inStr = c
    continue
  }
  if (c === '{') depth++
  else if (c === '}') {
    depth--
    if (depth === 0) {
      end = p
      break
    }
  }
}
const body = meta.slice(i + 1, end)

// 顶层条目：两个空格缩进 + key: {
const entryRe = /(^|\n)  ([A-Za-z_][A-Za-z0-9_]*): \{/g
const entries = []
let mm
while ((mm = entryRe.exec(body))) entries.push({ key: mm[2], at: mm.index + mm[1].length })

let out = body
// 从后往前改，避免索引位移
for (let k = entries.length - 1; k >= 0; k--) {
  const { key, at } = entries[k]
  // 找到这个条目的结束（下一个顶层条目前）
  const nextAt = k + 1 < entries.length ? entries[k + 1].at : body.length
  let seg = body.slice(at, nextAt)
  const hasDefault = /(^|\s)default:/.test(seg)
  if (!hasDefault) {
    if (!(key in defaults)) {
      console.log('⚠️ meta 有但 defaults 没有：' + key)
    } else {
      const dv = JSON.stringify(defaults[key])
      // 插在 type: '...' 之后；没有 type 就插在 { 之后
      if (/type: '[^']*',/.test(seg)) seg = seg.replace(/(type: '[^']*',)/, `$1 default: ${dv},`)
      else seg = seg.replace(/\{/, `{ default: ${dv},`)
    }
  }
  if (roomKeys.includes(key) && !/(^|\s)room:/.test(seg)) {
    seg = seg.replace(/(type: '[^']*',)/, '$1 room: true,')
  }
  out = out.slice(0, at) + seg + out.slice(nextAt)
}
meta = meta.slice(0, i + 1) + out + meta.slice(end)
writeFileSync(metaPath, meta, 'utf8')
console.log('meta: 已补 default/room')

// ── 2) 补 hidden 键（默认配置里有、面板不显示的）──
const metaKeysNow = new Set([...meta.matchAll(/^  ([A-Za-z_][A-Za-z0-9_]*): \{/gm)].map((m) => m[1]))
const hiddenKeys = Object.keys(defaults).filter((k) => !metaKeysNow.has(k))
if (hiddenKeys.length) {
  const block = '\n  // ── 内部键（面板不显示，但属于配置 schema）──\n' +
    hiddenKeys.map((k) => `  ${k}: { group: 'internal', label: '${k}', type: '${typeof defaults[k] === 'boolean' ? 'bool' : typeof defaults[k] === 'number' ? 'number' : Array.isArray(defaults[k]) ? 'csv' : 'text'}', default: ${JSON.stringify(defaults[k])}, hidden: true },`).join('\n') + '\n'
  const insertAt = meta.lastIndexOf('\n}', meta.indexOf('export const CONFIG_META'))
  meta = meta.slice(0, insertAt) + block + meta.slice(insertAt)
  writeFileSync(metaPath, meta, 'utf8')
  console.log('meta: 补 hidden 键', hiddenKeys.join(', '))
}
