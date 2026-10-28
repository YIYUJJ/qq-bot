/**
 * 媒体缓存与键归一：识图缓存（vision-cache）+ QQ 图片 URL 的稳定 key + MIME 猜测。
 */
import { join } from 'node:path'
import { createVisionCache } from './vision-cache.mjs'

export const MEDIA_CACHE_DEPS = ['DATA_DIR', 'config', 'log', 'readJson', 'writeJson']

export function createMediaCache(deps) {
  const missing = MEDIA_CACHE_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('媒体缓存缺少依赖：' + missing.join(', '))
  const { DATA_DIR, config, log, readJson, writeJson } = deps

  const vision = createVisionCache({ file: join(DATA_DIR, 'vision-cache.json'), config, readJson, writeJson, log })
  const visionCache = vision.cache
  const visionKey = (url) => vision.key(url)
  const trimVisionCache = () => vision.trim()

  /** QQ 的图片 URL 带会轮换的 rkey，直接当缓存键会永远 miss；只保留稳定参数。 */
  function mediaKey(url) {
    try {
      const u = new URL(String(url))
      const keep = new URLSearchParams()
      for (const k of ['fileid', 'appid', 'file', 'md5']) {
        const v = u.searchParams.get(k)
        if (v) keep.set(k, v)
      }
      const qs = keep.toString()
      return qs ? `${u.origin}${u.pathname}?${qs}` : `${u.origin}${u.pathname}`
    } catch {
      return String(url || '')
    }
  }

  function guessMediaType(res, url) {
    const ct = String(res?.headers?.get?.('content-type') || '').toLowerCase()
    if (ct.includes('png')) return 'image/png'
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'image/jpeg'
    if (ct.includes('webp')) return 'image/webp'
    if (ct.includes('gif')) return 'image/gif'
    const u = String(url || '').toLowerCase().split('?')[0]
    if (u.endsWith('.png')) return 'image/png'
    if (u.endsWith('.webp')) return 'image/webp'
    if (u.endsWith('.gif')) return 'image/gif'
    return 'image/jpeg'
  }

  return { vision, visionCache, visionKey, trimVisionCache, mediaKey, guessMediaType }
}
