import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

// 用行区间摘取：从 startName 到下一个顶层函数/注释前
function grabRange(startName, nextName) {
  const s = L.findIndex((l) => l.includes('function ' + startName + '('))
  if (s < 0) throw new Error('找不到 ' + startName)
  const n = L.findIndex((l, i) => i > s && l.includes('function ' + nextName + '('))
  if (n < 0) throw new Error('找不到 ' + nextName)
  let e = n - 1
  while (e > s && L[e].trim() === '') e--
  const lines = L.slice(s, e + 1)
  L.splice(s, e - s + 1)
  return lines
}

const softReload = grabRange('softReload', 'backupNow')
const backupNow = grabRange('backupNow', 'pruneBackups')
const pruneBackups = grabRange('pruneBackups', 'restartDsh')
const restartDsh = grabRange('restartDsh', 'backupTick')
const backupTick = grabRange('backupTick', 'backupList')
const backupList = grabRange('backupList', 'ffmpegBin')

const deps = ['BACKUP_DIR', 'BACKUP_STATE_FILE', 'CONFIG_FILE', 'CONFIG_KEYS', 'DATA_DIR', 'POLLS_FILE', 'REMINDERS_FILE', 'ROOMS_FILE', 'bumpCfg', 'config', 'facts', 'log', 'polls', 'readJson', 'reminders', 'roomTextCache', 'setRoomOverrides', 'sleep', 'writeJson']
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
writeFileSync('lib/backup.mjs', header + [softReload, backupNow, pruneBackups, restartDsh, backupTick, backupList].map((x) => x.join('\n')).join('\n\n') + footer, 'utf8')

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
  ...chunk(deps.filter((d) => d !== 'setRoomOverrides'), 5).map((g) => '    ' + g.join(', ') + ','),
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
