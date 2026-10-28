/**
 * 配置类型一致性检查：面板元数据 vs 后端默认配置/类型集合。
 * 这类不一致会导致"面板保存整页被拒"或"数字被存成字符串"。
 * 用法：node tools/audit-config-types.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_META } from '../lib/meta.mjs'
import { ROOM_KEYS } from '../lib/roomcfg.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')

function parseSet(name) {
  const m = src.match(new RegExp('const ' + name + ' = new Set\\(\\[([\\s\\S]*?)\\]\\)'))
  if (!m) return new Set()
  return new Set([...m[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((x) => x[1]))
}

const defaultBlock = src.slice(src.indexOf('const DEFAULT_CONFIG'), src.indexOf('const BOOLEAN'))
const defaults = new Set([...defaultBlock.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1]))
const BOOLEAN = parseSet('BOOLEAN')
const NUMERIC = parseSet('NUMERIC')
const LIST = parseSet('LIST')

const metaKeys = Object.keys(CONFIG_META)
const problems = []

// 1) 面板有、默认配置没有 → 保存会被判"未知配置项"，整页失败
for (const k of metaKeys) {
  if (!defaults.has(k)) problems.push({ level: 'high', key: k, msg: '面板有这个字段，但 DEFAULT_CONFIG 没有 → 保存会被拒（未知配置项）' })
}

// 2) 类型不匹配 → 存成字符串/布尔判断错
for (const [k, m] of Object.entries(CONFIG_META)) {
  if (m.type === 'number' && !NUMERIC.has(k)) {
    problems.push({ level: 'mid', key: k, msg: '面板是数字，但 NUMERIC 没有它 → 会按字符串存' })
  }
  if (m.type === 'bool' && !BOOLEAN.has(k)) {
    problems.push({ level: 'high', key: k, msg: '面板是开关，但 BOOLEAN 没有它 → "关"可能被存成字符串真值' })
  }
  if ((m.type === 'csv' || m.type === 'enum') && !LIST.has(k) && !BOOLEAN.has(k) && !NUMERIC.has(k)) {
    // enum/csv 不一定要在 LIST 里，仅提示
    if (m.type === 'csv') problems.push({ level: 'low', key: k, msg: '面板是逗号列表，但 LIST 没有它 → 不会被拆成数组' })
  }
}

// 3) 默认配置有、面板没有 → 界面上看不到（不是 bug，但值得知道）
const hidden = [...defaults].filter((k) => !metaKeys.includes(k))

// 4) 每群性格可覆盖的键，必须在面板元数据里有定义、在默认配置里存在
for (const k of ROOM_KEYS) {
  if (!CONFIG_META[k]) problems.push({ level: 'high', key: k, msg: 'ROOM_KEYS 里有它，但面板元数据没有 → 每群性格页渲染/保存会出问题' })
  else if (!defaults.has(k)) problems.push({ level: 'high', key: k, msg: 'ROOM_KEYS 里有它，但 DEFAULT_CONFIG 没有 → 覆盖保存会被拒' })
}

// 输出
const order = { high: 0, mid: 1, low: 2 }
problems.sort((a, b) => order[a.level] - order[b.level] || a.key.localeCompare(b.key))
console.log(`配置类型检查：元数据 ${metaKeys.length} 项 / 默认配置 ${defaults.size} 项`)
console.log('─'.repeat(78))
if (!problems.length) console.log('✅ 没有会导致保存失败/类型错误的项')
for (const p of problems) {
  const mark = p.level === 'high' ? '❌' : p.level === 'mid' ? '⚠️ ' : '·'
  console.log(`${mark} ${p.key.padEnd(24)} ${p.msg}`)
}
if (hidden.length) {
  console.log('\n仅默认配置、面板不显示（正常，供内部用）：' + hidden.join(', '))
}
process.exit(problems.some((p) => p.level === 'high') ? 1 : 0)
