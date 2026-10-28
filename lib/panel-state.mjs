/**
 * 面板数据（/api/state 的 body）拼装。
 *
 * 依赖注入：config / rooms / stats / stickers / facts / features / groupNames / usage
 *           roomSnapshot / usageView / healthCache / 路径常量 / log。
 */
import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
