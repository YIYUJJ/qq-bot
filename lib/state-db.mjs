/**
 * 状态数据库：replied / usage 的持久化后端（SQLite KV，失败自动回落 JSON 文件）。
 *
 * KV 层来自 lib/store.mjs 的 createKvStore（node:sqlite 可用时落库，否则 JSON）。
 * 这里只负责"把两个 map 当成两条记录存取"。
 */
import { createKvStore } from './store.mjs'

const K_REPLIED = 'replied'
const K_USAGE = 'usage'

export async function openStateDb(file) {
  const kv = await createKvStore(file, { table: 'state' })
  return {
    backend: kv.backend,
    isEmpty() {
      const keys = kv.keys()
      return !keys.includes(K_REPLIED) && !keys.includes(K_USAGE)
    },
    load() {
      return {
        replied: kv.get(K_REPLIED) || {},
        usage: kv.get(K_USAGE) || null,
      }
    },
    save(replied, usage) {
      try {
        kv.set(K_REPLIED, replied || {})
      } catch {
        /* ignore */
      }
      try {
        kv.set(K_USAGE, usage || {})
      } catch {
        /* ignore */
      }
    },
    close() {
      try {
        kv.close()
      } catch {
        /* ignore */
      }
    },
  }
}
