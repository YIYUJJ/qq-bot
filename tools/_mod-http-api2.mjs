import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
const L = raw.split(/\r?\n/)

const start = L.findIndex((l) => l.includes('async function handleRequest('))
if (start < 0) throw new Error('找不到 handleRequest')

// 括号计数找到函数结束（跳过字符串/模板/注释）
let depth = 0
let end = -1
let inStr = null
let inLine = false
let inBlock = false
for (let i = start; i < L.length && end < 0; i++) {
  const line = L[i]
  for (let p2 = 0; p2 < line.length; p2++) {
    const c = line[p2]
    const n = line[p2 + 1]
    if (inLine) break
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false
        p2++
      }
      continue
    }
    if (inStr) {
      if (c === '\\') {
        p2++
        continue
      }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '/' && n === '/') {
      inLine = true
      break
    }
    if (c === '/' && n === '*') {
      inBlock = true
      p2++
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      inStr = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  inLine = false
}
if (end < 0) throw new Error('函数没有闭合')
const bodyLines = L.slice(start, end + 1)

const deps = 'DATA_DIR LOG_FILE MOODS NAMES_FILE STICKERS_FILE addFact allowedHere applyConfigPatch assertGroupAllowed backupList backupNow buildTranscript cfgFor config delFact exportMemory extractFacts factNorm facts factsOf flushOutbox generate getFeatures groupNames isAllowedGroup isManagedRoom loadFacts log markStickersDirty metrics ob onEvent outbox panelState readJson reloadSelf replied rereadConfigFromDisk resetRoomOverride restartDsh roomOverrideOf roomState rooms savedNames searchMemory selfcheck sendReply sendStickerTo sendWithRetry setRoomOverride sleep stats stickers systemPrompt tailLines updateProfile updateRelations updateSummary usage usageView writeJson'.split(' ')

const header = `/**
 * 面板 HTTP API（从 index.js 整体抽出）。
 *
 * 45 个路由 + 面板页静态输出。依赖通过 createApiHandler({...}) 注入，
 * 缺依赖时启动即报错（API_DEPS 用来校验，避免运行到一半才发现）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const API_DEPS = ${JSON.stringify(deps)}

export function createApiHandler(deps) {
  const missing = API_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) {
    throw new Error('面板 API 缺少依赖：' + missing.join(', '))
  }
  const { ${deps.join(', ')} } = deps
  const getService = deps.getService

  const json = (res, status, body) => {
    const s = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(s),
    })
    res.end(s)
  }

  const readBody = (req, limit = 1024 * 1024) =>
    new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > limit) {
          reject(new Error('请求体太大'))
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        if (!raw) return resolve({})
        try {
          resolve(JSON.parse(raw))
        } catch {
          reject(new Error('JSON 解析失败'))
        }
      })
      req.on('error', reject)
    })

`

const footer = `

  return handleRequest
}
`

writeFileSync('lib/http-api.mjs', header + bodyLines.join('\n') + footer, 'utf8')

// index：把 handler 替换成工厂调用
function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
const call = [
  '    // 面板 HTTP API 交给 lib/http-api.mjs（45 个路由）',
  '    const handleRequest = createApiHandler({',
  ...chunk(deps, 8).map((g) => '      ' + g.join(', ') + ','),
  '      getService,',
  '    })',
]
L.splice(start, end - start + 1, ...call)
writeFileSync(p, L.join(crlf ? '\r\n' : '\n'), 'utf8')

// import
let s2 = readFileSync(p, 'utf8')
const anchor = s2.indexOf("import { panelTools } from './tools-panel.mjs'")
const insertAt = s2.indexOf('\n', anchor) + 1
s2 = s2.slice(0, insertAt) + "import { createApiHandler } from './http-api.mjs'\n" + s2.slice(insertAt)
writeFileSync(p, s2, 'utf8')
console.log('http-api 抽取完成：handler', bodyLines.length, '行，依赖', deps.length)
