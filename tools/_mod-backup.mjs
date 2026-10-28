import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

function grabFn(name) {
  const start = L.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l))
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

const parts = {}
for (const n of ['softReload', 'backupNow', 'pruneBackups', 'restartDsh', 'backupTick', 'backupList']) parts[n] = grabFn(n)

const deps = ['BACKUP_DIR', 'BACKUP_STATE_FILE', 'CONFIG_FILE', 'CONFIG_KEYS', 'DATA_DIR', 'POLLS_FILE', 'REMINDERS_FILE', 'ROOMS_FILE', 'bumpCfg', 'config', 'facts', 'log', 'polls', 'readJson', 'reminders', 'roomTextCache', 'setRoomOverrides', 'sleep', 'writeJson']
const header = `/**
 * 备份/恢复辅助：立即备份、保留 N 份、定时备份、软重载、重启 DSH。
 *
 * 从 index.js 抽出；roomOverrides 通过 setRoomOverrides 注入（index 里是 let）。
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
writeFileSync('lib/backup.mjs', header + [parts.softReload, parts.backupNow, parts.pruneBackups, parts.restartDsh, parts.backupTick, parts.backupList].map((x) => x.join('\n')).join('\n\n') + footer, 'utf8')

const anchor = L.findIndex((l) => l.includes('// 更多玩法：延迟初始化'))
if (anchor < 0) throw new Error('找不到 features 锚点')
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const callDeps = deps.filter((d) => d !== 'setRoomOverrides')
L.splice(anchor, 0,
  '  // 备份/重启交给 lib/backup.mjs',
  '  const backupMod = createBackup({',
  ...chunk(callDeps, 5).map((g) => '    ' + g.join(', ') + ','),
  '    setRoomOverrides: (o) => { roomOverrides = o },',
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
console.log('backup 抽取完成')
