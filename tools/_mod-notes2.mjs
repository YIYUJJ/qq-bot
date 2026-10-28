import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

function grabFn(name) {
  const start = L.findIndex((l) => new RegExp('^(  )(async )?function ' + name + '\\(').test(l))
  if (start < 0) throw new Error('找不到 ' + name)
  const bc = L[start].lastIndexOf('{')
  let depth = 0
  let inStr = null
  let inLine = false
  for (let i = start; i < L.length; i++) {
    const from = i === start ? bc : 0
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
          const lines = L.slice(start, i + 1)
          L.splice(start, i - start + 1)
          return lines
        }
      }
    }
    inLine = false
  }
  throw new Error(name + ' 没闭合')
}

// 1) 先摘函数（每次摘完重新搜索，避免索引错位）
const rememberVideo = grabFn('rememberVideo')
const buildVideoLinkNote = grabFn('buildVideoLinkNote')
const buildWebLinkNote = grabFn('buildWebLinkNote')
const buildSearchNote = grabFn('buildSearchNote')
const extractSearchQuery = grabFn('extractSearchQuery')
const sensitiveQuery = grabFn('sensitiveQuery')
const webSearch = grabFn('webSearch')
const fetchExcerpt = grabFn('fetchExcerpt')
const stripHtml = grabFn('stripHtml')

// 2) 删除缓存定义与搜索常量块
for (const marker of ['const webCache = new Map()', 'const linkCache = new Map()']) {
  const i = L.findIndex((l) => l.includes(marker))
  if (i >= 0) L.splice(i, 1)
}
// 搜索常量块（SEARCH_TRIGGER 到 buildSearchNote 之间已空，保留常量）
const constStart = L.findIndex((l) => l.includes('const SEARCH_TRIGGER'))
let constEnd = constStart
if (constStart >= 0) {
  // 常量块到下一个空行或函数
  while (constEnd < L.length && !/^\s*$/.test(L[constEnd]) && !/^  (async )?function /.test(L[constEnd])) constEnd++
  var searchConsts = L.slice(constStart, constEnd)
  L.splice(constStart, constEnd - constStart)
}

const deps = ['config', 'log', 'stats', 'cfgFor']
const header = `/**
 * 链接/搜索/视频链接的"笔记"生成 + 搜索工具函数。
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
const body = [
  ...(searchConsts || []),
  '',
  ...rememberVideo,
  '',
  ...buildWebLinkNote,
  '',
  ...buildVideoLinkNote,
  '',
  ...stripHtml,
  '',
  ...fetchExcerpt,
  '',
  ...webSearch,
  '',
  ...extractSearchQuery,
  '',
  ...sensitiveQuery,
  '',
  ...buildSearchNote,
]
const footer = `
  return { buildWebLinkNote, buildVideoLinkNote, buildSearchNote, extractSearchQuery, sensitiveQuery, webSearch, rememberVideo }
}
`
writeFileSync('lib/notes.mjs', header + body.join('\n') + footer, 'utf8')

// 3) 在原来 buildWebLinkNote 附近插入工厂（用面板 API 依赖前的位置：找 roomSnapshot 之前？）
const anchor = L.findIndex((l) => l.includes('// 推送接收端交给 lib/push-server.mjs'))
if (anchor < 0) throw new Error('找不到插入锚点')
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
L.splice(anchor, 0,
  '  // 链接/搜索笔记交给 lib/notes.mjs',
  '  const notes = createNotes({ config, log, stats, cfgFor })',
  '  const { buildWebLinkNote, buildVideoLinkNote, buildSearchNote, extractSearchQuery, sensitiveQuery, webSearch, rememberVideo } = notes',
  '',
)

let out = L.join('\n')
if (!out.includes("from './notes.mjs'")) {
  const a = out.indexOf("import { createModel } from './model.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createNotes } from './notes.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('notes 抽取完成')
