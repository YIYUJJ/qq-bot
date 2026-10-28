/**
 * 持久化基础设施。
 *
 * 解决的问题（原来的写法是裸 readFile/writeFile）：
 *   1. 写到一半崩溃/断电 → JSON 损坏（现在走 tmp + rename）
 *   2. 并发写同一文件互相覆盖（每个文件一条串行写队列）
 *   3. 双开 DSH → 两个实例同时回复、同时写坏数据（单实例锁）
 *   4. 数据量大了 JSON 检索慢（可选 SQLite 后端，Node 22+ 的 node:sqlite；
 *      老版本自动回落到 JSON，不影响可用性）
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

/* ────────────────────────── 原子写 ────────────────────────── */

function ensureDir(file) {
  try {
    mkdirSync(dirname(file), { recursive: true })
  } catch {
    /* ignore */
  }
}

/**
 * 原子写 JSON：先写同目录临时文件，再 rename 覆盖。
 * Windows 上 rename 可能遇到瞬时 EBUSY（杀软/索引），重试几次。
 * @returns {boolean} 是否成功
 */
export function atomicWriteJson(file, obj, { retries = 6 } = {}) {
  ensureDir(file)
  const text = JSON.stringify(obj, null, 2) + '\n'
  const tmp = file + '.' + process.pid + '.tmp'
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      writeFileSync(tmp, text, 'utf8')
      renameSync(tmp, file)
      return true
    } catch (e) {
      if (attempt === retries) {
        try {
          unlinkSync(tmp)
        } catch {
          /* ignore */
        }
        return false
      }
      // 忙等一小会儿再试（同步重试，避免把调用方变 async）
      const until = Date.now() + 20 * (attempt + 1)
      while (Date.now() < until) {
        /* spin */
      }
    }
  }
  return false
}

/** 原子读 JSON，坏了/不存在返回 fallback。 */
export function readJsonSafe(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/* ────────────────────────── 串行写队列 ────────────────────────── */

const queues = new Map()

/**
 * 每个文件一条串行队列：同一文件的写不会交错，跨文件并行。
 * @param {string} file
 * @param {() => any} job
 */
export function enqueueWrite(file, job) {
  const prev = queues.get(file) || Promise.resolve()
  const next = prev.then(
    () => job(),
    () => job(),
  )
  // 队列失败不能变成未处理的 rejection
  const safeNext = next.catch(() => {})
  queues.set(file, safeNext)
  safeNext.finally(() => {
    if (queues.get(file) === safeNext) queues.delete(file)
  })
  return next
}

/**
 * 简单的 JSON 文件 store：读缓存 + 串行写。
 * 注意：跨进程不保证一致（单实例锁负责这件事）。
 */
export function createJsonStore(file, { defaultValue = {}, onError = null } = {}) {
  let cache = readJsonSafe(file, structuredClone(defaultValue))
  if (cache == null) cache = structuredClone(defaultValue)
  let dirty = false
  return {
    get file() {
      return file
    },
    read() {
      return cache
    },
    /** 整体替换（立即返回，写盘走队列） */
    replace(next) {
      cache = next
      dirty = true
      return enqueueWrite(file, () => {
        const ok = atomicWriteJson(file, cache)
        if (!ok && onError) onError(new Error('写盘失败：' + file))
        dirty = false
        return ok
      })
    },
    /** 同步刷盘（退出/备份前用） */
    flushSync() {
      if (!dirty) return true
      const ok = atomicWriteJson(file, cache)
      if (ok) dirty = false
      return ok
    },
    isDirty() {
      return dirty
    },
  }
}

/* ────────────────────────── 单实例锁 ────────────────────────── */

function pidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM' // 存在但没权限 → 视为活着
  }
}

/**
 * 单实例锁：抢到返回 { ok:true, release }，被占用返回 { ok:false, holder }。
 * 进程崩溃留下的死锁会被自动接管。
 */
export function acquireInstanceLock(file, { label = '' } = {}) {
  ensureDir(file)
  const payload = JSON.stringify({ pid: process.pid, at: Date.now(), label })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, 'wx')
      try {
        writeSync(fd, payload)
      } finally {
        closeSync(fd)
      }
      return {
        ok: true,
        file,
        release() {
          try {
            const cur = readJsonSafe(file, null)
            if (cur && Number(cur.pid) === process.pid) unlinkSync(file)
          } catch {
            /* ignore */
          }
        },
      }
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e
      const holder = readJsonSafe(file, null)
      // 持锁进程已经没了 → 接管
      if (!holder || !pidAlive(Number(holder.pid))) {
        try {
          unlinkSync(file)
        } catch {
          /* ignore */
        }
        continue
      }
      return { ok: false, holder }
    }
  }
  return { ok: false, holder: readJsonSafe(file, null) }
}

/* ────────────────────────── SQLite（可选） ────────────────────────── */

let sqliteMod
let sqliteTried = false

/** node:sqlite 是否可用（Node 22.5+；CI 的 Node 20 会返回 false） */
export async function sqliteAvailable() {
  if (!sqliteTried) {
    sqliteTried = true
    try {
      sqliteMod = await import('node:sqlite')
    } catch {
      sqliteMod = null
    }
  }
  return !!sqliteMod?.DatabaseSync
}

/**
 * KV 表：可用 SQLite 就落库，否则回落成 JSON 文件。
 * 对调用方接口一致：get/set/del/keys/close。
 */
export async function createKvStore(file, { table = 'kv' } = {}) {
  if (await sqliteAvailable()) {
    const db = new sqliteMod.DatabaseSync(file)
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER)`)
    const getStmt = db.prepare(`SELECT v FROM ${table} WHERE k = ?`)
    const setStmt = db.prepare(`INSERT INTO ${table} (k, v, at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at`)
    const delStmt = db.prepare(`DELETE FROM ${table} WHERE k = ?`)
    return {
      backend: 'sqlite',
      get(k) {
        const row = getStmt.get(String(k))
        if (!row) return undefined
        try {
          return JSON.parse(row.v)
        } catch {
          return row.v
        }
      },
      set(k, v) {
        setStmt.run(String(k), JSON.stringify(v), Date.now())
      },
      del(k) {
        delStmt.run(String(k))
      },
      keys() {
        return db.prepare(`SELECT k FROM ${table}`).all().map((r) => r.k)
      },
      close() {
        try {
          db.close()
        } catch {
          /* ignore */
        }
      },
    }
  }
  // 回落：JSON map
  const data = readJsonSafe(file, {}) || {}
  return {
    backend: 'json',
    get(k) {
      return data[String(k)]
    },
    set(k, v) {
      data[String(k)] = v
      atomicWriteJson(file, data)
    },
    del(k) {
      delete data[String(k)]
      atomicWriteJson(file, data)
    },
    keys() {
      return Object.keys(data)
    },
    close() {},
  }
}

/** 稳定短 id（给 traceId 之类用） */
export function shortId(seed) {
  return createHash('sha1').update(String(seed) + Math.random()).digest('hex').slice(0, 10)
}
