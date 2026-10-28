/**
 * 把 index.js 里的 DEFAULT_CONFIG 抽出来，作为 schema 的默认值来源。
 * 只读，不改文件。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync('lib/index.js', 'utf8')
const start = src.indexOf('const DEFAULT_CONFIG = {')
if (start < 0) throw new Error('找不到 DEFAULT_CONFIG')
// 从 { 开始做括号计数，跳过字符串与注释
let i = src.indexOf('{', start)
let depth = 0
let inStr = null
let inLine = false
let inBlock = false
let end = -1
for (let p = i; p < src.length; p++) {
  const c = src[p]
  const n = src[p + 1]
  if (inLine) {
    if (c === '\n') inLine = false
    continue
  }
  if (inBlock) {
    if (c === '*' && n === '/') {
      inBlock = false
      p++
    }
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
  if (c === '/' && n === '*') {
    inBlock = true
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
if (end < 0) throw new Error('括号没配对')
const literal = src.slice(i, end + 1)
// 去掉注释后再 eval（行尾 // 注释 eval 没问题，块注释也合法）
const obj = new Function('return (' + literal + ')')()
const keys = Object.keys(obj)
writeFileSync('tools/_defaults.json', JSON.stringify(obj, null, 2), 'utf8')
console.log('DEFAULT_CONFIG 键数:', keys.length)
console.log(keys.slice(0, 8).join(', '), '...')
