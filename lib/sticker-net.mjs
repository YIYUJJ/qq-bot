/**
 * 表情包网络链路：本地化（下载到本地）、收进 QQ 收藏、按图库 id 发送、图库维护。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const STICKER_NET_DEPS = ["config","log","ob","roomState","sendWithRetry","sleep","stats","stickers","STICKER_DIR","hashStr","mediaKey","markStickersDirty"]

export function createStickerNet(deps) {
  const missing = STICKER_NET_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('表情链路缺少依赖：' + missing.join(', '))
  const { config, log, ob, roomState, sendWithRetry, sleep, stats, stickers, STICKER_DIR, hashStr, mediaKey, markStickersDirty } = deps

  async function ensureStickerFile(s, id) {
    if (s.file && existsSync(s.file)) return s.file
    if (!s.url) throw new Error('没有 url')
    const res = await fetch(s.url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error('HTTP download failed: ' + res.status)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 6 * 1024 * 1024) throw new Error('图片过大')
    const ct = String(res.headers.get('content-type') || '').toLowerCase()
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg'
    mkdirSync(STICKER_DIR, { recursive: true })
    const key = String(id || Math.abs(hashStr(mediaKey(s.url)))).replace(/[^\w.-]/g, '_')
    const file = join(STICKER_DIR, key + '.' + ext)
    writeFileSync(file, buf)
    s.file = file
    s.cachedAt = Date.now()
    markStickersDirty()
    return file
  }

  /**
   * 收进 QQ 收藏表情，返回 { ok, emojiId?, already?, skipped?, error? }。
   * 自动收（群里收到表情时）受「收进 QQ 收藏表情」开关和数量上限管；
   * 面板上手动点「收藏」时传 { manual: true }：不看开关和上限（是你明确要收的）。
   */
  async function favoriteSticker(s, url, id, opts) {
    const manual = !!(opts && opts.manual)
    if (!manual && !config.stickerFavorite) return { ok: false, skipped: 'off' }
    if (!s) return { ok: false, error: '图库里没有这张' }
    if (s.emojiId) return { ok: true, already: true, emojiId: s.emojiId }
    const max = Math.max(0, Number(config.stickerFavoriteMax) || 60)
    if (!manual && max && Object.keys(stickers).length > max) return { ok: false, skipped: 'max' }
    const save = (eid) => {
      s.emojiId = String(eid)
      s.favoriteAt = Date.now()
      markStickersDirty()
      log(`表情已收进 QQ 收藏${manual ? '（面板手动）' : ''}：${String(eid).slice(0, 28)}…`)
      return { ok: true, emojiId: s.emojiId }
    }
    let error = ''
    if (url) {
      try {
        const res = await ob.call('add_custom_face', { file: url }, 25000)
        // ob.call 已经把 data 解包了；两种形状都兼容
        const eid = res?.emoji_id || res?.data?.emoji_id
        if (eid) return save(eid)
      } catch (e) {
        /* URL 加不进去就转 base64 再试 */
        error = String(e?.message || e)
      }
    }
    try {
      const file = await ensureStickerFile(s, id)
      const b64 = readFileSync(file).toString('base64')
      const res2 = await ob.call('add_custom_face', { file: 'base64://' + b64 }, 25000)
      const eid2 = res2?.emoji_id || res2?.data?.emoji_id
      if (eid2) return save(eid2)
      error = '接口没返回 emoji_id'
      log('收进收藏失败：' + error)
    } catch (e) {
      error = String(e?.message || e).slice(0, 120)
      log('收进收藏失败：' + error)
    }
    return { ok: false, error }
  }

  async function sendStickerTo(roomId, s, id) {
    // ① 收藏表情：QQ 原生表情气泡，且不依赖会过期的 URL
    if (s.emojiId && config.stickerFavorite) {
      try {
        await ob.call('send_custom_face', { group_id: roomId, emoji_id: s.emojiId }, 25000)
        s.uses = (s.uses || 0) + 1
        s.at = Date.now()
        stats.stickersSent += 1
        roomState(roomId).lastStickerAt = Date.now()
        markStickersDirty()
        return { ok: true, via: 'favorite' }
      } catch (e) {
        const msg = String(e?.message || e)
        // 收藏被删/无效 → 清掉标记，走图片兜底
        if (/emoji|face|not.?found|不存在|400|invalid/i.test(msg)) {
          delete s.emojiId
          markStickersDirty()
        }
      }
    }
    // 兜底用 image 段：sub_type 统一用 1（其它变体号某些客户端不认），并带 summary
    const st = 1
    if (!s.url && !s.file) return { ok: false, error: '这张既没有收藏也没有本地文件，发不了' }
    let file = ''
    try {
      file = await ensureStickerFile(s, id)
    } catch {
      /* 下载不下来就用原 URL（多半也过期了） */
    }
    // summary 也要带上，客户端才会按"表情"渲染
    const seg = file
      ? { type: 'image', data: { file: 'file:///' + file.replace(/\\/g, '/'), sub_type: st, summary: '[动画表情]' } }
      : { type: 'image', data: { file: s.url, sub_type: st, summary: '[动画表情]' } }
    try {
      const res = await sendWithRetry(roomId, true, 'segments', [seg])
      if (res.queued) return { ok: true, queued: true, error: res.error }
      s.uses = (s.uses || 0) + 1
      s.at = Date.now()
      stats.stickersSent += 1
      roomState(roomId).lastStickerAt = Date.now()
      markStickersDirty()
      return { ok: true, via: file ? 'file' : 'url' }
    } catch (e) {
      const msg = String(e?.message || e)
      // 只有"用过期 URL 且明确下载失败"才标记作废（本地文件失败不算 URL 的错）
      if (!file && /download failed|retcode 100|HTTP 400|失效|过期/i.test(msg)) {
        s.bad = true
        s.badAt = Date.now()
        markStickersDirty()
        return { ok: false, bad: true, error: '这张已失效（QQ 图片链接过期，且本地没有缓存），已从轮换里移除' }
      }
      return { ok: false, error: msg }
    }
  }

  async function sweepStickerLibrary() {
    // 顺手清掉失效超过 7 天的条目，别让图库永远挂着死链
    let pruned = 0
    for (const k of Object.keys(stickers)) {
      const s = stickers[k]
      if (s.bad && s.badAt && Date.now() - s.badAt > 7 * 86400000) {
        delete stickers[k]
        pruned += 1
      }
    }
    const ids = Object.keys(stickers).filter(
      (k) =>
        !stickers[k].bad &&
        !stickers[k].emojiId && // 已收进收藏的，不依赖 URL，别再扫
        stickers[k].url &&
        !(stickers[k].file && existsSync(stickers[k].file)),
    )
    let ok = 0
    let bad = 0
    for (const id of ids) {
      try {
        await ensureStickerFile(stickers[id], id)
        ok += 1
      } catch {
        stickers[id].bad = true
        stickers[id].badAt = Date.now()
        bad += 1
      }
      await sleep(120)
    }
    // 有本地文件但还没进收藏的表情，顺手补进收藏（之后发出去才是气泡）
    let favored = 0
    for (const id of Object.keys(stickers)) {
      const s = stickers[id]
      if (s.bad || s.emojiId || !s.file || !existsSync(s.file)) continue
      if (Number(s.subType) < 1) continue
      const before = s.emojiId
      await favoriteSticker(s, '', id)
      if (!before && s.emojiId) favored += 1
      await sleep(150)
    }
    markStickersDirty()
    log(
      `图库本地化完成：可用 ${ok} 张，标记失效 ${bad} 张${favored ? `，补进收藏 ${favored} 张` : ''}${pruned ? `，清理旧失效 ${pruned} 张` : ''}`,
    )
  }
  return { ensureStickerFile, favoriteSticker, sendStickerTo, sweepStickerLibrary }
}
