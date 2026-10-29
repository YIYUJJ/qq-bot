/**
 * 自动抽取的模块：onEvent
 *
 * 依赖注入（缺一个启动即报错，避免运行到一半才炸）。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveDocPython, extractDocText } from './extras.mjs'
import { newTraceId } from './metrics.mjs'
export const CREATEONEVENT_DEPS = ["VIDEO_DIR","allowedHere","attachVision","cfgFor","config","describeVideo","docLibDir","ensureStickerFile","favoriteSticker","getFeatures","handleNotice","inferMood","log","metrics","ob","rememberSticker","rememberVideo","roomState","scheduleFlush","stats","stickers"]

export function createOnEvent(deps) {
  const missing = CREATEONEVENT_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('onEvent 缺少依赖：' + missing.join(', '))
  const { VIDEO_DIR, allowedHere, attachVision, cfgFor, config, describeVideo, docLibDir, ensureStickerFile, favoriteSticker, getFeatures, handleNotice, inferMood, log, metrics, ob, rememberSticker, rememberVideo, roomState, scheduleFlush, stats, stickers } = deps

  async function onEvent(ev) {
    if (ev?.notice) {
      void handleNotice(ev.notice).catch((e) => log('拍一拍处理失败：' + String(e?.message || e)))
      return
    }
    if (!ev?.roomId) return
    const r = roomState(ev.roomId)
    // 群/私聊必须按事件判断：群号和 QQ 号都是 9~10 位，靠长度猜会把私聊当群
    if (typeof ev.isGroup === 'boolean') r.isGroup = ev.isGroup
    // 去重：WS 推送与轮询兜底可能送同一条
    if (ev.id && r.seen.has(ev.id)) return
    if (ev.id) {
      r.seen.add(ev.id)
      if (r.seen.size > 600) r.seen.delete(r.seen.values().next().value)
    }
    stats.msgsIn += 1
    metrics.inc('msgsIn')
    if (ev.senderName) {
    r.traceId = r.traceId || newTraceId()
      r.nameCache.set(String(ev.sender), ev.senderName)
      if (r.nameCache.size > 500) r.nameCache.delete(r.nameCache.keys().next().value)
    }
    // 群里的表情包顺手收进图库（sub_type>=1 才是表情；普通照片不当表情包，免得被乱发）
    if (!ev.isSelf && ev.imageUrls?.length) {
      ev.imageUrls.forEach((u, i) => {
        const sub = Number(ev.imageSubTypes?.[i] ?? 0)
        if (!(sub >= 1)) return // 普通图片：只识图，不进表情库
        const sid = rememberSticker(u, ev.senderName, sub)
        const st = sid ? stickers[sid] : null
        if (!st) return
        // 立刻存一份到本地：QQ 的图片链接几小时就过期，不存就再也发不出去
        void ensureStickerFile(st, sid).catch(() => {})
        // sub_type>=1 都是表情类（1=表情，7=另一变体）；顺手收进 QQ 收藏（服务端持久化，发出去是表情气泡）
        if (sub >= 1) void favoriteSticker(st, u, sid)
      })
    }
    const entry = {
      id: ev.id,
      ts: ev.ts,
      sender: ev.sender,
      senderName: ev.senderName || ev.sender,
      isSelf: ev.isSelf,
      isAtMe: ev.isAtMe,
      text: ev.text,
      images: ev.images,
    }
    r.msgs.push(entry)
    if (r.msgs.length > 200) r.msgs.splice(0, r.msgs.length - 200)
    r.lastActivityAt = Date.now()
    // 记忆增强：原文归档（可选依赖；只归档托管会话，失败不影响聊天）
    if (typeof deps.archiveMsg === 'function') {
      try { deps.archiveMsg(r, entry) } catch { /* ignore */ }
    }

    // 没有群名片时去补一次真实昵称（每个 sender 10 分钟内只查一次）
    if (config.useDbMembers && r.isGroup && (!ev.senderName || ev.senderName === String(ev.sender))) {
      const sid = String(ev.sender)
      const cached = r.nameCache.get(sid)
      if (cached) {
        entry.senderName = cached
      } else {
        r.nameFetched = r.nameFetched || new Map()
        if (Date.now() - (r.nameFetched.get(sid) || 0) > 600000) {
          r.nameFetched.set(sid, Date.now())
          void ob
            .groupMember(r.roomId, sid)
            .then((m) => {
              const nm = String(m?.card || m?.nickname || '').trim()
              if (nm) {
                r.nameCache.set(sid, nm)
                entry.senderName = nm
              }
            })
            .catch(() => {})
        }
      }
    }

    if (ev.isSelf || !ev.text) return
    if (!allowedHere(r)) {
      stats.blocked += 1
      if (stats.blocked % 20 === 1) log(`忽略未授权会话 ${r.roomId}（${ev.senderName}）`)
      return
    }
    if (!config.enabled) return

    // 识图：异步补描述（回复前最多等 4 秒），失败不影响聊天
    // 注意：QQ 的"表情包"是 image 段 + sub_type>0，不是 mface；按 sub_type 决定用哪个开关
    if ((ev.images || 0) > 0 && ev.imageUrls?.length) {
      const kinds = ev.imageUrls.map((_, i) => (Number(ev.imageSubTypes?.[i]) > 0 ? 'mface' : 'image'))
      const p = attachVision(entry, ev.imageUrls, kinds, cfgFor(r.roomId)).catch(() => {})
      r.visionPending = r.visionPending || new Set()
      r.visionPending.add(p)
      void p.finally(() => r.visionPending.delete(p))
    }

    // 视频：下载 + 抽帧 + 视觉模型看一眼（后台跑，回复前最多等 videoWaitMs）
    if (ev.videoUrls?.length) {
      const c0 = cfgFor(r.roomId)
      if (c0.videoOnMessage) {
        const p = (async () => {
          const v = await describeVideo(ev.videoUrls[0], c0)
          if (v?.files?.length) r.videoFiles = [...(r.videoFiles || []), ...v.files]
          if (v?.desc) {
            entry.text = String(entry.text || '').replace('[video]', '[视频：' + v.desc + ']')
            entry.video = v
            // 提炼成一条长期记忆：以后聊到"那个视频"能想起来
            rememberVideo(r, v, null)
          }
        })().catch(() => {})
        r.videoPending = r.videoPending || new Set()
        r.videoPending.add(p)
        void p.finally(() => r.videoPending.delete(p))
      }
    }
    // 亲密度：有人说话就涨一点（只对托管群持久化）
    getFeatures().bumpBond(r, ev.sender, 1)
    // 我们之间的故事（记忆深化第 4 项）：初次见面、聊过几天、被夸 / 被凶（@ 我或回复我时）
    if (typeof deps.storyOnMessage === 'function') {
      const toMe = !!ev.isAtMe || !!(ev.replyId && r.botMsgIds?.has(String(ev.replyId)))
      try { deps.storyOnMessage(r, entry, toMe) } catch { /* 故事记录失败不影响聊天 */ }
    }
    // 合并转发：把里面的聊天记录读出来
    if (ev.forwardId) {
      const fp = (async () => {
        try {
          const d = await ob.call('get_forward_msg', { id: ev.forwardId, message_id: ev.forwardId }, 10000)
          const list = d?.messages || d?.message || []
          const lines = []
          for (const m of list.slice(0, 30)) {
            const segs = Array.isArray(m?.message) ? m.message : []
            const txt = segs.filter((x) => x?.type === 'text').map((x) => x?.data?.text || '').join('')
            const who = String(m?.sender?.card || m?.sender?.nickname || m?.sender?.user_id || '')
            if (txt) lines.push((who ? who + ': ' : '') + txt.slice(0, 80))
          }
          if (lines.length) {
            entry.forward = lines.join('\n').slice(0, 1200)
            ev.forward = entry.forward // 待处理队列里是 ev
            entry.text = String(entry.text || '').replace('[聊天记录]', '[聊天记录：' + lines.length + ' 条]')
            log('读合并转发：' + lines.length + ' 条')
          }
        } catch (e) {
          log('读合并转发失败：' + String(e?.message || e))
        }
      })()
      // 与文档一样：回复前等它读完（最多 8 秒），否则第一句会"没看到"转发内容
      r.forwardPending = r.forwardPending || new Set()
      r.forwardPending.add(fp)
      void fp.finally(() => r.forwardPending.delete(fp))
    }
    // 文档：下载 + 取正文（后台跑，回复前最多等 8 秒）
    if (ev.files?.length) {
      const cf = cfgFor(r.roomId)
      if (cf.docOnFile) {
        const dp = (async () => {
          const f = ev.files[0]
          const maxBytes = Math.max(1, Number(cf.docMaxMB) || 20) * 1024 * 1024
          try {
            const res = await fetch(f.url, { signal: AbortSignal.timeout(30000) })
            if (!res.ok) throw new Error('HTTP ' + res.status)
            const buf = Buffer.from(await res.arrayBuffer())
            if (buf.length > maxBytes) throw new Error('文件过大 ' + Math.round(buf.length / 1024 / 1024) + 'MB')
            if (!existsSync(VIDEO_DIR)) mkdirSync(VIDEO_DIR, { recursive: true })
            const ext = String(f.name || '').split('.').pop().toLowerCase()
            const tmp = join(VIDEO_DIR, 'doc-' + Date.now() + '.' + (ext || 'bin'))
            writeFileSync(tmp, buf)
            const got = await extractDocText(tmp, ext, {
              py: resolveDocPython(),
              libDir: docLibDir,
              maxChars: Number(cf.docChars) || 3000,
            })
            try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
            if (got.ok && String(got.text || '').trim()) {
              entry.doc = { name: f.name || 'file', text: String(got.text).slice(0, Number(cf.docChars) || 3000) }
              ev.doc = entry.doc // 待处理队列里是 ev，不是 entry，两边都放一份
              entry.text = String(entry.text || '').replace('[file]', '[文件：' + (f.name || 'file') + ']')
              log('读文件：' + (f.name || 'file') + '｜' + entry.doc.text.length + ' 字')
            } else {
              log('读文件失败：' + (got.error || '没取到文字'))
            }
          } catch (e) {
            log('读文件失败：' + String(e?.message || e))
          }
        })().catch(() => {})
        r.docPending = r.docPending || new Set()
        r.docPending.add(dp)
        void dp.finally(() => r.docPending.delete(dp))
      }
    }
    // 情绪：被夸会得意、被说会蔫、深夜会困（纯规则，立刻生效）
    try { inferMood(r, entry.text) } catch { /* 心情推断失败不影响聊天 */ }
    r.pending.push(ev)
    scheduleFlush(r)
  }

  return onEvent
}
