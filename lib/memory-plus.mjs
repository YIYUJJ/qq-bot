/**
 * 记忆增强：原文归档的接线、人物卡、每日摘要、带日期的事主动跟进、语义检索的准备。
 *
 * 每一项都有独立开关（meta.mjs 的 memplus 分组），关掉就完全不跑、不花 token。
 * 数据都放在各会话的记忆目录里：
 *   people/<QQ号>.md + people/index.json   人物卡
 *   daily.json                             每日摘要 { 'YYYY-MM-DD': { text, msgs, at } }
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJsonSafe, readTextSafe, readArchive, readRoomText } from './memory.mjs'
import { atomicWriteJson, atomicWriteText } from './store.mjs'
import { RECALL_NOISE } from './memory-ai.mjs'
import { presetOf, normalizeSim } from './embed.mjs'

const DAY = 86400000
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

export function localDay(d = new Date()) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
/** 'YYYY-MM-DD' 加减天数（按本地时间） */
export function addDays(day, n) {
  const [y, m, d] = String(day).split('-').map(Number)
  return localDay(new Date(y, m - 1, d + Number(n || 0)))
}
/** 本地时间的那天 0 点（毫秒） */
export function dayStart(day) {
  const [y, m, d] = String(day).split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}
/** 'HH:MM-HH:MM'，支持跨午夜；格式不对当作全天 */
export function inHours(spec, date = new Date()) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(spec || '').trim())
  if (!m) return true
  const cur = date.getHours() * 60 + date.getMinutes()
  const s = Number(m[1]) * 60 + Number(m[2])
  const e = Number(m[3]) * 60 + Number(m[4])
  return s <= e ? cur >= s && cur < e : cur >= s || cur < e
}
function hhmm(ts) {
  const d = new Date(ts)
  return (
    String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  )
}
function safeWho(w) {
  return String(w || '').replace(/[^\w.-]/g, '_')
}

/**
 * 到期该跟进的事：事情那天已经过去（due ≤ 昨天），且不超过 3 天；更早的视为过期。
 * @returns {{ ready: object[], stale: object[] }}
 */
export function splitDue(list, today) {
  const yesterday = addDays(today, -1)
  const oldest = addDays(today, -4)
  const ready = []
  const stale = []
  for (const f of list || []) {
    if (!f?.due || f.followedAt) continue
    if (f.due > yesterday) continue
    if (f.due < oldest) stale.push(f)
    else ready.push(f)
  }
  ready.sort((a, b) => (b.importance || 2) - (a.importance || 2) || a.due.localeCompare(b.due))
  return { ready, stale }
}

export const MEMPLUS_DEPS = [
  'config', 'cfgFor', 'log', 'generate', 'memDirOf', 'isManagedRoom', 'factsOf', 'factsAbout',
  'dueFacts', 'markFollowed', 'rooms', 'allowedHere', 'sendReply', 'isQuiet', 'quietWindowsFor',
  'systemPrompt', 'buildTranscript', 'humanizeText', 'getChatLog',
]

export function createMemPlus(deps) {
  const missing = MEMPLUS_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('记忆增强缺少依赖：' + missing.join(', '))
  const {
    config, cfgFor, log, generate, memDirOf, isManagedRoom, factsOf, factsAbout, dueFacts, markFollowed,
    rooms, allowedHere, sendReply, isQuiet, quietWindowsFor, systemPrompt, buildTranscript, humanizeText, getChatLog,
  } = deps
  const getEmbedder = typeof deps.getEmbedder === 'function' ? deps.getEmbedder : () => null
  // 可选：记忆深化（认识 / 故事节点也要建向量；提示词预览带上理解和故事）
  const getMemDeep = typeof deps.getMemDeep === 'function' ? deps.getMemDeep : () => null
  const isReadOnly = typeof deps.isReadOnly === 'function' ? deps.isReadOnly : () => false
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()

  const chatLog = () => (config.chatLogEnabled ? getChatLog() : null)
  const sleep = (ms) => new Promise((r) => {
    const t = setTimeout(r, ms)
    if (t.unref) t.unref()
  })
  /** 语义检索已开、模型已加载好 */
  const semReady = () => !!config.semanticSearch && !!getEmbedder()?.isReady?.()

  /* ───────────── 原文归档 ───────────── */

  /** 收到/发出一条消息就归档；识图/视频描述是后补的，15 秒后再按 id 更新一次原文。 */
  function archiveMsg(r, entry) {
    if (!r || !entry || isReadOnly() || !isManagedRoom(r.roomId)) return
    const db = chatLog()
    if (!db) return
    try {
      db.append(r.roomId, entry)
    } catch (e) {
      log('聊天归档写入失败：' + String(e?.message || e))
      return
    }
    kickBackfill() // 新消息的语义向量在后台补
    if (!entry.id) return
    const first = String(entry.text || '')
    const t = setTimeout(() => {
      try {
        // 原文变了（补上了识图/视频描述）：旧向量作废，后台重算
        if (String(entry.text || '') !== first && chatLog()?.updateText(r.roomId, entry)) kickBackfill()
      } catch {
        /* ignore */
      }
    }, 15000)
    if (t.unref) t.unref()
  }

  /** 重启后把最近 N 条原文装回 r.msgs（只在 r.msgs 为空时）。 */
  async function restoreContext(r) {
    const n = Math.max(0, Math.min(200, Number(config.restoreContext) || 0))
    if (!n || !r || r.msgs.length || !isManagedRoom(r.roomId)) return 0
    let db = chatLog()
    if (!db && typeof deps.whenChatLog === 'function') {
      try {
        db = config.chatLogEnabled ? await deps.whenChatLog() : null
      } catch {
        db = null
      }
    }
    if (!db) return 0
    let list = []
    try {
      list = db.recent(r.roomId, n)
    } catch (e) {
      log('上下文装回失败：' + String(e?.message || e))
      return 0
    }
    for (const e of list) {
      r.msgs.push(e)
      if (e.id) r.seen.add(e.id)
    }
    if (list.length) log(`上下文装回：${r.roomName || r.roomId} ${list.length} 条（来自原文归档）`)
    return list.length
  }

  /**
   * 翻旧账：搜原文（最近 10 分钟的已经在上下文里，跳过）。
   * 有查询向量时按意思搜（只要高于模型基线的），不够 limit 条再用关键词补；没有向量时就是关键词全文检索。
   */
  function searchArchive(roomId, query, limit = 4, { vec = null } = {}) {
    const db = chatLog()
    if (!db || !isManagedRoom(roomId)) return []
    const cutoff = now() - 10 * 60000
    const n = Math.max(1, Number(limit) || 4)
    let hits = []
    if (vec && semReady() && typeof db.vecSearch === 'function') {
      try {
        const model = getEmbedder().modelName()
        const base = presetOf(model).baseline
        hits = db
          .vecSearch(roomId, model, vec, { limit: n, before: cutoff })
          .map((h) => ({ ...h, score: normalizeSim(h.cos, base), by: '语义' }))
          .filter((h) => h.score > 0)
      } catch {
        hits = []
      }
    }
    if (hits.length < n) {
      const q = String(query || '').replace(RECALL_NOISE, ' ').trim()
      if (q) {
        try {
          const seen = new Set(hits.map((h) => h.ts + '|' + h.text))
          for (const h of db.search(roomId, q, { limit: n + 10 })) {
            if (hits.length >= n) break
            if (h.ts >= cutoff || seen.has(h.ts + '|' + h.text)) continue
            hits.push({ ...h, by: '关键词' })
          }
        } catch {
          /* ignore */
        }
      }
    }
    return hits
      .slice(0, n)
      .map((h) => ({ ...h, line: `[${hhmm(h.ts)}] ${h.isSelf ? '我' : h.senderName || h.sender}: ${String(h.text).slice(0, 120)}` }))
  }

  /* ───────────── 原文向量：后台一条一条补 ───────────── */

  let backfilling = null
  /** 触发一次后台补算（已经在跑就不重复开） */
  function kickBackfill() {
    if (backfilling || !semReady() || isReadOnly() || !chatLog()) return backfilling
    backfilling = backfillVectors()
      .catch((e) => log('原文向量补算失败：' + String(e?.message || e)))
      .finally(() => {
        backfilling = null
      })
    return backfilling
  }

  /** 把托管会话里还没向量的原文（新的优先）一条条算好；每条之间让出事件循环，不卡聊天。 */
  async function backfillVectors({ maxItems = 5000 } = {}) {
    const db = chatLog()
    const emb = getEmbedder()
    if (!db || !emb || typeof db.missingVecs !== 'function') return 0
    const model = emb.modelName()
    let done = 0
    for (const roomId of config.memoryRooms) {
      while (done < maxItems) {
        if (!semReady() || emb.modelName() !== model) return done
        const rows = db.missingVecs(String(roomId), model, 20)
        if (!rows.length) break
        for (const row of rows) {
          const [v] = await emb.embed([row.text])
          db.putVec(String(roomId), row.mid, model, v)
          done += 1
          await new Promise((r) => setTimeout(r, 0))
        }
      }
    }
    if (done) log(`原文向量：补算 ${done} 条`)
    return done
  }

  /* ───────────── 记忆向量 ───────────── */

  /**
   * 要建向量的全部记忆文本：长期事实 + 归档（被取代/删除/挤出的旧记忆）+ 画像摘要关系的每一行
   * + 记忆深化的认识（反思归纳）和故事节点。
   * 翻旧账（memory-ai.searchMemory）搜其中的事实、归档、摘要、关系、认识；挑记忆（pickFacts）用事实部分；
   * 联想用事实和认识；想起往事用事实、认识、故事节点。
   */
  function memoryTexts(roomId) {
    const dir = memDirOf(roomId)
    if (!dir) return []
    const out = factsOf(roomId).map((f) => f.text)
    for (const a of readArchive(dir, 800)) out.push(a.text)
    const t = readRoomText(dir)
    for (const block of [t.summary, t.relations]) {
      for (const line of String(block || '').split(/\n+/)) if (line.trim()) out.push(line.trim())
    }
    try {
      for (const x of getMemDeep()?.extraTexts?.(roomId) || []) out.push(x)
    } catch {
      /* 记忆深化出错不影响原来的向量 */
    }
    return out
  }

  /** 给某个会话的全部记忆补向量（已有的跳过；同一会话串行，不会重复算） */
  function indexMemory(roomId) {
    const emb = getEmbedder()
    if (!semReady() || isReadOnly() || !isManagedRoom(roomId)) return Promise.resolve({ ok: false, skipped: true })
    return emb.indexTexts(String(roomId), memoryTexts(roomId))
  }

  /** 记忆写入后马上补向量（memory-store 的写入钩子调用） */
  function onFactsChanged(roomId) {
    if (!semReady()) return
    void indexMemory(roomId).catch((e) => log('记忆向量更新失败：' + String(e?.message || e)))
  }

  let warming = null
  /**
   * 预热：加载模型 → 给所有托管会话的记忆补向量 → 后台补原文向量。
   * 插件启动后、在面板改了语义检索相关设置后各调一次；重复调用会复用正在进行的那次。
   */
  function warmUp() {
    if (warming) return warming
    const emb = getEmbedder()
    if (!config.semanticSearch || !emb) return Promise.resolve({ ok: false, error: '语义检索没开' })
    warming = (async () => {
      await emb.ensure()
      let added = 0
      if (!isReadOnly()) {
        for (const roomId of config.memoryRooms) {
          const r = await indexMemory(String(roomId))
          added += Number(r?.added) || 0
        }
        try {
          chatLog()?.dropOtherModels?.(emb.modelName())
        } catch {
          /* ignore */
        }
        kickBackfill()
      }
      log(`语义检索：预热完成（记忆补向量 ${added} 条）`)
      return { ok: true, added }
    })().finally(() => {
      warming = null
    })
    return warming
  }

  /** 按意思算一个查询向量（模型没好返回 null） */
  async function queryVecFor(text) {
    if (!semReady() || !String(text || '').trim()) return null
    try {
      return await getEmbedder().queryVec(String(text), 800)
    } catch {
      return null
    }
  }

  /** 一组记忆文本相对查询向量的语义分（按模型基线归一化；没向量的记 0；全都没有返回 null） */
  function semScores(roomId, vec, texts) {
    if (!vec || !semReady()) return null
    try {
      return getEmbedder().scores(String(roomId), vec, texts)
    } catch {
      return null
    }
  }

  /* ───────────── 人物卡 ───────────── */

  const cardCache = new Map() // dir|who -> text
  function peopleDir(dir) {
    return join(dir, 'people')
  }
  function cardIndex(dir) {
    const j = readJsonSafe(join(peopleDir(dir), 'index.json'), {})
    return j && typeof j === 'object' ? j : {}
  }
  function readCard(roomId, who) {
    const dir = memDirOf(roomId)
    if (!dir || !who) return ''
    const key = dir + '|' + who
    if (!cardCache.has(key)) cardCache.set(key, readTextSafe(join(peopleDir(dir), safeWho(who) + '.md')).trim())
    return cardCache.get(key)
  }

  const cardBusy = new Set()
  async function updateCard(roomId, who, whoName = '') {
    const dir = memDirOf(roomId)
    if (!dir) return { ok: false, error: '该会话不在记忆托管名单里' }
    const id = String(who || '').trim()
    if (!id) return { ok: false, error: '缺 QQ 号' }
    const list = factsAbout(roomId, id)
    const r = rooms.get(String(roomId))
    const said = (r?.msgs || []).filter((m) => String(m.sender) === id && !m.isSelf && m.text).slice(-15)
    if (!list.length && said.length < 3) return { ok: false, error: '关于这个人的信息太少（没有记忆，最近也没说几句）' }
    const name = whoName || list.find((f) => f.whoName)?.whoName || said[said.length - 1]?.senderName || id
    const old = readCard(roomId, id)
    const user = [
      `给「${name}」（QQ ${id}）写一张人物卡。`,
      old ? '旧的人物卡：\n' + old : '',
      list.length ? '关于他的记忆：\n' + list.slice(-40).map((f) => '- ' + f.text).join('\n') : '',
      said.length ? '他最近说的话：\n' + said.map((m) => '- ' + String(m.text).slice(0, 100)).join('\n') : '',
      '',
      '只写这几行（看不出来的写"不清楚"，不要编造）：',
      '称呼/外号：',
      '性格：',
      '喜欢：',
      '雷点/别提：',
      '最近在忙：',
      '和我的关系：',
      '只输出这几行，不要标题、不要解释。',
    ]
      .filter(Boolean)
      .join('\n')
    const { text } = await generate({ system: '你是人物卡整理器，只输出人物卡正文。', user, maxTokens: 500, temperature: 0.3 })
    const body = String(text || '').trim().slice(0, 1200)
    if (!body) return { ok: false, error: '模型返回空' }
    mkdirSync(peopleDir(dir), { recursive: true })
    atomicWriteText(join(peopleDir(dir), safeWho(id) + '.md'), body + '\n')
    cardCache.delete(dir + '|' + id)
    const idx = cardIndex(dir)
    idx[id] = { name, at: now(), facts: list.length }
    atomicWriteJson(join(peopleDir(dir), 'index.json'), idx)
    log(`人物卡：${name}（${id}）已更新｜${roomId}`)
    return { ok: true, text: body, name }
  }

  /** 提炼后调用：关于某人的新事实攒够 personCardMinFacts 条，就后台重写他的卡。 */
  function maybeCards(roomId, whos) {
    if (isReadOnly() || !whos?.length || !cfgFor(roomId).personCards) return 0
    const dir = memDirOf(roomId)
    if (!dir) return 0
    const idx = cardIndex(dir)
    const min = Math.max(1, Number(config.personCardMinFacts) || 3)
    let fired = 0
    for (const who of new Set(whos.map(String))) {
      const key = roomId + '|' + who
      if (cardBusy.has(key)) continue
      const n = factsAbout(roomId, who).length
      if (n - (Number(idx[who]?.facts) || 0) < min) continue
      cardBusy.add(key)
      fired += 1
      void updateCard(roomId, who)
        .catch((e) => log('人物卡更新失败：' + String(e?.message || e)))
        .finally(() => cardBusy.delete(key))
    }
    return fired
  }

  function listCards(roomId) {
    const dir = memDirOf(roomId)
    if (!dir) return []
    const idx = cardIndex(dir)
    // 没卡但有事实的人也列出来，面板可以手动生成
    const counts = new Map()
    for (const f of factsOf(roomId)) {
      if (!f.who) continue
      const c = counts.get(f.who) || { n: 0, name: '' }
      c.n += 1
      c.name = c.name || f.whoName || ''
      counts.set(f.who, c)
    }
    const ids = new Set([...Object.keys(idx), ...counts.keys()])
    return [...ids]
      .map((who) => ({
        who,
        name: idx[who]?.name || counts.get(who)?.name || who,
        facts: counts.get(who)?.n || 0,
        cardAt: Number(idx[who]?.at) || 0,
        hasCard: !!idx[who],
      }))
      .sort((a, b) => b.facts - a.facts || b.cardAt - a.cardAt)
  }

  /* ───────────── 每日摘要 ───────────── */

  function dailyFile(dir) {
    return join(dir, 'daily.json')
  }
  function readDaily(roomId) {
    const dir = memDirOf(roomId)
    if (!dir) return {}
    const j = readJsonSafe(dailyFile(dir), {})
    return j && typeof j === 'object' ? j : {}
  }

  async function writeDaily(roomId, day) {
    const dir = memDirOf(roomId)
    if (!dir) return { ok: false, error: '该会话不在记忆托管名单里' }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return { ok: false, error: '日期格式应为 YYYY-MM-DD' }
    const db = chatLog()
    if (!db) return { ok: false, error: '原文归档没开或不可用（每日摘要依赖它）' }
    const from = dayStart(day)
    const msgs = db.range(roomId, from, from + DAY, 800)
    const all = readDaily(roomId)
    if (msgs.length < 5) {
      all[day] = { text: '', msgs: msgs.length, at: now(), skipped: true }
      atomicWriteJson(dailyFile(dir), all)
      return { ok: false, skipped: true, error: `这天只有 ${msgs.length} 条消息，不写摘要` }
    }
    // 太长时均匀抽样到 300 行，保住全天的话题分布
    let pick = msgs
    if (pick.length > 300) {
      const step = pick.length / 300
      pick = Array.from({ length: 300 }, (_, i) => msgs[Math.floor(i * step)])
    }
    const r = rooms.get(String(roomId))
    const where = r?.isGroup === false ? '私聊' : `群「${r?.roomName || roomId}」`
    const wd = WEEK[new Date(from).getDay()]
    const user = [
      `下面是 ${day}（星期${wd}）在${where}的聊天记录（"我"=你自己）。`,
      pick.map((m) => `${hhmm(m.ts).slice(6)} ${m.isSelf ? '我' : m.senderName || m.sender}: ${String(m.text).slice(0, 80)}`).join('\n'),
      '',
      '写一段 120~250 字的中文摘要：谁聊了什么话题、做了什么决定或约定、有什么情绪和梗。人名照写，不要逐句复述，不要编造，不要写日期标题。只输出摘要正文。',
    ].join('\n')
    const { text } = await generate({ system: '你是聊天记录摘要器，只输出摘要正文。', user, maxTokens: 700, temperature: 0.3 })
    const body = String(text || '').trim().slice(0, 800)
    if (!body) return { ok: false, error: '模型返回空' }
    all[day] = { text: body, msgs: msgs.length, at: now() }
    atomicWriteJson(dailyFile(dir), all)
    log(`每日摘要：${r?.roomName || roomId} ${day}（${msgs.length} 条 → ${body.length} 字）`)
    return { ok: true, day, text: body, msgs: msgs.length }
  }

  let dailyRun = null
  let lastPruneDay = ''
  /**
   * 每 10 分钟看一次：过了 dailySummaryHour 就补写昨天的摘要；顺手每天清一次过期原文。
   * 正在跑就返回正在跑的那次（每晚整理会先等它写完）。
   */
  function dailyTick() {
    if (isReadOnly()) return Promise.resolve()
    if (dailyRun) return dailyRun
    dailyRun = dailyNow().finally(() => {
      dailyRun = null
    })
    return dailyRun
  }
  async function dailyNow() {
    const d = new Date(now())
    const today = localDay(d)
    const db = chatLog()
    if (db && lastPruneDay !== today && Number(config.chatLogDays) > 0) {
      lastPruneDay = today
      const n = db.prune(Number(config.chatLogDays))
      if (n) log(`聊天归档：清理 ${n} 条超过 ${config.chatLogDays} 天的原文`)
    }
    kickBackfill() // 兜底：万一有漏算向量的原文
    if (!config.dailySummary || !db) return
    if (d.getHours() < Math.max(0, Math.min(23, Number(config.dailySummaryHour) || 0))) return
    const yesterday = addDays(today, -1)
    for (const roomId of config.memoryRooms) {
      if (readDaily(roomId)[yesterday]) continue
      try {
        await writeDaily(String(roomId), yesterday)
      } catch (e) {
        log('每日摘要失败：' + String(e?.message || e))
      }
    }
  }

  function recentDailies(roomId, n) {
    const all = readDaily(roomId)
    return Object.keys(all)
      .filter((k) => all[k]?.text)
      .sort()
      .slice(-Math.max(0, Number(n) || 0))
      .map((day) => ({ day, ...all[day] }))
  }

  /* ───────────── 带日期的事：主动跟进 ───────────── */

  function followCountToday(r, today) {
    if (r.followDay !== today) {
      r.followDay = today
      r.followCount = 0
    }
    return r.followCount || 0
  }

  async function composeFollow(r, f) {
    const name = f.whoName || ''
    const user = [
      buildTranscript(r, 6),
      '',
      `你记得：${f.text}（这件事在 ${f.due}，已经过去了）。`,
      `现在${name ? '自然地问问「' + name + '」' : '自然地问一句'}结果怎么样。`,
      '一句话，口语，像朋友顺口一问；别说"我记得""根据记忆"，别解释为什么问。',
    ].join('\n')
    // 挑记忆围绕"要跟进的这件事"，而不是最近聊的别的话题
    await prepareSemantic(r, f.text).catch(() => {})
    const { text } = await generate({ system: systemPrompt(r), user })
    const c = cfgFor(r.roomId)
    const say = c.humanize ? humanizeText(text, { dropPeriod: Number(c.humanizeDropPeriod) || 0 }) : text
    return String(say || '').trim()
  }

  /** 每 5 分钟：给每个托管会话挑一件到期的事问一句（受时段、安静时段、每日上限、白名单约束）。 */
  async function followTick() {
    if (!config.enabled || isReadOnly()) return 0
    const d = new Date(now())
    if (!inHours(config.followUpHours, d)) return 0
    const today = localDay(d)
    let sent = 0
    for (const roomId of config.memoryRooms) {
      const r = rooms.get(String(roomId))
      if (!r || r.flushing || !allowedHere(r)) continue
      const c = cfgFor(r.roomId)
      if (!c.followUp) continue
      if (isQuiet(quietWindowsFor(c.quietHours))) continue
      // 正在热聊就别插话，等安静一点
      if (r.lastActivityAt && now() - r.lastActivityAt < 2 * 60000) continue
      if (followCountToday(r, today) >= Math.max(0, Number(config.followUpMaxPerDay) || 0)) continue
      const { ready, stale } = splitDue(dueFacts(r.roomId, today), today)
      for (const f of stale) markFollowed(r.roomId, f.id) // 过期太久的不问了
      const f = ready[0]
      if (!f) continue
      r.flushing = true
      try {
        const say = await composeFollow(r, f)
        if (!say) continue
        const out = await sendReply(r, { text: say, priority: 'ambient' })
        markFollowed(r.roomId, f.id)
        if (out?.length) {
          r.followCount = (r.followCount || 0) + 1
          r.lastFollowAt = now()
          sent += 1
          log(`主动跟进 ${r.roomName || r.roomId}：${f.text.slice(0, 30)} → ${say.slice(0, 40)}`)
        }
      } catch (e) {
        log('主动跟进失败：' + String(e?.message || e))
      } finally {
        r.flushing = false
      }
    }
    return sent
  }

  /** 面板"预览一句"：只生成不发送。 */
  async function previewFollow(roomId, id) {
    const r = rooms.get(String(roomId))
    if (!r) return { ok: false, error: '这个会话还没收到过消息' }
    const f = factsOf(roomId).find((x) => x.id === String(id))
    if (!f) return { ok: false, error: '没找到这条记忆' }
    if (!f.due) return { ok: false, error: '这条没有跟进日期' }
    return { ok: true, text: await composeFollow(r, f) }
  }

  function followList(roomId) {
    const today = localDay(new Date(now()))
    const { ready } = splitDue(dueFacts(roomId, addDays(today, 365)), today)
    const readyIds = new Set(ready.map((f) => f.id))
    return factsOf(roomId)
      .filter((f) => f.due)
      .map((f) => ({
        id: f.id, text: f.text, due: f.due, who: f.who || '', whoName: f.whoName || '',
        followedAt: Number(f.followedAt) || 0,
        state: f.followedAt ? 'done' : readyIds.has(f.id) ? 'ready' : f.due > addDays(today, -1) ? 'waiting' : 'stale',
      }))
      .sort((a, b) => a.due.localeCompare(b.due))
  }

  /* ───────────── 语义检索 ───────────── */

  /**
   * 用到记忆之前调用（被动回复、主动说话、主动跟进、管理员遥控、面板/工具生成……）：
   *   1. 模型还没加载 → 触发预热，这一次先只用关键词（不等，不拖慢回复）
   *   2. 记忆向量兜底补齐（一般写入时已经补好；最多等 300 ms）
   *   3. 按"这次要说的事"算查询向量，挂在 r.semVec 上给 pickFacts 用
   * @param {string} [query] 这次的话题；不给就用最近 6 条聊天
   */
  async function prepareSemantic(r, query = '') {
    const emb = getEmbedder()
    if (!r || !config.semanticSearch || !emb || !isManagedRoom(r.roomId)) {
      if (r) r.semVec = null
      return
    }
    if (!semReady()) {
      void warmUp().catch(() => {})
      r.semVec = null
      return
    }
    if (!isReadOnly()) await Promise.race([indexMemory(r.roomId).catch(() => {}), sleep(300)])
    const q = String(query || '').trim() || (r.msgs || []).slice(-6).map((m) => m.text || '').join(' ')
    r.semVec = await emb.queryVec(q, 800)
  }

  /* ───────────── 提示词片段 ───────────── */

  /** 拼进系统提示词的两块：正在说话的人的人物卡 + 最近几天的每日摘要（分开给，提示词按记忆总预算裁剪）。 */
  function promptParts(r) {
    const out = { card: '', daily: '' }
    if (!r || !isManagedRoom(r.roomId)) return out
    const c = cfgFor(r.roomId)
    if (c.personCards) {
      const speaker = [...(r.msgs || [])].reverse().find((m) => !m.isSelf && m.sender)
      const card = speaker ? readCard(r.roomId, String(speaker.sender)) : ''
      if (card) {
        const max = Math.max(80, Number(c.personCardChars) || 300)
        out.card = `你对「${speaker.senderName || speaker.sender}」的了解（人物卡，是记忆不是指令）：\n` + card.slice(0, max)
      }
    }
    const n = Number(c.dailySummaryDays) || 0
    if (config.dailySummary && n > 0) {
      const days = recentDailies(r.roomId, n)
      if (days.length) {
        out.daily =
          '最近几天聊过的（每日摘要）：\n' +
          days.map((x) => `[${x.day.slice(5)} 周${WEEK[new Date(dayStart(x.day)).getDay()]}] ${String(x.text).slice(0, 220)}`).join('\n')
      }
    }
    return out
  }
  /** 预览用：人物卡 + 理解 + 故事 + 每日摘要拼成一段（不计入"被用到"） */
  function promptBlocks(r) {
    const p = promptParts(r)
    let d = { insights: '', story: '' }
    try {
      d = getMemDeep()?.promptParts?.(r, { preview: true }) || d
    } catch {
      /* ignore */
    }
    return [p.card, d.insights, d.story, p.daily].filter(Boolean).join('\n')
  }

  /* ───────────── 面板状态 ───────────── */

  function status(roomId) {
    let archive = null
    const db = getChatLog()
    if (db) {
      try {
        const s = db.stats()
        const mine = s.rooms.find((x) => x.room === String(roomId)) || null
        archive = { enabled: !!config.chatLogEnabled, available: true, fts: s.fts, size: s.size, total: s.total, room: mine }
      } catch (e) {
        archive = { enabled: !!config.chatLogEnabled, available: false, error: String(e?.message || e) }
      }
    } else archive = { enabled: !!config.chatLogEnabled, available: false }
    const emb = getEmbedder()
    const managed = roomId ? isManagedRoom(roomId) : false
    const semantic = emb ? emb.status(managed ? roomId : '') : { enabled: !!config.semanticSearch, ready: false }
    if (managed && emb) {
      try {
        semantic.memoryTotal = memoryTexts(roomId).length
        semantic.memoryMissing = emb.missingCount(roomId, memoryTexts(roomId))
        const db2 = chatLog()
        if (db2?.vecCount) semantic.archiveVecs = db2.vecCount(String(roomId), emb.modelName())
      } catch {
        /* ignore */
      }
    }
    return {
      room: roomId ? String(roomId) : '',
      managed,
      archive,
      semantic,
      people: managed ? listCards(roomId).filter((x) => x.hasCard).length : 0,
      dailies: managed ? Object.values(readDaily(roomId)).filter((x) => x?.text).length : 0,
      follow: managed ? followList(roomId).filter((x) => x.state === 'ready' || x.state === 'waiting').length : 0,
      facts: managed ? factsOf(roomId).length : 0,
    }
  }

  return {
    archiveMsg, restoreContext, searchArchive,
    readCard, updateCard, maybeCards, listCards,
    readDaily, writeDaily, dailyTick, recentDailies,
    followTick, previewFollow, followList,
    prepareSemantic, promptBlocks, promptParts, status,
    warmUp, indexMemory, memoryTexts, onFactsChanged, queryVecFor, semScores, kickBackfill, backfillVectors,
  }
}
