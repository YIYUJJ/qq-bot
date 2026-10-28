/**
 * 识图结果缓存（图库/识图共用）。
 *
 * 从 index.js 抽出：URL 归一化 key、按上限裁剪、落盘。
 * QQ 图片链接带时效参数，key 要保留有意义的查询参数、丢掉易变的。
 */

export function createVisionCache({ file, config, readJson, writeJson, log = () => {} }) {
  const cache = readJson(file, {}) || {}
  let dirty = false

  /** 把 URL 归一化成稳定 key（去掉时效性参数，保留 fileid 之类） */
  function key(url) {
    try {
      const u = new URL(String(url))
      const keep = new URLSearchParams()
      for (const [k, v] of u.searchParams) {
        if (/^(fileid|appid|file|id|md5|size)$/i.test(k)) keep.set(k, v)
      }
      const qs = keep.toString()
      return qs ? `${u.origin}${u.pathname}?${qs}` : `${u.origin}${u.pathname}`
    } catch {
      return String(url || '')
    }
  }

  function get(url) {
    const hit = cache[key(url)]
    if (!hit) return null
    if (hit.text && Date.now() - (hit.at || 0) < 7 * 86400000) return hit
    if (hit.err && Date.now() - (hit.at || 0) < 600000) return hit
    return null
  }

  function set(url, value) {
    cache[key(url)] = { ...value, at: Date.now() }
    dirty = true
    trim()
  }

  function trim() {
    const keys = Object.keys(cache)
    const max = Math.max(20, Number(config.visionCacheMax) || 300)
    if (keys.length <= max) return 0
    keys.sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0))
    const drop = keys.slice(0, keys.length - max)
    for (const k of drop) delete cache[k]
    return drop.length
  }

  function persist() {
    if (!dirty) return false
    try {
      writeJson(file, cache)
      dirty = false
      return true
    } catch (e) {
      log('识图缓存写盘失败：' + String(e?.message || e))
      return false
    }
  }

  return { cache, key, get, set, trim, persist, get dirty() { return dirty } }
}
