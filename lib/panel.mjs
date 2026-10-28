import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 面板数据（/api/state 的 body）拼装。
 *
 * 依赖注入：config / rooms / stats / stickers / facts / features / groupNames / usage
 *           roomSnapshot / usageView / healthCache / 路径常量 / log。
 */

export const PANEL_STATE_DEPS = ["CONFIG_FILE","LOG_FILE","MEMORY_DIR","STICKERS_FILE","config","facts","features","groupNames","healthCache","log","roomSnapshot","rooms","stats","stickers","usage","usageView","version","DEFAULT_CONFIG","publicMeta","GROUPS","FEATURES","ob"]

export function createPanelState(deps) {
  const missing = PANEL_STATE_DEPS.filter((k) => deps[k] === undefined && k !== 'healthCache')
  if (missing.length) throw new Error('面板数据缺少依赖：' + missing.join(', '))
  const { CONFIG_FILE, LOG_FILE, MEMORY_DIR, STICKERS_FILE, config, facts, features, groupNames, healthCache, log, roomSnapshot, rooms, stats, stickers, usage, usageView, version, DEFAULT_CONFIG, publicMeta, GROUPS, FEATURES, ob } = deps

  function panelState() {
    return {
      ok: true,
      at: Date.now(),
      version,
      // 面板构建时间：用来判断浏览器是不是缓存了旧 UI（"按钮不见了"多半是这个）
      panelBuiltAt: (() => {
        try {
          const f = join(dirname(fileURLToPath(import.meta.url)), 'client.js')
          return existsSync(f) ? statSync(f).mtimeMs : 0
        } catch {
          return 0
        }
      })(),
      config,
      defaults: DEFAULT_CONFIG,
      meta: publicMeta(),
      groups: GROUPS,
      features: FEATURES,
      stats: { ...stats },
      connection: { ...ob.status },
      health: healthCache,
      usage: usageView(),
      rooms: [...rooms.values()].map(roomSnapshot),
      stickers: (() => {
        let good = 0
        let bad = 0
        for (const k in stickers) {
          if (stickers[k]?.bad) bad += 1
          else good += 1
        }
        return { count: good, total: good + bad, bad }
      })(),
      names: { known: [...rooms.values()].reduce((n, r) => n + r.nameCache.size, 0), groups: groupNames.size },
      paths: { config: CONFIG_FILE, log: LOG_FILE, facts: MEMORY_DIR, stickers: STICKERS_FILE },
      allowGroups: config.allowGroups,
    }
  }

  return panelState
}

/**
 * 面板「群与人」页的单房间快照（带签名缓存，状态没变就不重建对象）。
 *
 * 依赖注入：factsOf / countOverrides / roomOverrideOf / allowedHere / cfgFor / config / panelRoomCache。
 */
export const ROOM_SNAPSHOT_DEPS = ['factsOf', 'countOverrides', 'roomOverrideOf', 'allowedHere', 'cfgFor', 'config', 'panelRoomCache']

export function createRoomSnapshot(deps) {
  const missing = ROOM_SNAPSHOT_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('房间快照缺少依赖：' + missing.join(', '))
  const { factsOf, countOverrides, roomOverrideOf, allowedHere, cfgFor, config, panelRoomCache } = deps

  function roomSnapshot(r) {
    const now = Date.now()
    const factsN = factsOf(r.roomId).length
    const ovN = countOverrides(roomOverrideOf(r.roomId))
    const replies10m = r.replyTimes.filter((t) => now - t < 600000).length
    const sig = [
      r.lastActivityAt, r.msgs.length, replies10m, r.lastReplyAt, factsN, ovN,
      r.lastDecision?.at || 0, r.muteUntil || 0, r.msgSinceExtract || 0, r.streak || 0,
      r.roomName || '', allowedHere(r) ? 1 : 0,
      Number(cfgFor(r.roomId).memoryExtractEvery) || 0, cfgFor(r.roomId).memoryExtract ? 1 : 0,
    ].join('|')
    const hit = panelRoomCache.get(r.roomId)
    if (hit && hit.sig === sig) return hit.obj
    const obj = {
      roomId: r.roomId,
      roomName: r.roomName,
      isGroup: r.isGroup,
      allowed: allowedHere(r),
      msgs: r.msgs.length,
      facts: factsN,
      memory: {
        sinceExtract: r.msgSinceExtract || 0,
        every: Number(cfgFor(r.roomId).memoryExtractEvery) || 30,
        lastExtractAt: r.lastExtractAt || 0,
        auto: !!cfgFor(r.roomId).memoryExtract,
      },
      lastActivityAt: r.lastActivityAt,
      lastReplyAt: r.lastReplyAt,
      proactiveStreak: r.streak || 0,
      decision: r.lastDecision,
      overrideCount: ovN,
      policy: {
        replies10m,
        maxRepliesPer10Min: Number(config.maxRepliesPer10Min) || 0,
      },
      recent: r.msgs.slice(-8).map((m) => ({
        ts: m.ts,
        isSelf: m.isSelf,
        who: m.isSelf ? '我' : m.senderName,
        text: m.text,
      })),
    }
    panelRoomCache.set(r.roomId, { sig, obj })
    return obj
  }

  return roomSnapshot
}
