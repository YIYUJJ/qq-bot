/**
 * 每群配置运行时：稀疏覆盖 + 合并后的 cfgFor（带版本缓存）+ 安静时段解析缓存。
 *
 * 覆盖对象在模块内维护，外部拿到的引用始终有效（replaceRoomOverrides 原地替换）。
 */
import { BOOLEAN, CONFIG_META, LIST, NUMERIC } from './schema.mjs'

export const ROOM_CONFIG_DEPS = ['config', 'countOverrides', 'filterRoomOverride', 'mergeRoomConfig', 'parseQuietWindows', 'readJson', 'roomsFile', 'writeJson']

export function createRoomConfig(deps) {
  const missing = ROOM_CONFIG_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('每群配置缺少依赖：' + missing.join(', '))
  const { config, countOverrides, filterRoomOverride, mergeRoomConfig, parseQuietWindows, readJson, roomsFile, writeJson } = deps

  const roomOverrides = readJson(roomsFile, {}) || {}
  if (!roomOverrides || typeof roomOverrides !== 'object' || Array.isArray(roomOverrides)) {
    // 文件坏了：清空（函数作用域内无法重新赋值 const 对象，直接删键）
    for (const k of Object.keys(roomOverrides)) delete roomOverrides[k]
  }
  let cfgVersion = 0
  const cfgCache = new Map()
  const quietCache = new Map()

  function getRoomOverrides() {
    return roomOverrides
  }

  /** 原地替换覆盖表：外部闭包持有的引用不会失效。 */
  function replaceRoomOverrides(next) {
    for (const k of Object.keys(roomOverrides)) delete roomOverrides[k]
    if (next && typeof next === 'object' && !Array.isArray(next)) Object.assign(roomOverrides, next)
    bumpCfg()
  }

  /** 某个群实际生效的配置：全局 + 该群覆盖（带版本缓存）。 */
  function cfgFor(roomId) {
    const key = String(roomId)
    const hit = cfgCache.get(key)
    if (hit && hit.v === cfgVersion) return hit.cfg
    const ov = roomOverrides[key]
    const cfg = ov ? mergeRoomConfig(config, ov) : config
    cfgCache.set(key, { v: cfgVersion, cfg })
    return cfg
  }

  function bumpCfg() {
    cfgVersion += 1
    cfgCache.clear()
  }

  /** 安静时段按 spec 字符串缓存，避免每条消息都重新解析。 */
  function quietWindowsFor(spec) {
    const k = String(spec || '')
    const hit = quietCache.get(k)
    if (hit) return hit
    const v = parseQuietWindows(k)
    quietCache.set(k, v)
    return v
  }

  function roomOverrideOf(roomId) {
    return roomOverrides[String(roomId)] || {}
  }

  /** 整份替换某群的覆盖（面板提交的就是"这个群要不要覆盖、覆盖成什么"）。 */
  function setRoomOverride(roomId, patch) {
    const key = String(roomId)
    const { applied, rejected } = filterRoomOverride(patch)
    const next = {}
    for (const [k, raw] of Object.entries(applied)) {
      let v = raw
      if (BOOLEAN.has(k)) v = raw === true || raw === 'true' || raw === 1 || raw === '1'
      else if (NUMERIC.has(k)) {
        v = Number(raw)
        if (!Number.isFinite(v)) {
          rejected[k] = '需要数字'
          continue
        }
        const m = CONFIG_META[k]
        if (m && typeof m.min === 'number' && v < m.min) v = m.min
        if (m && typeof m.max === 'number' && v > m.max) v = m.max
      } else if (LIST.has(k)) {
        v = Array.isArray(raw)
          ? raw.map((s) => String(s).trim()).filter(Boolean)
          : String(raw ?? '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
      } else if (typeof v !== 'string') v = String(v ?? '')
      next[k] = v
    }
    if (Object.keys(next).length) roomOverrides[key] = next
    else delete roomOverrides[key]
    writeJson(roomsFile, roomOverrides)
    bumpCfg()
    return { ok: Object.keys(applied).length > 0 || !Object.keys(patch || {}).length, applied: next, rejected, count: countOverrides(next) }
  }

  function resetRoomOverride(roomId) {
    delete roomOverrides[String(roomId)]
    writeJson(roomsFile, roomOverrides)
    bumpCfg()
    return { ok: true, count: 0 }
  }

  return {
    cfgFor,
    bumpCfg,
    quietWindowsFor,
    roomOverrideOf,
    setRoomOverride,
    resetRoomOverride,
    getRoomOverrides,
    replaceRoomOverrides,
  }
}
