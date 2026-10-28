/**
 * 面板 HTTP API（从 index.js 整体抽出）。
 *
 * 45 个路由 + 面板页静态输出。依赖通过 createApiHandler({...}) 注入，
 * 缺依赖时启动即报错（API_DEPS 用来校验，避免运行到一半才发现）。
 */
import { existsSync, rmSync } from 'node:fs'
import { graphPath, readRoomMemory, readRoomText, writeRoomFacts } from './memory.mjs'
import { autostartFile, isAutostartEnabled, setAutostart, startupDir } from './autostart.mjs'
import { countOverrides } from './roomcfg.mjs'
import { normalizeEvent } from './onebot.mjs'
import { readFileSync } from 'node:fs'
import { recentErrors } from './safe.mjs'
import { CONFIG_KEYS, ROOM_KEYS } from './schema.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const API_DEPS = ["DATA_DIR","LOG_FILE","MOODS","NAMES_FILE","STICKERS_FILE","addFact","allowedHere","applyConfigPatch","assertGroupAllowed","backupList","backupNow","buildTranscript","cfgFor","config","delFact","exportMemory","extractFacts","factNorm","facts","factsOf","flushOutbox","generate","getFeatures","groupNames","isAllowedGroup","isManagedRoom","loadFacts","log","markStickersDirty","memDirOf","metrics","ob","onEvent","outbox","panelState","readJson","reloadSelf","replied","rereadConfigFromDisk","resetRoomOverride","restartDsh","roomOverrideOf","roomState","rooms","savedNames","searchMemory","selfcheck","sendReply","sendStickerTo","sendWithRetry","setRoomOverride","sleep","stats","stickers","systemPrompt","tailLines","updateProfile","updateRelations","updateSummary","usage","usageView","writeJson"]

export function createApiHandler(deps) {
  const missing = API_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) {
    throw new Error('面板 API 缺少依赖：' + missing.join(', '))
  }
  const { DATA_DIR, LOG_FILE, MOODS, NAMES_FILE, STICKERS_FILE, addFact, allowedHere, applyConfigPatch, assertGroupAllowed, backupList, backupNow, buildTranscript, cfgFor, config, delFact, exportMemory, extractFacts, factNorm, facts, factsOf, flushOutbox, generate, getFeatures, groupNames, isAllowedGroup, isManagedRoom, loadFacts, log, markStickersDirty, metrics, ob, onEvent, outbox, panelState, readJson, reloadSelf, replied, rereadConfigFromDisk, resetRoomOverride, restartDsh, roomOverrideOf, roomState, rooms, savedNames, searchMemory, selfcheck, sendReply, sendStickerTo, sendWithRetry, setRoomOverride, sleep, stats, stickers, systemPrompt, tailLines, updateProfile, updateRelations, updateSummary, usage, usageView, writeJson } = deps
  const getService = deps.getService

  const json = (res, status, body) => {
    const s = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(s),
    })
    res.end(s)
  }

  const readBody = (req, limit = 1024 * 1024) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > limit) {
          reject(new Error('请求体太大'))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (!raw) return resolve({})
        try {
          resolve(JSON.parse(raw))
        } catch {
          reject(new Error('JSON 解析失败'))
        }
      })
      req.on('error', reject)
    })

    async function handleRequest(req, res) {
      let pathname = '/qq-bot'
      try {
        pathname = new URL(req.url || '/', 'http://x').pathname
      } catch {
        /* ignore */
      }
      const isApi = pathname === '/qq-bot/api' || pathname.startsWith('/qq-bot/api/')

      // 复用 DSH 的登录/同源栅栏
      try {
        const conn = getService('connection')
        if (conn && typeof conn.requestRejection === 'function') {
          const rej = conn.requestRejection({ headers: req.headers })
          if (rej !== undefined) {
            return json(res, rej === 401 ? 401 : 403, { ok: false, error: rej === 401 ? '未登录或登录已过期' : '来源不受信任' })
          }
        }
      } catch {
        /* 栅栏不可用时不阻塞（本地单用户） */
      }

      if (!isApi) {
        // 同一个面板也能直接当独立页面打开：把 CSS 内联进去（和 Client 半共用一份 HTML）
        let page = ''
        try {
          const here = dirname(fileURLToPath(import.meta.url))
          const html = readFileSync(join(here, '..', 'panel', 'index.html'), 'utf8')
          const css = readFileSync(join(here, '..', 'panel', 'panel.css'), 'utf8')
          page = html.replace(
            /<link rel="stylesheet" href="\.\/panel\.css">/,
            '<style>\n' + css + '\n</style>',
          )
        } catch (e) {
          return json(res, 500, { ok: false, error: '面板文件缺失：' + String(e?.message || e) })
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(page)
        return
      }

      const sub = pathname.slice('/qq-bot/api'.length) || '/'
      try {
        if (req.method === 'GET') {
          if (sub === '/state') return json(res, 200, panelState())
          if (sub === '/room-config') {
            const u = new URL(req.url, 'http://x')
            const room = String(u.searchParams.get('room') || '').replace(/^group:/, '')
            if (!room) return json(res, 400, { ok: false, error: '缺少 room' })
            const global = {}
            for (const k of ROOM_KEYS) global[k] = config[k]
            const override = roomOverrideOf(room)
            const effective = cfgFor(room)
            const eff = {}
            for (const k of ROOM_KEYS) eff[k] = effective[k]
            return json(res, 200, {
              ok: true,
              room,
              roomName: groupNames.get(room) || (rooms.get(room) || {}).roomName || '',
              keys: ROOM_KEYS,
              global,
              override,
              effective: eff,
              count: countOverrides(override),
            })
          }
          if (sub === '/health') return json(res, 200, { ok: true, health: await ob.health() })
          if (sub === '/export') {
            const dump = {}
            for (const k of CONFIG_KEYS) dump[k] = config[k]
            return json(res, 200, { ok: true, at: new Date().toISOString(), config: dump })
          }
          if (sub === '/thumb') {
            // 图库缩略图：本地缓存文件直接回给面板（收藏型的 url 常过期，不能直接当 img src）
            const u = new URL(req.url, 'http://x')
            const id = String(u.searchParams.get('id') || '')
            const s = stickers[id]
            if (!s) return json(res, 404, { ok: false, error: '图库里没有这张' })
            const file = s.file && existsSync(s.file) ? s.file : ''
            if (!file) return json(res, 404, { ok: false, error: '这张没有本地缓存' })
            try {
              const buf = readFileSync(file)
              const lower = String(file).toLowerCase()
              const type = lower.endsWith('.png')
                ? 'image/png'
                : lower.endsWith('.gif')
                  ? 'image/gif'
                  : lower.endsWith('.webp')
                    ? 'image/webp'
                    : 'image/jpeg'
              res.writeHead(200, { 'content-type': type, 'cache-control': 'private, max-age=3600' })
              res.end(buf)
              return
            } catch (e) {
              return json(res, 500, { ok: false, error: String(e?.message || e) })
            }
          }
          if (sub === '/logs') {
            const u = new URL(req.url, 'http://x')
            const lines = Math.max(20, Math.min(2000, Number(u.searchParams.get('lines')) || 200))
            return json(res, 200, { ok: true, file: LOG_FILE, lines, text: tailLines(LOG_FILE, lines) })
          }
          return json(res, 404, { ok: false, error: '未知接口' })
        }
        if (req.method === 'POST') {
          const ct = String(req.headers['content-type'] || '')
          if (!ct.includes('application/json')) return json(res, 415, { ok: false, error: '只接受 application/json' })
          let body
          try {
            body = await readBody(req)
          } catch (e) {
            return json(res, 400, { ok: false, error: '请求体解析失败：' + String(e?.message || e) })
          }
          if (sub === '/config') {
            const r = applyConfigPatch(body?.patch || {})
            log('面板改配置：' + JSON.stringify(r.applied))
            return json(res, r.ok ? 200 : 400, r)
          }
          if (sub === '/room-config') {
            const room = String(body?.room || '').replace(/^group:/, '')
            if (!room) return json(res, 400, { ok: false, error: '缺少 room' })
            if (!isAllowedGroup(room) && !rooms.has(room) && !groupNames.has(room)) {
              return json(res, 400, { ok: false, error: `未知群：${room}（先加进白名单，或等群里来条消息）` })
            }
            if (body?.reset) {
              const r = resetRoomOverride(room)
              log(`每群性格：${room} 已恢复跟随全局`)
              return json(res, 200, { ok: true, ...r })
            }
            const r = setRoomOverride(room, body?.overrides || {})
            log(`每群性格：${room} 覆盖 ${Object.keys(r.applied).length} 项`)
            return json(res, r.ok ? 200 : 400, r)
          }
          if (sub === '/import') {
            if (body?.confirm !== 'import') return json(res, 400, { ok: false, error: '导入需要 confirm:"import"' })
            const r = applyConfigPatch(body?.config || {})
            log('面板导入配置：' + JSON.stringify(Object.keys(body?.config || {})))
            return json(res, r.ok ? 200 : 400, r)
          }
          if (sub !== '/action') return json(res, 404, { ok: false, error: '未知接口' })

          const op = String(body?.op || '')
          const args = body?.args || {}
          const roomOf = (v) => String(v || '').replace(/^group:/, '').trim()

          switch (op) {
            case 'rereadConfig': {
              const r = rereadConfigFromDisk()
              log('重读配置：' + (r.changed.length ? r.changed.join(',') : '无变化'))
              return json(res, 200, { ok: true, result: r })
            }
            case 'reloadPlugin': {
              const r = reloadSelf(800)
              if (!r.ok) return json(res, 400, { ok: false, error: r.error })
              log('面板触发重载插件（约 0.8s 后）')
              return json(res, 200, { ok: true, result: { reloading: true, inMs: r.inMs } })
            }
            case 'reconnect': {
              await ob.start({
                homeDir: config.snowlumaHome,
                httpUrl: config.httpUrl,
                wsUrl: config.wsUrl,
                accessToken: config.accessToken,
              })
              return json(res, 200, { ok: true, result: { connection: ob.status } })
            }
            case 'metrics': {
              const snap = metrics.snapshot()
              return json(res, 200, {
                ok: true,
                result: {
                  ...snap,
                  stats: {
                    msgsIn: stats.msgsIn, replies: stats.replies, skipped: stats.skipped,
                    llmCalls: stats.llmCalls, llmErrors: stats.llmErrors, sends: stats.sends,
                    stickersSent: stats.stickersSent, blocked: stats.blocked,
                  },
                  recentErrors: recentErrors(10),
                  usage: usageView(),
                },
              })
            }
            case 'usage':
              return json(res, 200, { ok: true, result: usageView() })
            case 'outbox':
              return json(res, 200, {
                ok: true,
                result: { count: outbox.count, items: outbox.list({ limit: 20 }) },
              })
            case 'flushOutbox':
              await flushOutbox()
              return json(res, 200, { ok: true, result: { count: outbox.count } })
            case 'selftest': {
              const roomId = roomOf(args.room)
              assertGroupAllowed(roomId)
              const data = await ob.call('get_group_msg_history', { group_id: roomId, count: 20 }, 8000)
              const self = String(ob.status.self?.user_id ?? '')
              let ev = null
              for (const m of data?.messages || []) {
                const cand = normalizeEvent(m, self)
                if (!cand.roomId || !cand.text) continue
                if (String(m?.user_id ?? '') === self) continue
                if (!ev || cand.ts >= ev.ts) ev = cand
              }
              if (!ev) return json(res, 400, { ok: false, error: '历史里没有别人发的文本消息可回放' })
              const r0 = roomState(roomId)
              r0.seen.delete(ev.id)
              const before = stats.replies
              const t0 = Date.now()
              void onEvent(ev).catch((e) => log('消息处理失败：' + String(e?.message || e)))
              for (let i = 0; i < 60; i++) {
                if (stats.replies > before) break
                await sleep(500)
              }
              return json(res, 200, {
                ok: true,
                result: {
                  replied: stats.replies > before,
                  totalMs: Date.now() - t0,
                  from: `${ev.senderName}: ${String(ev.text).slice(0, 60)}`,
                  firstTokenMs: stats.lastFirstTokenMs,
                  modelMs: stats.lastLatencyMs,
                },
              })
            }
            case 'selfcheck':
              return json(res, 200, { ok: true, result: await selfcheck() })
            case 'say':
            case 'sendText': {
              const roomId = roomOf(args.room)
              assertGroupAllowed(roomId)
              const text = String(args.text || '').trim()
              if (!text) return json(res, 400, { ok: false, error: 'text 为空' })
              if (config.dryRun) return json(res, 200, { ok: true, result: { dryRun: true } })
              const sayRes = await sendWithRetry(roomId, true, 'text', text)
              if (sayRes.queued) return json(res, 200, { ok: true, result: { queued: true, error: sayRes.error } })
              stats.sends += 1
              return json(res, 200, { ok: true, result: { sent: text } })
            }
            case 'ask': {
              const roomId = roomOf(args.room)
              assertGroupAllowed(roomId)
              const r0 = roomState(roomId)
              const rc = cfgFor(roomId)
              const prompt = String(args.prompt || '').trim() || r0.msgs[r0.msgs.length - 1]?.text || '在吗'
              const user = [
                buildTranscript(r0, Number(rc.contextMessages) || 20),
                '',
                `现在有人对你说：「${prompt}」`,
                '自然地回一句。',
              ].join('\n')
              const t0 = Date.now()
              const out = await generate({ system: systemPrompt(r0), user })
              const sent = await sendReply(r0, { text: out.text, priority: 'at', atUser: args.user })
              return json(res, 200, {
                ok: true,
                result: { firstTokenMs: out.firstTokenMs, totalMs: Date.now() - t0, sent },
              })
            }
            case 'clearRoom': {
              const r0 = rooms.get(roomOf(args.room))
              if (r0) {
                r0.msgs.length = 0
                r0.replyTimes.length = 0
                r0.lastReplyAt = 0
                r0.repliedTexts = []
              }
              return json(res, 200, { ok: true, result: { cleared: true } })
            }
            case 'rooms':
              return json(res, 200, {
                ok: true,
                result: [...rooms.values()].map((r) => ({
                  roomId: r.roomId,
                  name: r.roomName || groupNames.get(r.roomId) || r.roomId,
                  allowed: allowedHere(r),
                  msgs: r.msgs.length,
                })),
              })
            case 'history': {
              const r0 = roomState(roomOf(args.room))
              const n = Math.max(1, Math.min(100, Number(args.limit) || 30))
              return json(res, 200, {
                ok: true,
                result: r0.msgs.slice(-n).map((m) => ({
                  ts: m.ts,
                  who: m.isSelf ? '我' : m.senderName,
                  text: m.text,
                })),
              })
            }
            case 'searchMessages': {
              const roomId = roomOf(args.room)
              // 只允许翻白名单群的历史：其它群一律不碰（读也不行）
              assertGroupAllowed(roomId)
              const q = String(args.query || '').trim()
              if (!q) return json(res, 400, { ok: false, error: 'query 为空' })
              const data = await ob.call('get_group_msg_history', { group_id: roomId, count: 200 }, 10000)
              const hits = []
              for (const m of data?.messages || []) {
                const ev = normalizeEvent(m, ob.status.self?.user_id)
                if (!ev.text || !ev.text.includes(q)) continue
                hits.push({ ts: ev.ts, who: ev.senderName, text: ev.text })
              }
              return json(res, 200, { ok: true, result: hits.slice(-50) })
            }
            case 'memory.list':
              return json(res, 200, {
                ok: true,
                result: { room: roomOf(args.room), facts: factsOf(roomOf(args.room)) },
              })
            case 'memory.add': {
              const ok = addFact(roomOf(args.room), args.add)
              return json(res, 200, { ok: true, result: { added: ok, facts: factsOf(roomOf(args.room)) } })
            }
            case 'memory.del': {
              const ok = delFact(roomOf(args.room), args.text)
              return json(res, 200, { ok: true, result: { deleted: ok, facts: factsOf(roomOf(args.room)) } })
            }
            case 'dsh.restart':
              try {
                return json(res, 200, { ok: true, result: restartDsh() })
              } catch (e) {
                return json(res, 500, { ok: false, error: String(e?.message || e) })
              }
            case 'autostart.get':
              return json(res, 200, {
                ok: true,
                result: {
                  enabled: isAutostartEnabled(),
                  file: autostartFile(),
                  dir: startupDir(),
                  snowlumaHome: config.snowlumaHome,
                },
              })
            case 'autostart.set': {
              const want = args.enabled === true || args.enabled === 'true' || args.enabled === 1
              try {
                const r = setAutostart(want, config.snowlumaHome)
                log('开机自启：' + (r.enabled ? '已开启' : '已关闭') + '（' + r.file + '）')
                return json(res, 200, { ok: true, result: r })
              } catch (e) {
                return json(res, 400, { ok: false, error: String(e?.message || e) })
              }
            }
            case 'backup.now': {
              try {
                return json(res, 200, { ok: true, result: backupNow() })
              } catch (e) {
                return json(res, 500, { ok: false, error: String(e?.message || e) })
              }
            }
            case 'backup.list':
              return json(res, 200, { ok: true, result: { names: backupList() } })
            case 'backup.restore': {
              try {
                return json(res, 200, { ok: true, result: { ...backupRestore(String(args.name || '')), reloaded: true } })
              } catch (e) {
                return json(res, 400, { ok: false, error: String(e?.message || e) })
              }
            }
            case 'curve.get': {
              const rid = roomOf(args.room)
              const r0 = roomState(rid)
              const f = getFeatures().curvePathFor(r0)
              const data = r0.curve || (f ? readJson(f, {}) : {})
              const days = Object.keys(data).sort().slice(-14).map((d) => ({
                day: d,
                m: data[d]?.m || {},
                bond: Number(data[d]?.bond) || 0,
                msgs: Number(data[d]?.msgs) || 0,
              }))
              return json(res, 200, { ok: true, result: { days, moods: Object.keys(MOODS) } })
            }
            case 'memory.update': {
              // 单条记忆就地修改：内容可改，创建时间保留，另记 editedAt
              const rid = roomOf(args.room)
              if (!isManagedRoom(rid)) return json(res, 400, { ok: false, error: '该会话未纳入记忆托管' })
              const oldText = String(args.old || '')
              const newText = String(args.text || '').trim()
              if (!newText) return json(res, 400, { ok: false, error: '内容不能为空' })
              const list = loadFacts(rid)
              const normOld = factNorm(oldText)
              const idx = list.findIndex((x) => factNorm(x.text) === normOld)
              if (idx < 0) return json(res, 404, { ok: false, error: '没找到这条记忆（可能已被删除）' })
              const normNew = factNorm(newText)
              if (list.some((x, i) => i !== idx && factNorm(x.text) === normNew)) {
                return json(res, 400, { ok: false, error: '已经有一条一样的了' })
              }
              list[idx] = { ...list[idx], text: newText, editedAt: Date.now() }
              facts[rid] = list
              writeRoomFacts(memDirOf(rid), list, { keep: 60 })
              log(`记忆已修改：${rid}`)
              return json(res, 200, { ok: true, result: { facts: list } })
            }
            case 'memory.clear': {
              const rid = roomOf(args.room)
              facts[rid] = []
              writeRoomFacts(memDirOf(rid), [], { keep: 60 })
              return json(res, 200, { ok: true, result: { facts: [] } })
            }
            case 'memory.extract': {
              const r = await extractFacts(roomOf(args.room))
              return json(res, 200, { ok: true, result: r })
            }
            case 'memory.profile': {
              const rid = roomOf(args.room)
              const dir = memDirOf(rid)
              if (!dir) return json(res, 400, { ok: false, error: '该会话未纳入记忆托管名单' })
              const t = readRoomText(dir)
              const meta = readRoomMemory(dir).meta || {}
              return json(res, 200, { ok: true, result: { dir, profile: t.profile, summary: t.summary, relations: t.relations, meta } })
            }
            case 'memory.regenProfile': {
              const res2 = await updateProfile(roomState(roomOf(args.room)))
              return json(res, res2.ok ? 200 : 400, { ok: res2.ok, result: res2 })
            }
            case 'memory.regenSummary': {
              const res2 = await updateSummary(roomState(roomOf(args.room)))
              return json(res, res2.ok ? 200 : 400, { ok: res2.ok, result: res2 })
            }
            case 'memory.regenRelations': {
              const res2 = await updateRelations(roomState(roomOf(args.room)))
              return json(res, res2.ok ? 200 : 400, { ok: res2.ok, result: res2 })
            }
            case 'memory.export': {
              const out = exportMemory(roomOf(args.room))
              return json(res, out.ok ? 200 : 400, { ok: out.ok, result: out })
            }
            case 'memory.graph': {
              const rid = roomOf(args.room)
              const dir = memDirOf(rid)
              if (!dir) return json(res, 400, { ok: false, error: '该会话未纳入记忆托管名单' })
              const g = readJson(graphPath(dir), null)
              return json(res, 200, { ok: true, result: g })
            }
            case 'memory.search': {
              const rid = roomOf(args.room)
              const q = String(args.query || '').trim()
              if (!q) return json(res, 400, { ok: false, error: 'query 为空' })
              return json(res, 200, { ok: true, result: searchMemory(rid, q, 10) })
            }
            case 'members': {
              const roomId = roomOf(args.room)
              // 和 searchMessages 一致：只读也限定在白名单群
              assertGroupAllowed(roomId)
              const list = await ob.groupMembers(roomId)
              const r0 = roomState(roomId)
              for (const m of list) {
                const nm = String(m.card || m.nickname || '').trim()
                if (nm) r0.nameCache.set(String(m.user_id), nm)
              }
              return json(res, 200, {
                ok: true,
                result: list.map((m) => ({
                  uid: String(m.user_id),
                  name: String(m.card || m.nickname || m.user_id),
                  role: m.role || '',
                })),
              })
            }
            case 'names.set': {
              const rid = roomOf(args.room)
              const r0 = roomState(rid)
              const uid = String(args.uid || '')
              const nm = String(args.name || '')
              if (uid) {
                r0.nameCache.set(uid, nm)
                savedNames[rid] = savedNames[rid] || {}
                if (nm) savedNames[rid][uid] = nm
                else delete savedNames[rid][uid]
                writeJson(NAMES_FILE, savedNames)
              }
              return json(res, 200, { ok: true })
            }
            case 'names.save': {
              // 面板「群成员」里一次保存多个昵称
              const rid = roomOf(args.room)
              const r0 = roomState(rid)
              const list = Array.isArray(args.list) ? args.list : []
              savedNames[rid] = savedNames[rid] || {}
              let n = 0
              for (const item of list) {
                const uid = String(item?.uid || '')
                if (!uid) continue
                const nm = String(item?.name || '').trim()
                r0.nameCache.set(uid, nm)
                if (nm) savedNames[rid][uid] = nm
                else delete savedNames[rid][uid]
                n += 1
              }
              writeJson(NAMES_FILE, savedNames)
              return json(res, 200, { ok: true, result: { count: n, names: savedNames[rid] } })
            }
            case 'names.add': {
              // 只补显示名（没有 QQ 号时按顺序贴，仅影响面板展示）
              const r0 = roomState(roomOf(args.room))
              let i = 0
              for (const nm of String(args.names || '').split(/[,，、\s]+/).filter(Boolean)) {
                r0.nameCache.set(`manual:${i++}`, nm)
              }
              return json(res, 200, { ok: true, result: { count: r0.nameCache.size } })
            }
            case 'stickers': {
              const limit = Math.max(1, Math.min(200, Number(args.limit) || 80))
              return json(res, 200, {
                ok: true,
                result: Object.entries(stickers)
                  .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
                  .slice(0, limit)
                  .map(([id, s]) => ({
                    id,
                    url: s.url,
                    from: s.from || '',
                    uses: s.uses || 0,
                    subType: s.subType || 0,
                    bad: !!s.bad,
                    favorite: !!s.emojiId,
                    hasFile: !!(s.file && existsSync(s.file)),
                  })),
              })
            }
            case 'sticker.delete': {
              const id = String(args.id || '')
              const st = stickers[id]
              if (!st) return json(res, 404, { ok: false, error: '图库里没有这张' })
              try {
                if (st.file) rmSync(st.file, { force: true })
              } catch {
                /* ignore */
              }
              delete stickers[id]
              try {
                writeJson(STICKERS_FILE, stickers)
              } catch {
                /* ignore */
              }
              markStickersDirty()
              log('图库删除：' + id + (st.from ? '（来自 ' + st.from + '）' : ''))
              return json(res, 200, { ok: true, result: { id, left: Object.keys(stickers).length } })
            }
            case 'sticker.clean': {
              // what: 'bad' 删失效；'image' 删普通图片（subType<1）
              const what = String(args.what || 'bad')
              let removed = 0
              for (const [id, st] of Object.entries(stickers)) {
                const hit = what === 'image' ? Number(st.subType || 0) < 1 : !!st.bad
                if (!hit) continue
                try {
                  if (st.file) rmSync(st.file, { force: true })
                } catch {
                  /* ignore */
                }
                delete stickers[id]
                removed++
              }
              try {
                writeJson(STICKERS_FILE, stickers)
              } catch {
                /* ignore */
              }
              markStickersDirty()
              log('图库批量清理：' + what + ' 删除 ' + removed + ' 张，剩 ' + Object.keys(stickers).length)
              return json(res, 200, { ok: true, result: { removed, left: Object.keys(stickers).length } })
            }
            case 'pickSticker': {
              const keys = Object.keys(stickers).filter((k) => !stickers[k].bad)
              if (!keys.length) return json(res, 200, { ok: true, result: null })
              const k = keys[Math.floor(Math.random() * keys.length)]
              return json(res, 200, { ok: true, result: { id: k, url: stickers[k].url } })
            }
            case 'sendSticker': {
              const roomId = roomOf(args.room)
              assertGroupAllowed(roomId)
              const s = stickers[String(args.stickerId || '')]
              if (!s) return json(res, 400, { ok: false, error: '图库里没有这张' })
              if (s.bad) return json(res, 400, { ok: false, error: '这张已失效（QQ 图片链接过期），换一张吧' })
              if (config.dryRun) return json(res, 200, { ok: true, result: { dryRun: true } })
              const stRes = await sendStickerTo(roomId, s, String(args.stickerId || ''))
              if (!stRes.ok) return json(res, stRes.bad ? 400 : 500, { ok: false, error: stRes.error })
              if (stRes.queued) return json(res, 200, { ok: true, result: { queued: true, error: stRes.error } })
              return json(res, 200, { ok: true })
            }
            default:
              return json(res, 404, { ok: false, error: "未知操作：" + op })
          }
        }
        return json(res, 405, { ok: false, error: 'method not allowed' })
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e?.message || e) })
      }
    }

  return handleRequest
}
