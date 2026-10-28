import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'

const defaults = JSON.parse(readFileSync('tools/_defaults.json', 'utf8'))
const metaPath = 'lib/meta.mjs'
let meta = readFileSync(metaPath, 'utf8')

const metaKeysNow = new Set([...meta.matchAll(/^  ([A-Za-z_][A-Za-z0-9_]*): \{/gm)].map((m) => m[1]))
const hiddenKeys = Object.keys(defaults).filter((k) => !metaKeysNow.has(k))
if (!hiddenKeys.length) {
  console.log('没有需要补的 hidden 键')
  process.exit(0)
}
const block =
  '\n  // ── 内部键（面板不显示，但属于配置 schema）──\n' +
  hiddenKeys
    .map((k) => {
      const t = typeof defaults[k] === 'boolean' ? 'bool' : typeof defaults[k] === 'number' ? 'number' : Array.isArray(defaults[k]) ? 'csv' : 'text'
      return `  ${k}: { group: 'internal', label: '${k}', type: '${t}', default: ${JSON.stringify(defaults[k])}, hidden: true },`
    })
    .join('\n') +
  '\n'

const idx = meta.indexOf('export const CONFIG_META = {')
const close = meta.lastIndexOf('\n}', meta.lastIndexOf('}', meta.length))
// 直接找 CONFIG_META 块的结束：从块开始做括号计数
let i = meta.indexOf('{', idx)
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
if (end < 0) throw new Error('找不到 CONFIG_META 结束')
const updated = meta.slice(0, end) + block + meta.slice(end)
const tmp = metaPath + '.tmp'
writeFileSync(tmp, updated, 'utf8')
try {
  unlinkSync(metaPath)
} catch {
  /* ignore */
}
renameSync(tmp, metaPath)
console.log('补 hidden 键:', hiddenKeys.join(', '))
