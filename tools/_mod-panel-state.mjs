import { readFileSync, writeFileSync } from 'node:fs'

function fnRange(L, name) {
  const start = L.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l))
  if (start < 0) throw new Error('找不到 ' + name)
  let depth = 0
  let end = -1
  let inStr = null
  let inLine = false
  for (let i = start; i < L.length && end < 0; i++) {
    for (let p = 0; p < L[i].length; p++) {
      const c = L[i][p]
      const n = L[i][p + 1]
      if (inLine) break
      if (inStr) {
        if (c === '\\') {
          p++
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
          end = i
          break
        }
      }
    }
    inLine = false
  }
  if (end < 0) throw new Error(name + ' 没闭合')
  return [start, end]
}

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
const L = raw.split(/\r?\n/)

const [s, e] = fnRange(L, 'panelState')
const body = L.slice(s, e + 1)
const deps = 'CONFIG_FILE LOG_FILE MEMORY_DIR STICKERS_FILE config facts features groupNames healthCache log roomSnapshot rooms stats stickers usage usageView'.split(' ')

const header = `/**
 * 面板数据（/api/state 的 body）拼装。
 *
 * 依赖注入：config / rooms / stats / stickers / facts / features / groupNames / usage
 *           roomSnapshot / usageView / healthCache / 路径常量 / log。
 */
export const PANEL_STATE_DEPS = ${JSON.stringify(deps)}

export function createPanelState(deps) {
  const missing = PANEL_STATE_DEPS.filter((k) => deps[k] === undefined && k !== 'healthCache')
  if (missing.length) throw new Error('面板数据缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps
  const healthCache = deps.healthCache ?? null

`
writeFileSync('lib/panel-state.mjs', header + body.join('\n') + '\n\n  return panelState\n}\n', 'utf8')

// index: 用工厂替换
const call = [
  '  // 面板数据交给 lib/panel-state.mjs',
  '  const panelState = createPanelState({',
  '    CONFIG_FILE, LOG_FILE, MEMORY_DIR, STICKERS_FILE, config, facts, features, groupNames, healthCache, log,',
  '    roomSnapshot, rooms, stats, stickers, usage, usageView,',
  '  })',
]
L.splice(s, e - s + 1, ...call)
writeFileSync(p, L.join(crlf ? '\r\n' : '\n'), 'utf8')

let s2 = readFileSync(p, 'utf8')
const anchor = s2.indexOf("import { createApiHandler } from './http-api.mjs'")
const insertAt = s2.indexOf('\n', anchor) + 1
s2 = s2.slice(0, insertAt) + "import { createPanelState } from './panel-state.mjs'\n" + s2.slice(insertAt)
writeFileSync(p, s2, 'utf8')
console.log('panelState 抽取完成：', body.length, '行')
