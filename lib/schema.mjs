/**
 * 配置 schema —— 唯一真相。
 *
 * 所有"配置项清单"都从这里派生，不再分散在 index.js / roomcfg.mjs：
 *   DEFAULT_CONFIG  默认值（meta.default）
 *   CONFIG_KEYS     全部键
 *   BOOLEAN/NUMERIC/LIST  类型集合（面板保存与每群覆盖都用它做转换）
 *   ROOM_KEYS       可按群覆盖的键（meta.room）
 *
 * 加一个配置项：只在 meta.mjs 写一条（含 default / type / room），其余自动生效。
 */
import { CONFIG_META } from './meta.mjs'

export const CONFIG_KEYS = Object.keys(CONFIG_META)
export { CONFIG_META }

export const DEFAULT_CONFIG = Object.fromEntries(CONFIG_KEYS.map((k) => [k, CONFIG_META[k].default]))

export const BOOLEAN = new Set(CONFIG_KEYS.filter((k) => CONFIG_META[k].type === 'bool'))
export const NUMERIC = new Set(CONFIG_KEYS.filter((k) => CONFIG_META[k].type === 'number'))
export const LIST = new Set(CONFIG_KEYS.filter((k) => CONFIG_META[k].type === 'csv'))
export const ROOM_KEYS = CONFIG_KEYS.filter((k) => CONFIG_META[k].room === true)
export const ROOM_KEY_SET = new Set(ROOM_KEYS)

function clampNumber(k, v) {
  const m = CONFIG_META[k] || {}
  let n = Number(v)
  if (!Number.isFinite(n)) return null
  if (typeof m.min === 'number' && n < m.min) n = m.min
  if (typeof m.max === 'number' && n > m.max) n = m.max
  return n
}

function asList(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
  return []
}

/**
 * 校验一份外部配置（config.json / cordis row config）：
 * - 未知键丢弃（并记一条 warning）
 * - 类型按 meta 强制转换（bool/number/csv）
 * - 数字按 min/max 夹取
 * 永远返回可用的配置对象，不抛错。
 * @returns {{ config: object, warnings: string[] }}
 */
export function validateConfig(raw) {
  const config = { ...DEFAULT_CONFIG }
  const warnings = []
  if (!raw || typeof raw !== 'object') return { config, warnings }
  for (const [k, v] of Object.entries(raw)) {
    const m = CONFIG_META[k]
    if (!m) {
      warnings.push(`忽略未知配置项 ${k}`)
      continue
    }
    if (BOOLEAN.has(k)) {
      config[k] = v === true || v === 'true' || v === 1 || v === '1'
    } else if (NUMERIC.has(k)) {
      const n = clampNumber(k, v)
      if (n == null) {
        warnings.push(`配置项 ${k} 不是数字，已用默认值`)
      } else {
        config[k] = n
      }
    } else if (LIST.has(k)) {
      config[k] = asList(v)
    } else {
      config[k] = typeof v === 'string' ? v : String(v ?? '')
    }
  }
  return { config, warnings }
}
