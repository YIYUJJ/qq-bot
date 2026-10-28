import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

function braceEnd(startLine, openIdx) {
  let depth = 0
  let inStr = null
  let inLine = false
  for (let i = startLine; i < L.length; i++) {
    const from = i === startLine ? openIdx : 0
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
        if (depth === 0) return i
      }
    }
    inLine = false
  }
  throw new Error('没闭合')
}

const ranges = []
for (const name of ['softReload', 'backupNow', 'pruneBackups', 'backupTick', 'backupList']) {
  const s = L.findIndex((l) => l.includes('function ' + name + '('))
  if (s < 0) throw new Error('找不到 ' + name)
  ranges.push([s, braceEnd(s, L[s].lastIndexOf('{'))])
}
// restartDsh 用行区间：到 backupTick 之前
const rs = L.findIndex((l) => l.includes('function restartDsh()'))
const rt = L.findIndex((l) => l.includes('function backupTick('))
let re = rt - 1
while (re > rs && L[re].trim() === '') re--
ranges.push([rs, re])

ranges.sort((a, b) => b[0] - a[0])
const parts = {}
for (const [s, e] of ranges) {
  const name = L[s].match(/function ([A-Za-z0-9_]+)\(/)[1]
  parts[name] = L.slice(s, e + 1)
  L.splice(s, e - s + 1)
}

const deps = ['BACKUP_DIR', 'BACKUP_STATE_FILE', 'CONFIG_FILE', 'CONFIG_KEYS', 'DATA_DIR', 'POLLS_FILE', 'REMINDERS_FILE', 'ROOMS_FILE', 'bumpCfg', 'config', 'facts', 'log', 'polls', 'readJson', 'reminders', 'roomTextCache', 'setRoomOverrides', 'getSleep', 'writeJson']
const header = `/**
 * 备份/重启辅助：立即备份、保留 N 份、定时备份、软重载、重启 DSH。
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BACKUP_DEPS = ${JSON.stringify(deps)}

export function createBackup(deps) {
  const missing = BACKUP_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('备份模块缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps

`
const footer = `
  return { softReload, backupNow, pruneBackups, restartDsh, backupTick, backupList }
}
`
const order = ['softReload', 'backupNow', 'pruneBackups', 'restartDsh', 'backupTick', 'backupList']
let mod = header + order.map((n) => parts[n].join('\n')).join('\n\n') + footer
// 去掉重复声明（这些在 index 里已有）
mod = mod
  .split('\n')
  .filter((l) => !/^  const (BACKUP_STATE_FILE|REMINDERS_FILE|POLLS_FILE|ROOMS_FILE|BACKUP_DIR|reminders|polls) = /.test(l))
  .join('\n')
writeFileSync('lib/backup.mjs', mod, 'utf8')

const anchor = L.findIndex((l) => l.includes('// 更多玩法：延迟初始化'))
if (anchor < 0) throw new Error('找不到 features 锚点')
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
L.splice(anchor, 0,
  '  // 备份/重启交给 lib/backup.mjs',
  '  const backupMod = createBackup({',
  ...chunk(deps.filter((d) => d !== 'setRoomOverrides' && d !== 'getSleep'), 5).map((g) => '    ' + g.join(', ') + ','),
  '    setRoomOverrides: (o) => { roomOverrides = o },',
  '    getSleep: () => sleep,',
  '  })',
  '  const { softReload, backupNow, pruneBackups, restartDsh, backupTick, backupList } = backupMod',
  '',
)

let out = L.join('\n')
if (!out.includes("from './backup.mjs'")) {
  const a = out.indexOf("import { createStartup } from './startup.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createBackup } from './backup.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('backup 抽取完成（精确边界）')
