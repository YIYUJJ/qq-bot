/**
 * 视频相关的小工具：本地/远程视频抽帧拼图、链接取信息/字幕。
 * 只依赖 ffmpeg / ffprobe / yt-dlp（都在本机，不走任何云服务）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

/** 从一段文字里挑出像视频平台的链接（B站/抖音/YouTube/快手/小红书） */
const VIDEO_HOST_RE = /(bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com|youtube\.com|youtu\.be|kuaishou\.com|xiaohongshu\.com|xhslink\.com)/i
const URL_RE = /https?:\/\/[^\s，。！？、；）)】"'<>]+/g

export function pickVideoLinks(text, max = 1) {
  const out = []
  for (const m of String(text || '').matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:!?]+$/, '')
    if (VIDEO_HOST_RE.test(u) && !out.includes(u)) out.push(u)
    if (out.length >= max) break
  }
  return out
}

/** yt-dlp 不在 PATH 时的常见装法（pip --user / 便携版） */
export function resolveYtdlp() {
  const cands = []
  const appdata = process.env.APPDATA
  if (appdata) {
    for (const v of ['315', '314', '313', '312']) cands.push(join(appdata, 'Python', `Python${v}`, 'Scripts', 'yt-dlp.exe'))
  }
  if (process.env.LOCALAPPDATA) cands.push(join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'Scripts', 'yt-dlp.exe'))
  for (const p of cands) if (existsSync(p)) return p
  return 'yt-dlp'
}

function run(cmd, args, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let done = false
    let child
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch (e) {
      return resolve({ ok: false, code: -1, stdout: '', stderr: String(e?.message || e) })
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      resolve({ ok: false, code: -2, stdout: out, stderr: err || 'timeout' })
    }, timeoutMs)
    if (timer.unref) timer.unref()
    child.stdout.on('data', (b) => { out += String(b) })
    child.stderr.on('data', (b) => { err += String(b) })
    child.on('error', (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok: false, code: -1, stdout: out, stderr: String(e?.message || e) })
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok: code === 0, code, stdout: out, stderr: err })
    })
  })
}

/** 视频时长（秒）；本地文件和 http 链接都行；失败返回 0 */
export async function probeDuration(file, { ffprobe = 'ffprobe', timeoutMs = 10000 } = {}) {
  const r = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeoutMs })
  if (!r.ok) return 0
  const n = Number(String(r.stdout).trim())
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * 抽 N 帧拼成一张图。
 *
 * 速度关键：不是"整片解码 + fps 采样"，而是**按时间点并行 seek**（-ss 放在 -i 前，只读关键帧附近），
 * 所以 10 分钟的视频也只读几个小片段，不随片长线性变慢。
 * 传入 http(s) 地址时 ffmpeg 直接读网络流（需要服务端支持 Range），不必先把整段视频下载到本地。
 */
export async function makeContactSheet(file, outPath, {
  frames = 6, width = 480, maxSeconds = 300, ffmpeg = 'ffmpeg', timeoutMs = 30000,
} = {}) {
  const dur0 = await probeDuration(file, { ffprobe: String(ffmpeg).replace(/ffmpeg/i, 'ffprobe') })
  const dur = dur0 > 0 ? Math.min(dur0, maxSeconds) : Math.min(30, maxSeconds)
  const n = Math.max(2, Math.min(12, Number(frames) || 6))
  const cols = n <= 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  const cellW = Math.max(160, Math.min(720, Number(width) || 480))
  const cellH = Math.round(cellW * 9 / 16 / 2) * 2
  const work = join(dirname(outPath), 'sheet-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7))

  try {
    mkdirSync(work, { recursive: true })
    // 1) 并行 seek 抽帧（每帧一次 ffmpeg，互不等待）
    const times = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * dur)
    const framesOut = await Promise.all(times.map(async (t, i) => {
      const o = join(work, `f${String(i).padStart(2, '0')}.jpg`)
      const args = [
        '-y', '-loglevel', 'error',
        '-ss', t.toFixed(2),          // 关键：放在 -i 前 → 快速 seek，不解全片
        '-i', file,
        '-frames:v', '1',
        '-vf', `scale=${cellW}:${cellH}:force_original_aspect_ratio=decrease,pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
        '-an', '-threads', '1', '-q:v', '5',
        o,
      ]
      const r = await run(ffmpeg, args, { timeoutMs: Math.min(timeoutMs, 20000) })
      return existsSync(o) ? o : r.ok === false ? '' : ''
    }))
    const valid = framesOut.filter(Boolean)
    if (!valid.length) return ''

    // 2) 拼图：先把每帧当一路输入，concat 成序列再 tile（部分帧失败也能拼）
    const inputs = []
    for (const f of valid) inputs.push('-i', f)
    const chains = valid.map((_, i) => `[${i}:v]null[v${i}]`).join(';')
    const filter = `${chains};${valid.map((_, i) => `[v${i}]`).join('')}concat=n=${valid.length}:v=1:a=0,tile=${cols}x${rows}:padding=4:margin=4[out]`
    await run(ffmpeg, [
      '-y', '-loglevel', 'error', ...inputs,
      '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-q:v', '4', outPath,
    ], { timeoutMs: Math.min(timeoutMs, 20000) })
    if (!existsSync(outPath)) return ''
    return outPath
  } catch {
    return ''
  } finally {
    try { rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

/** 下载到本地文件（有大小上限），返回本地路径；失败抛错 */
export async function downloadTo(url, dest, { timeoutMs = 40000, maxBytes = 80 * 1024 * 1024 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error('下载失败 HTTP ' + res.status)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new Error(`视频过大 ${Math.round(buf.length / 1024 / 1024)}MB`)
  const { writeFileSync } = await import('node:fs')
  writeFileSync(dest, buf)
  return dest
}

/** yt-dlp 取元信息（标题/时长/上传者/简介），不下载视频 */
export async function ytdlpInfo(url, { timeoutMs = 20000 } = {}) {
  const bin = resolveYtdlp()
  const r = await run(bin, [
    '--dump-single-json', '--skip-download', '--no-warnings', '--no-playlist',
    '--extractor-args', 'youtube:player_client=web', url,
  ], { timeoutMs })
  if (!r.ok) return { ok: false, error: (r.stderr || 'yt-dlp 失败').slice(0, 300) }
  try {
    const j = JSON.parse(r.stdout)
    return {
      ok: true,
      title: String(j.title || ''),
      duration: Number(j.duration) || 0,
      uploader: String(j.uploader || j.channel || ''),
      description: String(j.description || '').slice(0, 600),
      webpage: String(j.webpage_url || url),
    }
  } catch (e) {
    return { ok: false, error: '解析 yt-dlp 输出失败：' + String(e?.message || e) }
  }
}

/** 取字幕并清成纯文本（优先人工字幕，其次自动字幕）；没有就返回 '' */
export async function ytdlpSubtitleText(url, { timeoutMs = 25000, maxChars = 1200, dir } = {}) {
  const bin = resolveYtdlp()
  const base = dir || process.env.TEMP || '.'
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 7)
  const work = join(base, 'qvb-sub-' + stamp)
  try {
    mkdirSync(work, { recursive: true })
  } catch {
    return ''
  }
  try {
    await run(bin, [
      '--skip-download', '--no-warnings', '--no-playlist',
      '--write-subs', '--write-auto-subs', '--sub-langs', 'zh.*,zh,en.*,en',
      '--sub-format', 'vtt', '-o', join(work, 'sub.%(ext)s'), url,
    ], { timeoutMs })
    let file = ''
    try {
      const names = readdirSync(work).filter((n) => n.endsWith('.vtt'))
      if (names.length) file = join(work, names[0])
    } catch {
      return ''
    }
    if (!file) return ''
    const raw = readFileSync(file, 'utf8')
    const lines = raw.split(/\r?\n/)
      .filter((l) => l && !/^WEBVTT/.test(l) && !/^\d+$/.test(l) && !/-->/.test(l) && !/^NOTE/.test(l))
      .map((l) => l.replace(/<[^>]+>/g, '').trim())
    const seen = new Set()
    const keep = []
    for (const l of lines) {
      if (!l || seen.has(l)) continue
      seen.add(l)
      keep.push(l)
    }
    return keep.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxChars)
  } catch {
    return ''
  } finally {
    try {
      rmSync(work, { recursive: true, force: true })
    } catch { /* ignore */ }
  }
}
