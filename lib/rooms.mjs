import { BOOLEAN, CONFIG_META, LIST, NUMERIC } from './schema.mjs'

/**
 * 每群配置运行时：稀疏覆盖 + 合并后的 cfgFor（带版本缓存）+ 安静时段解析缓存。
 *
 * 覆盖对象在模块内维护，外部拿到的引用始终有效（replaceRoomOverrides 原地替换）。
 */

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

/**
 * 会话运行时状态：按需创建 room 对象，并把"已回复 id / 成员显示名"装回去。
 */
export const ROOM_STATE_DEPS = ['groupNames', 'replied', 'rooms', 'savedNames']

export function createRoomState(deps) {
  const missing = ROOM_STATE_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('会话状态缺少依赖：' + missing.join(', '))
  const { groupNames, replied, rooms, savedNames } = deps

  function roomState(roomId, roomName) {
    const key = String(roomId)
    let r = rooms.get(key)
    if (!r) {
      r = {
        roomId: key,
        roomName: roomName || groupNames.get(key) || '',
        isGroup: key.length > 8,
        msgs: [],
        pending: [],
        timer: null,
        replyTimes: [],
        lastReplyAt: 0,
        lastActivityAt: 0,
        lastProactiveAt: 0,
        lastDecision: null,
        lastSender: '',
        streak: 0,
        nameCache: new Map(),
        seen: new Set(),
        flushing: false,
        lastSearchAt: 0,
        muteUntil: 0,
        mood: { name: '', at: 0, intensity: 0 }, // 情绪状态（困/馋/得意/委屈…）
        lineTarget: 0, // 这次回复打算说几句（长度浮动用）
        replyCharsCap: 0, // 这次回复的字数上限（跟着句数走）
      }
      // 重启后把"已回复过的消息 id"装回去，避免对同一条再回一遍
      for (const x of replied[key] || []) if (x?.id) r.seen.add(String(x.id))
      // 面板里保存过的成员显示名也装回去
      for (const [uid, nm] of Object.entries(savedNames[key] || {})) {
        if (uid && nm) r.nameCache.set(String(uid), String(nm))
      }
      rooms.set(key, r)
    }
    if (roomName && !r.roomName) r.roomName = roomName
    return r
  }

  return { roomState }
}

/**
 * 访问控制：白名单闸（群/私聊）+ 必回判定。
 *
 * 所有发送路径都必须先过 isAllowedGroup / allowedHere，这里是唯一来源。
 */
export const ACCESS_DEPS = ['config', 'getCfgFor']

export function createAccess(deps) {
  const { config, getCfgFor } = deps
  if (!config) throw new Error('访问控制缺少 config')

  function isAllowedGroup(roomId) {
    return config.allowGroups.includes(String(roomId))
  }

  function assertGroupAllowed(roomId) {
    if (!isAllowedGroup(roomId)) {
      throw new Error(`群 ${roomId} 不在白名单（当前只允许：${config.allowGroups.join(', ') || '无'}）`)
    }
  }

  function allowedHere(r) {
    if (r.isGroup) return isAllowedGroup(r.roomId)
    // 私聊：白名单 + 管理员都算允许（管理员不必再单独加一遍）
    return config.allowPrivate.includes(r.roomId) || config.adminQQ.includes(String(r.roomId))
  }

  /** 这条消息是不是"必须回"：私聊管理员，或该群开了必回。 */
  function mustReply(r, sender) {
    if (!r.isGroup) return config.adminQQ.includes(String(sender ?? r.roomId))
    return !!getCfgFor()(r.roomId).alwaysReply
  }

  return { isAllowedGroup, assertGroupAllowed, allowedHere, mustReply }
}
