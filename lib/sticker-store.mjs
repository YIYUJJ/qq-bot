/**
 * 图库的持久化部分（收图、脏标记、合并写盘）。
 *
 * 从 index.js 抽出来的第一块业务代码：只碰数据，不碰网络/OneBot。
 * 依赖通过参数注入（config / writeJson / hashStr / mediaKey / log），
 * 这样可以单测，不用启动整个插件。
 */

export function createStickerStore({ stickers, file, config, writeJson, hashStr, mediaKey, log = () => {} }) {
  let dirty = false
  let timer = null
  const FLUSH_MS = 3000

  function flushStickersNow() {
    if (!dirty) return false
    dirty = false
    try {
      writeJson(file, stickers)
      return true
    } catch (e) {
      log('图库写盘失败：' + String(e?.message || e))
      return false
    }
  }

  function markStickersDirty() {
    dirty = true
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      flushStickersNow()
    }, FLUSH_MS)
    if (timer.unref) timer.unref()
  }

  /**
   * 收一张图进图库（只负责数据，下载/收藏由调用方决定）。
   * @returns {string} 图库 id（url 非法时返回空串）
   */
  function rememberSticker(url, from, subType) {
    if (!url || !/^https?:/i.test(url)) return ''
    const id = String(Math.abs(hashStr(mediaKey(url)))).slice(0, 12)
    const cur = stickers[id] || { url, from, at: Date.now(), uses: 0, subType: 0 }
    cur.url = url // 保留最新一次（rkey 会过期）
    cur.at = Date.now()
    cur.from = from || cur.from
    // 1=表情包；收到的如果是普通图就记 0，发的时候按记录决定
    if (subType !== undefined) cur.subType = Number(subType) || 0
    stickers[id] = cur
    // 只在真的超出上限时才排序裁剪
    const max = Math.max(0, Number(config.stickerLibraryMax) || 0)
    const size = Object.keys(stickers).length
    if (max && size > max) {
      const keys = Object.keys(stickers).sort((a, b) => stickers[a].at - stickers[b].at)
      while (keys.length > max) delete stickers[keys.shift()]
    }
    markStickersDirty()
    return id
  }

  return {
    markStickersDirty,
    flushStickersNow,
    rememberSticker,
    get dirty() {
      return dirty
    },
    /** 测试/退出前用：取消 pending 并立即写盘 */
    dispose() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      return flushStickersNow()
    },
  }
}
