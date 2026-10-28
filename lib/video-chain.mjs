/**
 * 视频链路：describeVideo（抽帧拼图 + 视觉描述）+ 视频结果缓存。
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeContactSheet, downloadTo, probeDuration } from './video.mjs'

export const VIDEO_CHAIN_DEPS = ["config","log","describeBuffer","ffmpegBin","ffprobeBin","VIDEO_DIR","hashStr","videoCache","VIDEO_CACHE_FILE","writeJson"]

export function createVideoChain(deps) {
  const missing = VIDEO_CHAIN_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('视频链路缺少依赖：' + missing.join(', '))
  const { config, log, describeBuffer, ffmpegBin, ffprobeBin, VIDEO_DIR, hashStr, videoCache, VIDEO_CACHE_FILE, writeJson } = deps

  function videoKey(url) {
    const u = String(url || '')
    if (/^https?:/i.test(u)) return 'url:' + hashStr(u.split('?')[0])
    try {
      const st = statSync(u)
      return 'file:' + hashStr(u) + ':' + st.size + ':' + Math.round(st.mtimeMs)
    } catch {
      return 'raw:' + hashStr(u)
    }
  }

  function videoCacheGet(key) {
    const hit = videoCache[key]
    if (!hit) return null
    if (Date.now() - (hit.at || 0) > 14 * 86400000) return null
    return hit
  }

  function videoCacheSet(key, text, duration, meta) {
    videoCache[key] = { text, duration, at: Date.now(), ...(meta || {}) }
    const keys = Object.keys(videoCache)
    if (keys.length > 120) {
      keys.sort((a, b) => (videoCache[a].at || 0) - (videoCache[b].at || 0))
      for (const k of keys.slice(0, keys.length - 120)) delete videoCache[k]
    }
    try { writeJson(VIDEO_CACHE_FILE, videoCache) } catch { /* ignore */ }
  }

  async function describeVideo(url, c = null) {
    const eff = c || config
    if (!eff.videoOnMessage) return { desc: '', duration: 0 }
    const started = Date.now()
    const made = []
    let file = ''
    // 同一条视频看过就不再下、不再抽帧、不再问模型
    const ck = videoKey(url)
    const hit = videoCacheGet(ck)
    if (hit?.text) {
      log('看视频命中缓存：' + hit.text.slice(0, 30))
      return { desc: hit.text, duration: Number(hit.duration) || 0, files: [] }
    }
    try {
      if (!existsSync(VIDEO_DIR)) mkdirSync(VIDEO_DIR, { recursive: true })
      const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      const sheetPath = join(VIDEO_DIR, stamp + '.jpg')
      const frames = Number(eff.videoFrames) || 6
      const maxSeconds = Number(eff.videoMaxSeconds) || 300
      let dur = 0
      let sheet = ''
      // 远程视频先下载（QQ 的 CDN 下载很快；直连读流遇到"索引在文件尾"的 mp4 会变成读全片）
      if (/^https?:/i.test(url)) {
        const maxBytes = Math.max(1, Number(eff.videoMaxMB) || 80) * 1024 * 1024
        file = await downloadTo(url, join(VIDEO_DIR, stamp + '.mp4'), { timeoutMs: 45000, maxBytes })
        made.push(file)
      } else if (/^file:/i.test(url)) {
        file = fileURLToPath(url)
      } else if (existsSync(url)) {
        file = url
      }
      if (!file || !existsSync(file)) throw new Error('拿不到视频文件')
      dur = await probeDuration(file, { ffprobe: ffprobeBin() })
      sheet = await makeContactSheet(file, sheetPath, { frames, width: Number(eff.videoSheetWidth) || 480, maxSeconds, ffmpeg: ffmpegBin() })
      if (sheet) made.push(sheet)
      if (!sheet) throw new Error('抽帧失败')
      const msFrames = Date.now() - started
      const tVision = Date.now()
      const buf = readFileSync(sheet)
      const desc = await describeBuffer(
        buf,
        'image/jpeg',
        'image',
        '这是视频的几帧画面。用一句话说清它在讲什么、画面里有什么；别客套，别提"拼图"。',
      )
      const msVision = Date.now() - tVision
      const out = String(desc || '').replace(/\s+/g, ' ').trim().slice(0, 260)
      log('看视频' + (dur ? '（' + Math.round(dur) + ' 秒）' : '') + '：' + (out ? '成功' : '没描述出来') + `｜下载+抽帧 ${msFrames}ms 视觉 ${msVision}ms｜总 ${Date.now() - started}ms`)
      if (out) {
        // 记下来源：本地文件用原路径（源文件删了下次启动就清缓存），URL 交给 TTL
        const source = /^https?:/i.test(url) ? '' : /^file:/i.test(url) ? fileURLToPath(url) : url
        videoCacheSet(ck, out, dur, source ? { kind: 'file', source } : { kind: 'url' })
      }
      return { desc: out, duration: dur, files: made }
    } catch (e) {
      log('看视频失败：' + String(e?.message || e))
      return { desc: '', duration: 0, files: made }
    }
  }
  return { describeVideo, videoKey, videoCacheGet, videoCacheSet }
}
