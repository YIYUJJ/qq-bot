/**
 * 状态容器：持久化对象（记忆/图库/用量/去重/名字/重发队列）的构造。
 *
 * 从 index.js 抽出：这些对象互相引用，集中在一处创建，再整体交给装配代码。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createStickerStore } from './sticker-store.mjs'
import { createStateStore } from './state-store.mjs'
import { openStateDb } from './state-db.mjs'
import { Outbox } from './outbox.mjs'

export const STATE_INIT_DEPS = ['DATA_DIR', 'config', 'isAllowedGroup', 'log', 'mediaKey', 'getOb', 'shouldRetrySend', 'stats', 'writeJson']

export function createStateInit(deps) {
  const missing = STATE_INIT_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('状态初始化缺少依赖：' + missing.join(', '))
  const { DATA_DIR, config, isAllowedGroup, log, mediaKey, getOb, shouldRetrySend, stats, writeJson } = deps

  function readJson(file, fallback) {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return fallback
    }
  }

  function hashStr(s) {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
    return h
  }

  const FACTS_FILE = join(DATA_DIR, 'facts.json')
  const STICKERS_FILE = join(DATA_DIR, 'stickers.json')
  const USAGE_FILE = join(DATA_DIR, 'usage.json')
  const REPLIED_FILE = join(DATA_DIR, 'replied.json')
  const NAMES_FILE = join(DATA_DIR, 'names.json')
  const MEMORY_DIR = join(DATA_DIR, 'memory')
  const STICKER_DIR = join(DATA_DIR, 'stickers')
  const OUTBOX_FILE = join(DATA_DIR, 'outbox.json')

  const facts = {} // roomId -> [{text, at}]（懒加载自各自的文件夹）
  const stickers = readJson(STICKERS_FILE, {}) // id -> {url, from, at, uses}
  const stickerStore = createStickerStore({ stickers, file: STICKERS_FILE, config, writeJson, hashStr, mediaKey, log })
  const { markStickersDirty, flushStickersNow, rememberSticker } = stickerStore

  const usage = readJson(USAGE_FILE, { total: 0, prompt: 0, completion: 0, calls: 0, byDay: {} })
  const replied = readJson(REPLIED_FILE, {}) // 回复过的消息 id（跨重启去重）
  const savedNames = readJson(NAMES_FILE, {}) // 面板里改过的群成员显示名

  const stateStore = createStateStore({ replied, usage, repliedFile: REPLIED_FILE, usageFile: USAGE_FILE, writeJson, log })
  const { flushStateNow, markStateDirty, recordReplied, alreadyReplied, noteUsage, usageView } = stateStore

  // 状态库（SQLite）：可用就接管 replied/usage，不可用继续用 JSON
  void (async () => {
    try {
      const db = await openStateDb(join(DATA_DIR, 'state.db'))
      stateStore.attachDb(db)
    } catch (e) {
      log('状态库初始化失败（继续用 JSON）：' + String(e?.message || e))
    }
  })()

  const outbox = new Outbox({
    load: () => readJson(OUTBOX_FILE, []),
    save: (items) => writeJson(OUTBOX_FILE, items),
    deliver: (item) => deliverOutboxItem(item),
    log,
  })

  /** 统一的"发出去，失败就排队"入口：工具和面板都走它。 */
  async function sendWithRetry(roomId, isGroup, kind, payload) {
    try {
      if (kind === 'segments') await getOb().sendGroupSegments(roomId, payload)
      else if (!isGroup) await getOb().sendPrivate(roomId, payload)
      else await getOb().sendGroup(roomId, payload)
      return { ok: true }
    } catch (e) {
      const msg = String(e?.message || e)
      if (shouldRetrySend(msg)) {
        enqueueSend({ roomId, isGroup, kind, payload, error: msg })
        return { ok: true, queued: true, error: msg }
      }
      throw e
    }
  }

  function enqueueSend(p) {
    const item = outbox.enqueue(p)
    stats.queued = (stats.queued || 0) + 1
    return item
  }

  async function deliverOutboxItem(item) {
    if (item.isGroup && !isAllowedGroup(item.roomId)) throw new Error('不在白名单')
    if (!item.isGroup && !config.allowPrivate.includes(item.roomId)) throw new Error('私聊不在白名单')
    if (item.kind === 'segments') return getOb().sendGroupSegments(item.roomId, item.payload)
    if (item.kind === 'private') return getOb().sendPrivate(item.roomId, item.payload)
    return getOb().sendGroup(item.roomId, item.payload)
  }

  async function flushOutbox() {
    const s = await outbox.flush()
    if (s.sent) stats.retried = (stats.retried || 0) + s.sent
    if (s.dropped) stats.dropped = (stats.dropped || 0) + s.dropped
    return s
  }

  return {
    readJson,
    hashStr,
    FACTS_FILE,
    STICKERS_FILE,
    USAGE_FILE,
    REPLIED_FILE,
    NAMES_FILE,
    MEMORY_DIR,
    STICKER_DIR,
    OUTBOX_FILE,
    facts,
    stickers,
    stickerStore,
    markStickersDirty,
    flushStickersNow,
    rememberSticker,
    usage,
    replied,
    savedNames,
    stateStore,
    flushStateNow,
    markStateDirty,
    recordReplied,
    alreadyReplied,
    noteUsage,
    usageView,
    outbox,
    sendWithRetry,
    enqueueSend,
    deliverOutboxItem,
    flushOutbox,
  }
}
