/**
 * 聊天原文归档（SQLite + FTS5 全文索引）。
 *
 * 为什么要它：
 *   1. 内存里每个会话只留最近 200 条，"翻旧账"翻不远；原文落库后几个月前的原话也能搜到。
 *   2. 重启后短期上下文（r.msgs）是空的，只能靠 QQ 拉回 10 条；有了归档可以直接装回最近 N 条。
 *
 * 只归档"记忆托管"名单里的会话（隐私边界和长期记忆一致）。
 * node:sqlite 不可用（Node < 22.5）时 openChatLog 返回 null，调用方全部按"没有归档"处理。
 *
 * 中文没有空格：FTS 用 trigram 分词（3 字窗口）召回候选，再用 bigram BM25 重排；
 * 查询不足 3 个字时退回 LIKE。
 */
import { mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { bm25Scores, bigramTokens } from './memory.mjs'

function midOf(m) {
  if (m && m.id) return String(m.id)
  const h = createHash('sha1')
    .update(String(m?.ts || 0) + '|' + String(m?.sender || '') + '|' + String(m?.text || ''))
    .digest('hex')
    .slice(0, 16)
  return 'h:' + h
}

function rowToEntry(row) {
  return {
    id: String(row.mid).startsWith('h:') ? '' : String(row.mid),
    ts: Number(row.ts) || 0,
    sender: row.sender || '',
    senderName: row.name || row.sender || '',
    isSelf: !!row.self,
    isAtMe: false,
    text: String(row.text || ''),
    images: 0,
    restored: true,
  }
}

/**
 * @param {string} file  数据库文件
 * @param {{log?: Function, importer?: Function}} [opts]
 * @returns {Promise<null | ReturnType<typeof makeApi>>}
 */
export async function openChatLog(file, { log = () => {}, importer = (m) => import(m) } = {}) {
  let mod
  try {
    mod = await importer('node:sqlite')
  } catch {
    return null
  }
  if (!mod?.DatabaseSync) return null
  mkdirSync(dirname(file), { recursive: true })
  const db = new mod.DatabaseSync(file)
  try {
    db.exec('PRAGMA journal_mode=WAL')
    db.exec('PRAGMA synchronous=NORMAL')
  } catch {
    /* ignore */
  }
  db.exec(`CREATE TABLE IF NOT EXISTS msgs (
    room TEXT NOT NULL,
    mid TEXT NOT NULL,
    ts INTEGER NOT NULL,
    sender TEXT,
    name TEXT,
    self INTEGER DEFAULT 0,
    text TEXT NOT NULL,
    UNIQUE(room, mid)
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS msgs_room_ts ON msgs(room, ts)')
  let fts = true
  try {
    db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS msgs_fts USING fts5(text, content='msgs', content_rowid='rowid', tokenize='trigram')",
    )
    db.exec(
      'CREATE TRIGGER IF NOT EXISTS msgs_ai AFTER INSERT ON msgs BEGIN INSERT INTO msgs_fts(rowid, text) VALUES (new.rowid, new.text); END',
    )
    db.exec(
      "CREATE TRIGGER IF NOT EXISTS msgs_ad AFTER DELETE ON msgs BEGIN INSERT INTO msgs_fts(msgs_fts, rowid, text) VALUES ('delete', old.rowid, old.text); END",
    )
    db.exec(
      "CREATE TRIGGER IF NOT EXISTS msgs_au AFTER UPDATE OF text ON msgs BEGIN INSERT INTO msgs_fts(msgs_fts, rowid, text) VALUES ('delete', old.rowid, old.text); INSERT INTO msgs_fts(rowid, text) VALUES (new.rowid, new.text); END",
    )
  } catch (e) {
    fts = false
    log('聊天归档：FTS5 不可用，搜索退回 LIKE（' + String(e?.message || e) + '）')
  }
  // 原文的语义向量（float32 存成 BLOB），按模型分开存，换模型不串
  db.exec(`CREATE TABLE IF NOT EXISTS msg_vecs (
    room TEXT NOT NULL,
    mid TEXT NOT NULL,
    model TEXT NOT NULL,
    vec BLOB NOT NULL,
    PRIMARY KEY(room, mid, model)
  )`)
  return makeApi(db, file, fts)
}

function toBlob(vec) {
  const f = Float32Array.from(vec)
  return new Uint8Array(f.buffer, f.byteOffset, f.byteLength)
}
function fromBlob(b) {
  // 拷一份：SQLite 给的 Uint8Array 不保证 4 字节对齐
  const u = new Uint8Array(b)
  return new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4)
}

function makeApi(db, file, fts) {
  const st = {
    insert: db.prepare(
      'INSERT OR IGNORE INTO msgs (room, mid, ts, sender, name, self, text) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    updateText: db.prepare('UPDATE msgs SET text = ? WHERE room = ? AND mid = ? AND text <> ?'),
    recent: db.prepare('SELECT * FROM msgs WHERE room = ? ORDER BY ts DESC LIMIT ?'),
    range: db.prepare('SELECT * FROM msgs WHERE room = ? AND ts >= ? AND ts < ? ORDER BY ts ASC LIMIT ?'),
    ftsSearch: fts
      ? db.prepare(
          'SELECT m.* FROM msgs_fts f JOIN msgs m ON m.rowid = f.rowid WHERE msgs_fts MATCH ? AND m.room = ? AND m.ts >= ? ORDER BY m.ts DESC LIMIT 300',
        )
      : null,
    stats: db.prepare('SELECT room, COUNT(*) AS n, MIN(ts) AS first, MAX(ts) AS last FROM msgs GROUP BY room'),
    prune: db.prepare('DELETE FROM msgs WHERE ts < ?'),
    count: db.prepare('SELECT COUNT(*) AS n FROM msgs WHERE room = ?'),
    putVec: db.prepare('INSERT OR REPLACE INTO msg_vecs (room, mid, model, vec) VALUES (?, ?, ?, ?)'),
    dropVec: db.prepare('DELETE FROM msg_vecs WHERE room = ? AND mid = ?'),
    missingVecs: db.prepare(
      'SELECT m.mid, m.text FROM msgs m WHERE m.room = ? AND NOT EXISTS (SELECT 1 FROM msg_vecs v WHERE v.room = m.room AND v.mid = m.mid AND v.model = ?) ORDER BY m.ts DESC LIMIT ?',
    ),
    vecRows: db.prepare(
      'SELECT m.*, v.vec FROM msg_vecs v JOIN msgs m ON m.room = v.room AND m.mid = v.mid WHERE v.room = ? AND v.model = ? AND m.ts < ? ORDER BY m.ts DESC LIMIT ?',
    ),
    vecCount: db.prepare('SELECT COUNT(*) AS n FROM msg_vecs WHERE room = ? AND model = ?'),
    pruneVecs: db.prepare('DELETE FROM msg_vecs WHERE NOT EXISTS (SELECT 1 FROM msgs m WHERE m.room = msg_vecs.room AND m.mid = msg_vecs.mid)'),
    dropOtherModels: db.prepare('DELETE FROM msg_vecs WHERE model <> ?'),
  }

  return {
    backend: 'sqlite',
    fts,
    /** 归档一条消息（同 room+id 重复写入会被忽略）。 */
    append(roomId, m) {
      const text = String(m?.text || '').trim()
      if (!text) return false
      const r = st.insert.run(
        String(roomId),
        midOf(m),
        Number(m.ts) || Date.now(),
        String(m.sender || ''),
        String(m.senderName || ''),
        m.isSelf ? 1 : 0,
        text.slice(0, 4000),
      )
      return Number(r?.changes || 0) > 0
    },
    /** 识图/视频描述补齐后，把原文更新成带描述的版本（只更新有 id 的）；旧向量作废，等后台重算。 */
    updateText(roomId, m) {
      if (!m?.id) return false
      const text = String(m.text || '').trim().slice(0, 4000)
      if (!text) return false
      const r = st.updateText.run(text, String(roomId), String(m.id), text)
      const changed = Number(r?.changes || 0) > 0
      if (changed) st.dropVec.run(String(roomId), String(m.id))
      return changed
    },
    /** 最近 limit 条（按时间正序），形状和 r.msgs 里的条目一致。 */
    recent(roomId, limit = 100) {
      return st.recent
        .all(String(roomId), Math.max(1, Math.min(1000, Number(limit) || 100)))
        .reverse()
        .map(rowToEntry)
    },
    /** [from, to) 时间段内的消息（每日摘要用）。 */
    range(roomId, from, to, limit = 600) {
      return st.range.all(String(roomId), Number(from) || 0, Number(to) || Date.now(), Math.max(1, Number(limit) || 600)).map(rowToEntry)
    },
    /**
     * 全文检索：trigram 召回 → bigram BM25 重排。
     * @returns {Array<{ts, sender, senderName, isSelf, text, score}>}
     */
    search(roomId, query, { limit = 10, since = 0 } = {}) {
      const clean = String(query || '').replace(/["'*^()]+/g, ' ').replace(/\s+/g, ' ').trim()
      const compact = clean.replace(/\s+/g, '')
      if (!compact) return []
      let rows = []
      if (st.ftsSearch && compact.length >= 3) {
        const grams = new Set()
        for (let i = 0; i + 3 <= compact.length && grams.size < 16; i++) grams.add(compact.slice(i, i + 3))
        const match = [...grams].map((g) => '"' + g.replace(/"/g, '""') + '"').join(' OR ')
        try {
          rows = st.ftsSearch.all(match, String(roomId), Number(since) || 0)
        } catch {
          rows = []
        }
      }
      if (!rows.length) {
        // trigram 没召回（查询词和原文措辞不连续，比如"驾照考试" vs "考驾照"）：
        // 退回到 2 字窗口 OR 匹配，再交给 BM25 排序
        const grams = [...new Set(bigramTokens(compact))].slice(0, 8)
        if (grams.length) {
          const where = grams.map(() => "text LIKE ? ESCAPE '\\'").join(' OR ')
          const esc = (g) => '%' + g.replace(/[\\%_]/g, (c) => '\\' + c) + '%'
          try {
            rows = db
              .prepare(`SELECT * FROM msgs WHERE room = ? AND ts >= ? AND (${where}) ORDER BY ts DESC LIMIT 300`)
              .all(String(roomId), Number(since) || 0, ...grams.map(esc))
          } catch {
            rows = []
          }
        }
      }
      if (!rows.length) return []
      const scores = bm25Scores(clean, rows.map((r) => r.text))
      return rows
        .map((row, i) => ({ ...rowToEntry(row), score: scores[i] }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.ts - a.ts)
        .slice(0, Math.max(1, Number(limit) || 10))
    },
    count(roomId) {
      return Number(st.count.get(String(roomId))?.n || 0)
    },
    stats() {
      let size = 0
      try {
        size = statSync(file).size
      } catch {
        /* ignore */
      }
      const rooms = st.stats.all().map((r) => ({ room: r.room, count: Number(r.n), first: Number(r.first), last: Number(r.last) }))
      return { file, size, fts, rooms, total: rooms.reduce((s, r) => s + r.count, 0) }
    },
    /** 删掉 days 天之前的原文（连同它们的向量）；days<=0 不删。返回删了几条。 */
    prune(days) {
      const d = Number(days) || 0
      if (d <= 0) return 0
      const r = st.prune.run(Date.now() - d * 86400000)
      st.pruneVecs.run()
      return Number(r?.changes || 0)
    },

    /* ── 语义向量 ── */
    /** 还没算向量的原文（新的在前），给后台补算用。 */
    missingVecs(roomId, model, limit = 50) {
      return st.missingVecs.all(String(roomId), String(model), Math.max(1, Number(limit) || 50)).map((r) => ({ mid: r.mid, text: String(r.text || '') }))
    },
    putVec(roomId, mid, model, vec) {
      st.putVec.run(String(roomId), String(mid), String(model), toBlob(vec))
    },
    vecCount(roomId, model) {
      return Number(st.vecCount.get(String(roomId), String(model))?.n || 0)
    },
    /** 换模型后清掉别的模型的向量（省空间）。返回删了几条。 */
    dropOtherModels(model) {
      return Number(st.dropOtherModels.run(String(model))?.changes || 0)
    },
    /**
     * 按意思搜原文：查询向量和每条原文向量算余弦（全部已归一化，余弦 = 点积）。
     * @returns {Array<{ts, sender, senderName, isSelf, text, cos}>} 余弦从高到低
     */
    vecSearch(roomId, model, qvec, { limit = 10, before = 0, max = 20000 } = {}) {
      if (!qvec?.length) return []
      const q = Float32Array.from(qvec)
      const rows = st.vecRows.all(String(roomId), String(model), Number(before) > 0 ? Number(before) : 9e15, Math.max(1, Number(max) || 20000))
      const out = []
      for (const row of rows) {
        const v = fromBlob(row.vec)
        const n = Math.min(v.length, q.length)
        let s = 0
        for (let i = 0; i < n; i++) s += v[i] * q[i]
        out.push({ ...rowToEntry(row), cos: s })
      }
      return out.sort((a, b) => b.cos - a.cos || b.ts - a.ts).slice(0, Math.max(1, Number(limit) || 10))
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
