import { join } from 'node:path'
import { createVisionCache } from './vision-cache.mjs'
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'

/**
 * 媒体缓存与键归一：识图缓存（vision-cache）+ QQ 图片 URL 的稳定 key + MIME 猜测。
 */

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

/**
 * 视频临时目录与外部工具路径：启动时清残留 + ffmpeg/ffprobe 定位。
 */

export const VIDEO_FILES_DEPS = ['DATA_DIR', 'config', 'log']

export function createVideoFiles(deps) {
  const missing = VIDEO_FILES_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('视频文件工具缺少依赖：' + missing.join(', '))
  const { DATA_DIR, config, log } = deps

  const VIDEO_DIR = join(DATA_DIR, 'video-tmp')

  /** 启动时清掉残留（正常流程回复完会自己删；这里兜底异常退出留下的）。 */
  function cleanupTmp(maxAgeMs = 2 * 3600 * 1000) {
    let removed = 0
    try {
      if (!existsSync(VIDEO_DIR)) return 0
      for (const n of readdirSync(VIDEO_DIR)) {
        const fp = join(VIDEO_DIR, n)
        try {
          if (Date.now() - statSync(fp).mtimeMs > maxAgeMs) {
            rmSync(fp, { force: true, recursive: true })
            removed += 1
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    if (removed) log(`已清理视频临时文件 ${removed} 个`)
    return removed
  }

  function ffmpegBin() {
    return String(config.ffmpegPath || 'ffmpeg')
  }

  function ffprobeBin() {
    if (config.ffmpegPath) {
      return String(config.ffmpegPath).replace(/ffmpeg(\.exe)?$/i, (m) => m.replace(/ffmpeg/i, 'ffprobe'))
    }
    return 'ffprobe'
  }

  cleanupTmp()

  return { VIDEO_DIR, ffmpegBin, ffprobeBin, cleanupTmp }
}
