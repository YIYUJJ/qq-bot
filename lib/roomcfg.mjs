/**
 * 每群性格覆盖 —— 稀疏覆盖 + 继承全局。
 *
 * 设计约束：
 *   1. 只允许"表达层"参数被覆盖；总开关/白名单/模型路由/接入地址一律不可覆盖（安全边界）。
 *   2. 存的是稀疏覆盖（只存跟全局不一样的键），没覆盖的键永远跟着全局走。
 *   3. 合并结果按 roomId 缓存，配置变更时用版本号整体失效。
 */

/**
 * 允许按群覆盖的键 —— 由 schema 从 meta.room 派生（单一真相）。
 * 只允许"表达层"参数：总开关/白名单/模型路由/接入地址永远不可按群覆盖。
 */
export { ROOM_KEYS, ROOM_KEY_SET } from './schema.mjs'
import { ROOM_KEYS, ROOM_KEY_SET } from './schema.mjs'

/** 把全局配置和某群覆盖合并成"这个群实际生效的配置"。 */
export function mergeRoomConfig(base, override) {
  if (!override || typeof override !== 'object') return base
  const out = { ...base }
  for (const k of ROOM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(override, k)) out[k] = override[k]
  }
  return out
}

/**
 * 过滤一份"想写进去的覆盖"：只留允许的键，其余进 rejected。
 * @returns {{ok:boolean, applied:object, rejected:object}}
 */
export function filterRoomOverride(patch, { allowed = ROOM_KEY_SET } = {}) {
  const applied = {}
  const rejected = {}
  for (const [k, v] of Object.entries(patch || {})) {
    if (!allowed.has(k)) {
      rejected[k] = '该参数不支持按群覆盖'
      continue
    }
    applied[k] = v
  }
  return { ok: Object.keys(rejected).length === 0, applied, rejected }
}

/** 该群覆盖了几项（面板用来显示"自定义 N 项"）。 */
export function countOverrides(override) {
  if (!override || typeof override !== 'object') return 0
  return ROOM_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(override, k)).length
}
