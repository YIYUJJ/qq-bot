import { readFileSync } from 'node:fs'
import { DEFAULT_CONFIG, CONFIG_KEYS, BOOLEAN, NUMERIC, LIST, ROOM_KEYS } from '../lib/schema.mjs'

const src = readFileSync('lib/index.js', 'utf8')
function oldSet(name) {
  const m = src.match(new RegExp('const ' + name + ' = new Set\\(\\[([\\s\\S]*?)\\]\\)'))
  if (!m) return new Set()
  return new Set([...m[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((x) => x[1]))
}
const oldNum = oldSet('NUMERIC')
const oldBool = oldSet('BOOLEAN')
const oldList = oldSet('LIST')

const diff = (a, b, label) => {
  const onlyA = [...a].filter((x) => !b.has(x))
  const onlyB = [...b].filter((x) => !a.has(x))
  console.log(label, '仅旧:', onlyA.join(',') || '-', '| 仅新:', onlyB.join(',') || '-')
}
diff(oldNum, NUMERIC, 'NUMERIC')
diff(oldBool, BOOLEAN, 'BOOLEAN')
diff(oldList, LIST, 'LIST')

const oldDefaults = src.match(/const DEFAULT_CONFIG = \{[\s\S]*?\n\}/)
console.log('新 schema 键数:', CONFIG_KEYS.length, '| 新 ROOM_KEYS:', ROOM_KEYS.length)
console.log('DEFAULT 里类型异常:', CONFIG_KEYS.filter((k) => DEFAULT_CONFIG[k] === undefined).length)
