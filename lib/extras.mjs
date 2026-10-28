/**
 * 额外能力的小工具：小游戏、提醒解析、网页摘要、文档取文本。
 * 只依赖本机（fetch / python）。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

/* ────────────────────────── 小游戏 ────────────────────────── */

const RIDDLES = [
  ['什么东西越洗越脏？', '水'],
  ['什么东西有头无脚，有眼无眉？', '针'],
  ['什么布剪不断？', '瀑布'],
  ['什么东西天上有，人间也有？', '太阳'],
  ['什么东西人人都有，却借不出去？', '影子'],
  ['什么车寸步难行？', '风车'],
  ['什么东西越分享越多？', '快乐'],
  ['什么东西有嘴不会说，有脚不会走？', '茶壶'],
  ['什么东西倒着走反而更快？', '倒退的车'],
  ['什么蛋不能吃？', '脸蛋'],
]

const LOTS = ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶']

export function rollDice(text) {
  // 2d6 / 3个骰子 / 掷骰子
  const m = /(\d{1,2})\s*[dD]\s*(\d{1,3})/.exec(text) || /(\d{1,2})\s*个\s*骰子/.exec(text)
  let n = 1
  let faces = 6
  if (m) {
    n = Math.max(1, Math.min(10, Number(m[1]) || 1))
    faces = Math.max(2, Math.min(100, Number(m[2]) || 6))
  }
  const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * faces))
  const sum = rolls.reduce((a, b) => a + b, 0)
  return n === 1 ? String(sum) : `${rolls.join(' + ')} = ${sum}`
}

export function rps(userPick) {
  const opts = ['石头', '剪刀', '布']
  const me = opts[Math.floor(Math.random() * 3)]
  const you = opts.includes(userPick) ? userPick : opts[Math.floor(Math.random() * 3)]
  const win = { 石头: '剪刀', 剪刀: '布', 布: '石头' }
  const res = you === me ? '平' : win[me] === you ? '我赢' : '你赢'
  return { me, you, res }
}

export function drawLot() {
  return LOTS[Math.floor(Math.random() * LOTS.length)]
}

export function pickRiddle() {
  const [q, a] = RIDDLES[Math.floor(Math.random() * RIDDLES.length)]
  return { q, a }
}

/* ────────────────────────── 提醒解析 ────────────────────────── */

/**
 * 从一句话里解析提醒时间。
 * 支持：「22:30 提醒我…」「10 分钟后提醒我…」「半小时后…」「明天 8 点提醒我…」
 * 返回 { at, text } 或 null。
 */
export function parseReminder(text, now = new Date()) {
  const t = String(text || '').trim()
  if (!t) return null
  // 必须有"提醒我 / 叫我 / 提醒一下"这类意图
  const intent = /(提醒我|叫我|提醒一下|记得提醒|提醒下)/.test(t)
  if (!intent) return null

  // 相对时间：N 分钟 / N 小时 / 半小时
  let m = /(\d{1,3})\s*(分钟|分|min|minutes?)\s*(?:之后|以后|后)/i.exec(t)
  if (m) {
    const mins = Math.max(1, Math.min(24 * 60, Number(m[1]) || 1))
    return { at: now.getTime() + mins * 60000, text: stripReminderWords(t, m[0]) }
  }
  if (/半\s*(?:个)?\s*小时\s*(?:之后|以后|后)/.test(t)) {
    return { at: now.getTime() + 30 * 60000, text: stripReminderWords(t, '半小时后') }
  }
  m = /(\d{1,2})\s*(小时|钟头|h|hours?)\s*(?:之后|以后|后)/i.exec(t)
  if (m) {
    const hours = Math.max(1, Math.min(24, Number(m[1]) || 1))
    return { at: now.getTime() + hours * 3600000, text: stripReminderWords(t, m[0]) }
  }

  // 绝对时间：HH:MM 或 「N 点」
  const dayOffset = /明天/.test(t) ? 1 : 0
  m = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(t)
  if (m) {
    const hh = Number(m[1])
    const mm = Number(m[2])
    if (hh < 24 && mm < 60) {
      const d = new Date(now)
      d.setHours(hh, mm, 0, 0)
      if (dayOffset) d.setDate(d.getDate() + 1)
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
      return { at: d.getTime(), text: stripReminderWords(t, m[0]) }
    }
  }
  m = /(\d{1,2})\s*点\s*(半)?/.exec(t)
  if (m) {
    const hh = Number(m[1])
    if (hh < 24) {
      const d = new Date(now)
      d.setHours(hh, m[2] ? 30 : 0, 0, 0)
      if (dayOffset) d.setDate(d.getDate() + 1)
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
      return { at: d.getTime(), text: stripReminderWords(t, m[0]) }
    }
  }
  return null
}

function stripReminderWords(t, matched) {
  let s = String(t || '')
  if (matched) s = s.replace(matched, ' ')
  s = s.replace(/(提醒我|叫我|提醒一下|记得提醒|提醒下)/g, ' ')
  s = s.replace(/(明天|今天|之后|以后)/g, ' ')
  s = s.replace(/^[\s,，。.!！?？]+|[\s,，。.!！?？]+$/g, '')
  return s.slice(0, 80)
}

/* ────────────────────────── 网页摘要 ────────────────────────── */

const VIDEO_HOST_RE = /(bilibili\.com|b23\.tv|douyin\.com|iesdouyin\.com|youtube\.com|youtu\.be|kuaishou\.com|xiaohongshu\.com|xhslink\.com)/i
const URL_RE = /https?:\/\/[^\s，。！？、；）)】"'<>]+/g

/** 挑一个"普通网页"链接（排除视频平台、图片、文件直链） */
export function pickWebLink(text, max = 1) {
  const out = []
  for (const m of String(text || '').matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:!?]+$/, '')
    if (VIDEO_HOST_RE.test(u)) continue
    if (/\.(mp4|mp3|m4a|jpg|jpeg|png|gif|webp|zip|rar|7z|exe|apk)(\?|$)/i.test(u)) continue
    if (!out.includes(u)) out.push(u)
    if (out.length >= max) break
  }
  return out
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
}

/** 抓网页 → { title, description, text } */
export async function fetchPageSummary(url, { timeoutMs = 8000, maxBytes = 2 * 1024 * 1024, maxChars = 1200 } = {}) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; qq-bot/1.0)', accept: 'text/html,application/xhtml+xml' },
  })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  const ct = String(res.headers.get('content-type') || '')
  if (ct && !/text\/html|application\/xhtml|text\/plain/i.test(ct)) throw new Error('不是网页（' + ct.slice(0, 40) + '）')
  const buf = Buffer.from(await res.arrayBuffer())
  const html = buf.slice(0, maxBytes).toString('utf8')
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').trim()
  const desc = decodeEntities(
    (/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i.exec(html) ||
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["']/i.exec(html) ||
      [])[1] || '',
  ).trim()
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
  body = decodeEntities(body).replace(/\s+/g, ' ').trim()
  return { title, description: desc.slice(0, 300), text: body.slice(0, maxChars) }
}

/* ────────────────────────── 图片压缩 ────────────────────────── */

/**
 * 把过大的图片压到"视觉模型能吃"的尺寸。
 * QQ 群里常见 4~10MB 的照片，视觉接口按像素算钱，直接发又贵又慢。
 * 返回压缩后的 Buffer（jpg），失败返回 null。
 */
export async function shrinkImage(buf, { mediaType = 'image/jpeg', maxWidth = 1280, ffmpeg = 'ffmpeg', quality = 4 } = {}) {
  const ext = /png/.test(mediaType) ? 'png' : /webp/.test(mediaType) ? 'webp' : /gif/.test(mediaType) ? 'gif' : 'jpg'
  let dir = ''
  try {
    dir = mkdtempSync(join(tmpdir(), 'qvb-img-'))
    const inp = join(dir, 'in.' + ext)
    const outp = join(dir, 'out.jpg')
    writeFileSync(inp, buf)
    const ok = await new Promise((resolve) => {
      let done = false
      let child
      try {
        child = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-i', inp, '-vf', "scale='min(" + maxWidth + ",iw)':-2", '-q:v', String(quality), outp], { windowsHide: true })
      } catch {
        return resolve(false)
      }
      child.on('error', () => {
        if (!done) {
          done = true
          resolve(false)
        }
      })
      child.on('close', (code) => {
        if (!done) {
          done = true
          resolve(code === 0)
        }
      })
    })
    if (!ok) return null
    return readFileSync(outp)
  } catch {
    return null
  } finally {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}

/* ────────────────────────── 文档取文本 ────────────────────────── */

function runPython(py, code, args = [], { timeoutMs = 20000, libDir = '' } = {}) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let done = false
    let child
    try {
      const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
      if (libDir) env.PYTHONPATH = libDir + (env.PYTHONPATH ? ';' + env.PYTHONPATH : '')
      child = spawn(py, ['-c', code, ...args], { windowsHide: true, env })
    } catch (e) {
      return resolve({ ok: false, error: String(e?.message || e) })
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      resolve({ ok: false, error: '超时' })
    }, timeoutMs)
    if (timer.unref) timer.unref()
    child.stdout.on('data', (b) => { out += String(b) })
    child.stderr.on('data', (b) => { err += String(b) })
    child.on('error', (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok: false, error: String(e?.message || e) })
    })
    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(code === 0 ? { ok: true, text: out } : { ok: false, error: err.slice(0, 300) })
    })
  })
}

/** 找一个带 docx/openpyxl 的 python：优先 DSH 自带，其次 PATH */
export function resolveDocPython() {
  const cands = []
  // 先看环境变量，别再写死安装盘
  for (const envKey of ['DSH_PYTHON', 'DSH_PYTHON_EXE', 'PYTHON']) {
    const v = process.env[envKey]
    if (v && existsSync(v)) cands.push(v)
  }
  if (process.env.DSH_HOME) {
    cands.push(join(process.env.DSH_HOME, 'runtime', 'primary-runtime', 'dependencies', 'python', 'python.exe'))
  }
  // DSH 桌面版自带运行时常见位置（兜底）
  cands.push('D:\\deep\\resources\\runtime\\primary-runtime\\dependencies\\python\\python.exe')
  const home = process.env.USERPROFILE || ''
  if (home) cands.push(`${home}\\AppData\\Local\\Programs\\Python\\Python312\\python.exe`)
  for (const p of cands) if (p && existsSync(p)) return p
  return 'python'
}

const PY_DOCX = `
import sys, zipfile, re
from docx import Document
d = Document(sys.argv[1])
parts = [p.text.strip() for p in d.paragraphs if p.text and p.text.strip()]
for t in d.tables:
    for row in t.rows:
        cells = [c.text.strip() for c in row.cells]
        if any(cells): parts.append(' | '.join(cells))
print('\\n'.join(parts))
`

const PY_XLSX = `
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
ws = wb[wb.sheetnames[0]]
rows = []
for i, row in enumerate(ws.iter_rows(values_only=True)):
    if i >= 40: break
    cells = ['' if v is None else str(v) for v in row]
    if any(cells): rows.append(' | '.join(cells))
print('\\n'.join(rows))
`

async function pipInstall(py, pkg, target, timeoutMs = 180000) {
  return new Promise((resolve) => {
    let done = false
    let child
    try {
      child = spawn(py, ['-m', 'pip', 'install', '--quiet', '--disable-pip-version-check', '--target', target, pkg], {
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })
    } catch {
      return resolve(false)
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      resolve(false)
    }, timeoutMs)
    if (timer.unref) timer.unref()
    child.on('error', () => { if (!done) { done = true; clearTimeout(timer); resolve(false) } })
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve(code === 0) } })
  })
}

const PY_PDF = `
import sys
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
out = []
for i, p in enumerate(r.pages):
    if i >= 20: break
    try: out.append(p.extract_text() or '')
    except Exception: pass
print('\\n'.join(out))
`

/**
 * 从文件里取文本。ext 决定用哪条路。
 * 返回 { ok, text } 或 { ok:false, error }。
 */
export async function extractDocText(file, ext, { py = null, maxChars = 3000, libDir = '' } = {}) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '')
  if (['txt', 'md', 'markdown', 'csv', 'json', 'log', 'xml', 'yml', 'yaml'].includes(e)) {
    const { readFileSync } = await import('node:fs')
    const raw = readFileSync(file)
    const text = raw.slice(0, 512 * 1024).toString('utf8')
    return { ok: true, text: text.slice(0, maxChars) }
  }
  const python = py || resolveDocPython()
  if (['docx'].includes(e)) {
    const r = await runPython(python, PY_DOCX, [file], { libDir })
    return r.ok ? { ok: true, text: String(r.text || '').slice(0, maxChars) } : r
  }
  if (['xlsx', 'xlsm'].includes(e)) {
    const r = await runPython(python, PY_XLSX, [file], { libDir })
    return r.ok ? { ok: true, text: String(r.text || '').slice(0, maxChars) } : r
  }
  if (['pdf'].includes(e)) {
    let r = await runPython(python, PY_PDF, [file], { libDir })
    if (r.ok && String(r.text || '').trim()) return { ok: true, text: String(r.text).slice(0, maxChars) }
    // 没装 pypdf 就懒装到 libDir 再试一次
    if (/No module named 'pypdf'|No module named pypdf/.test(String(r.error || '')) && libDir) {
      const ok = await pipInstall(python, 'pypdf', libDir)
      if (ok) r = await runPython(python, PY_PDF, [file], { libDir })
      if (r.ok && String(r.text || '').trim()) return { ok: true, text: String(r.text).slice(0, maxChars) }
    }
    return { ok: false, error: 'PDF 取不出文字：' + (r.error || '可能是扫描件') }
  }
  return { ok: false, error: '不支持的文件类型：' + (e || '未知') }
}
