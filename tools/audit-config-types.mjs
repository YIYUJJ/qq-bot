/**
 * 配置 schema 一致性检查。
 * 现在 schema 是唯一真相，这里主要防"实现漂移"：
 *   1. 每个 meta 字段都有 default
 *   2. 数字/布尔/csv 类型都在对应集合里
 *   3. ROOM_KEYS 都在 meta 里且有 default
 *   4. 默认值类型与 meta.type 吻合
 * 用法：node tools/audit-config-types.mjs
 */
import { CONFIG_META, CONFIG_KEYS, DEFAULT_CONFIG, BOOLEAN, NUMERIC, LIST, ROOM_KEYS } from '../lib/schema.mjs'

const problems = []

for (const k of CONFIG_KEYS) {
  const m = CONFIG_META[k]
  if (m.default === undefined) problems.push({ level: 'high', key: k, msg: 'meta 缺 default → 默认配置不完整' })
  if (!m.group) problems.push({ level: 'mid', key: k, msg: 'meta 缺 group → 面板不显示' })
  if (m.type === 'number' && !NUMERIC.has(k)) problems.push({ level: 'high', key: k, msg: 'number 类型不在 NUMERIC' })
  if (m.type === 'bool' && !BOOLEAN.has(k)) problems.push({ level: 'high', key: k, msg: 'bool 类型不在 BOOLEAN' })
  if (m.type === 'csv' && !LIST.has(k)) problems.push({ level: 'high', key: k, msg: 'csv 类型不在 LIST' })
}

for (const k of ROOM_KEYS) {
  if (!CONFIG_META[k]) problems.push({ level: 'high', key: k, msg: 'ROOM_KEYS 里有它，但 meta 没有 → 每群性格会出问题' })
  else if (!(k in DEFAULT_CONFIG)) problems.push({ level: 'high', key: k, msg: 'ROOM_KEYS 里有它，但默认配置没有' })
}

for (const k of CONFIG_KEYS) {
  const m = CONFIG_META[k]
  const v = DEFAULT_CONFIG[k]
  if (m.type === 'bool' && typeof v !== 'boolean') problems.push({ level: 'high', key: k, msg: 'bool 字段默认值不是布尔' })
  if (m.type === 'number' && typeof v !== 'number') problems.push({ level: 'high', key: k, msg: 'number 字段默认值不是数字' })
  if (m.type === 'csv' && !Array.isArray(v)) problems.push({ level: 'high', key: k, msg: 'csv 字段默认值不是数组' })
}

const order = { high: 0, mid: 1, low: 2 }
problems.sort((a, b) => order[a.level] - order[b.level] || a.key.localeCompare(b.key))
console.log(`配置 schema：${CONFIG_KEYS.length} 项 / 可按群覆盖 ${ROOM_KEYS.length} 项 / 布尔 ${BOOLEAN.size} / 数字 ${NUMERIC.size} / 列表 ${LIST.size}`)
console.log('─'.repeat(78))
if (!problems.length) console.log('✅ schema 自洽：默认值、类型、房间键全部一致')
for (const p of problems) console.log(`${p.level === 'high' ? '❌' : '⚠️ '} ${p.key.padEnd(24)} ${p.msg}`)
process.exit(problems.some((p) => p.level === 'high') ? 1 : 0)
