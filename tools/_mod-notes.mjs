import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const L = readFileSync(p, 'utf8').split(/\r?\n/)

// 1) 删除两个缓存定义
for (const marker of ['const webCache = new Map()', 'const linkCache = new Map()']) {
  const i = L.findIndex((l) => l.includes(marker))
  if (i < 0) throw new Error('找不到 ' + marker)
  L.splice(i, 1)
}

// 2) 定位 block：buildWebLinkNote 起，到 track 之前的空行
const start = L.findIndex((l) => l.includes('async function buildWebLinkNote(text, c)'))
if (start < 0) throw new Error('找不到 buildWebLinkNote')
const trackIdx = L.findIndex((l, i) => i > start && l.includes('const track = (t) =>'))
if (trackIdx < 0) throw new Error('找不到 track')
let end = trackIdx - 1
while (end > start && L[end].trim() === '') end--

const block = L.slice(start, end + 1)

const deps = ['config', 'log', 'stats', 'cfgFor']
const header = `/**
 * 链接/搜索/视频链接的"笔记"生成：
 *   buildWebLinkNote   普通网页 → 标题 + 正文节选
 *   buildVideoLinkNote B 站/YouTube → 标题 + 字幕摘要
 *   buildSearchNote    需要联网时给模型补一段搜索结果
 * 以及搜索相关的 extractSearchQuery / sensitiveQuery / webSearch。
 */
import { pickWebLink, fetchPageSummary } from './extras.mjs'
import { pickVideoLinks, ytdlpInfo, ytdlpSubtitleText } from './video.mjs'

export const NOTES_DEPS = ${JSON.stringify(deps)}

export function createNotes(deps) {
  const missing = NOTES_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('笔记模块缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

  const webCache = new Map() // url -> { at, data }
  const linkCache = new Map() // url -> { info, at }（只在内存，重启清空）

`
const footer = `
  return { buildWebLinkNote, buildVideoLinkNote, buildSearchNote, extractSearchQuery, sensitiveQuery, webSearch, rememberVideo }
}
`
// rememberVideo 不在 block 里（在 1152），单独抓
const rvStart = L.findIndex((l) => l.includes('function rememberVideo(r, v, info)'))
let rvBlock = []
if (rvStart >= 0) {
  let depth = 0
  let inStr = null
  let inLine = false
  let rvEnd = -1
  const bl = rvStart
  const bc = L[bl].lastIndexOf('{')
  for (let i = bl; i < L.length && rvEnd < 0; i++) {
    const from = i === bl ? bc : 0
    for (let k = from; k < L[i].length; k++) {
      const c = L[i][k]
      const n = L[i][k + 1]
      if (inLine) break
      if (inStr) {
        if (c === '\\') {
          k++
          continue
        }
        if (c === inStr) inStr = null
        continue
      }
      if (c === '/' && n === '/') {
        inLine = true
        break
      }
      if (c === "'" || c === '"' || c === '`') {
        inStr = c
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          rvEnd = i
          break
        }
      }
    }
    inLine = false
  }
  if (rvEnd > 0) {
    rvBlock = L.slice(rvStart, rvEnd + 1)
    L.splice(rvStart, rvEnd - rvStart + 1)
  }
}

writeFileSync('lib/notes.mjs', header + rvBlock.map((l) => l.replace(/^  /, '  ')).join('\n') + '\n\n' + block.join('\n') + footer, 'utf8')

const call = [
  '  // 链接/搜索笔记交给 lib/notes.mjs',
  '  const notes = createNotes({ config, log, stats, cfgFor })',
  '  const { buildWebLinkNote, buildVideoLinkNote, buildSearchNote, extractSearchQuery, sensitiveQuery, webSearch, rememberVideo } = notes',
  '',
]
L.splice(start, end - start + 1, ...call)
let out = L.join('\n')
if (!out.includes("from './notes.mjs'")) {
  const a = out.indexOf("import { createModel } from './model.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createNotes } from './notes.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('notes 抽取完成：', block.length + rvBlock.length, '行')
