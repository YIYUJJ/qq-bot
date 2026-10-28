import { CONFIG_META } from '../lib/meta.mjs'
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync('C:/Users/22371/.dsh/qq-bot/config.json', 'utf8'))
const fmtBytes = (n) => {
  const b = Math.abs(Number(n) || 0)
  if (b >= 1073741824) return (Math.round((b / 1073741824) * 10) / 10) + ' GB'
  if (b >= 1048576) return (Math.round((b / 1048576) * 100) / 100) + ' MB'
  if (b >= 1024) return (Math.round((b / 1024) * 100) / 100) + ' KB'
  return b + ' 字节'
}
const hint = (k, v, m) => {
  const n = Number(v)
  if (v == null || v === '' || !Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  if (m && (m.unit === '毫秒' || /Ms$/.test(k) || m.scale)) {
    if (abs < 1000) return '≈ ' + (Math.round(n * 10) / 10) + ' 毫秒'
    if (abs < 60000) return '≈ ' + (Math.round((n / 1000) * 10) / 10) + ' 秒'
    if (abs < 3600000) return '≈ ' + (Math.round((n / 60000) * 10) / 10) + ' 分钟'
    return '≈ ' + (Math.round((n / 3600000) * 10) / 10) + ' 小时'
  }
  if (m && m.unit === '秒') {
    if (abs < 60) return '= ' + n + ' 秒'
    if (abs < 3600) return '≈ ' + (Math.round((n / 60) * 10) / 10) + ' 分钟'
    return '≈ ' + (Math.round((n / 3600) * 10) / 10) + ' 小时'
  }
  if (m && (m.unit === '字节' || /Bytes$/.test(k))) return '≈ ' + fmtBytes(n)
  if (m && m.unit === 'MB') return abs >= 1024 ? '≈ ' + (Math.round((n / 1024) * 10) / 10) + ' GB' : '= ' + n + ' MB'
  if (m && m.min === 0 && m.max === 1) return (Math.round(n * 1000) / 10) + '%'
  if (abs >= 100000000) return '≈ ' + (n / 100000000).toFixed(1).replace(/\.0$/, '') + ' 亿'
  if (abs >= 10000) return '≈ ' + (n / 10000).toFixed(1).replace(/\.0$/, '') + ' 万'
  if (abs >= 1000) return '= ' + n.toLocaleString('zh-CN')
  return m && m.unit ? '= ' + n + ' ' + m.unit : '= ' + n
}

const empty = []
const samples = []
for (const [k, m] of Object.entries(CONFIG_META)) {
  if (m.type !== 'number') continue
  const v = cfg[k] != null ? cfg[k] : m.min != null ? m.min : 1
  const h = hint(k, v, m)
  if (!h) empty.push(k)
  else samples.push(k + ' = ' + v + ' → ' + h)
}
console.log('数字字段总数:', Object.values(CONFIG_META).filter((x) => x.type === 'number').length)
console.log('右侧为空:', empty.length, empty.join(', '))
console.log('样例:'); samples.slice(0, 12).forEach((s) => console.log('  ' + s))
