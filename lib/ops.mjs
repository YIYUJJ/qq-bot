import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJson } from './store.mjs'
import { normalizeEvent } from './onebot.mjs'
import { spawn } from 'node:child_process'

/**
 * 运维/诊断工具：备份恢复、历史检索、日志尾巴、原子写 JSON、连接信息。
 */

export const OPS_DEPS = ["BACKUP_DIR","DATA_DIR","config","getKeywords","log","getOb","getSoftReload","version"]

export function createOps(deps) {
  const missing = OPS_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('运维模块缺少依赖：' + missing.join(', '))
  const { BACKUP_DIR, DATA_DIR, config, getKeywords, log, getOb, getSoftReload, version } = deps

  function backupRestore(name) {
    const dir = join(BACKUP_DIR, name)
    if (!name || !existsSync(dir)) throw new Error('没有这个备份：' + (name || '(空)'))
    let n = 0
    for (const item of readdirSync(dir)) {
      try {
        cpSync(join(dir, item), join(DATA_DIR, item), { recursive: true, force: true })
        n += 1
      } catch { /* ignore */ }
    }
    log('已从备份恢复 ' + n + ' 项：' + name)
    try {
      getSoftReload()()
    } catch (e) {
      log('恢复后软重载失败：' + String(e?.message || e))
    }
    return { restored: n, name }
  }

  async function searchHistory(roomId, text, limit) {
    const kws = getKeywords()(text)
    if (!kws.length) return []
    try {
      const data = await getOb().call('get_group_msg_history', { group_id: roomId, count: 80 }, 8000)
      const hits = []
      for (const m of data?.messages || []) {
        const ev = normalizeEvent(m, getOb().status.self?.user_id)
        if (!ev.text) continue
        if (!kws.some((k) => ev.text.includes(k))) continue
        hits.push(`${new Date(ev.ts).toLocaleString('zh-CN', { hour12: false })} ${ev.senderName}: ${ev.text}`)
      }
      return hits.slice(-Math.max(1, limit))
    } catch {
      return []
    }
  }

  function tailLines(file, n) {
    try {
      if (!existsSync(file)) return ''
      const st = statSync(file)
      const maxBytes = Math.min(st.size, 512 * 1024)
      const start = Math.max(0, st.size - maxBytes)
      const buf = Buffer.alloc(maxBytes)
      const fd = openSync(file, 'r')
      try {
        readSync(fd, buf, 0, maxBytes, start)
      } finally {
        closeSync(fd)
      }
      const lines = buf.toString('utf8').split(/\r?\n/)
      if (start > 0) lines.shift()
      return lines.slice(-n).join('\n')
    } catch {
      return ''
    }
  }

  function writeJson(file, v) {
    // 原子写：先 tmp 再 rename，崩溃不会留下半个 JSON
    const ok = atomicWriteJson(file, v)
    if (!ok) log('写文件失败 ' + file)
  }

  function connectInfo() {
    const s = getOb().status
    return [
      `插件：${config.enabled ? '启用' : '停用'}${config.dryRun ? '（演练）' : ''}｜v${version}`,
      `WS：${s.connected ? '已连接' : '未连接'} ${s.wsUrl || '-'}（重连 ${s.reconnects} 次）`,
      `HTTP：${s.httpUrl || '-'}`,
      `账号：${s.self ? `${s.self.nickname || ''}（${s.self.user_id}）` : '未取到'}`,
      s.lastError ? `最近错误：${s.lastError}` : '',
    ].filter(Boolean).join('\n')
  }
  return { backupRestore, searchHistory, tailLines, writeJson, connectInfo }
}

/**
 * 备份/重启辅助：立即备份、保留 N 份、定时备份、软重载、重启 DSH。
 */

export const BACKUP_DEPS = ["BACKUP_DIR","BACKUP_STATE_FILE","CONFIG_FILE","CONFIG_KEYS","DATA_DIR","POLLS_FILE","REMINDERS_FILE","ROOMS_FILE","bumpCfg","config","facts","log","polls","readJson","reminders","roomTextCache","setRoomOverrides","getSleep","writeJson"]

export function createBackup(deps) {
  const missing = BACKUP_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('备份模块缺少依赖：' + missing.join(', '))
  const { BACKUP_DIR, BACKUP_STATE_FILE, CONFIG_FILE, CONFIG_KEYS, DATA_DIR, POLLS_FILE, REMINDERS_FILE, ROOMS_FILE, bumpCfg, config, facts, log, polls, readJson, reminders, roomTextCache, setRoomOverrides, getSleep, writeJson } = deps

  function softReload() {
    try {
      const fresh = readJson(CONFIG_FILE, {})
      for (const k of CONFIG_KEYS) if (k in fresh) config[k] = fresh[k]
    } catch (e) {
      log('软重载配置失败：' + String(e?.message || e))
    }
    try {
      const ov = readJson(ROOMS_FILE, {})
      setRoomOverrides(ov && typeof ov === 'object' && !Array.isArray(ov) ? ov : {})
    } catch { /* ignore */ }
    bumpCfg()
    for (const k of Object.keys(facts)) delete facts[k]
    try { roomTextCache.clear() } catch { /* ignore */ }
    try {
      const rm = readJson(REMINDERS_FILE, [])
      reminders.length = 0
      if (Array.isArray(rm)) reminders.push(...rm)
    } catch { /* ignore */ }
    try {
      const pl = readJson(POLLS_FILE, {})
      for (const k of Object.keys(polls)) delete polls[k]
      if (pl && typeof pl === 'object') Object.assign(polls, pl)
    } catch { /* ignore */ }
    log('已软重载：配置 / 每群覆盖 / 记忆缓存 / 提醒 / 投票')
    return true
  }

  function backupNow() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dest = join(BACKUP_DIR, stamp)
    mkdirSync(dest, { recursive: true })
    const skip = new Set(['backups', 'video-tmp', 'pylib', 'stickers'])
    let n = 0
    for (const name of readdirSync(DATA_DIR)) {
      if (skip.has(name)) continue
      try {
        cpSync(join(DATA_DIR, name), join(dest, name), { recursive: true })
        n += 1
      } catch { /* 单个失败跳过 */ }
    }
    log('已备份数据到 backups/' + stamp + '（' + n + ' 项）')
    return { name: stamp, items: n }
  }

  function pruneBackups() {
    const keep = Math.max(1, Math.min(30, Number(config.backupKeep) || 7))
    const names = backupList()
    for (const n of names.slice(keep)) {
      try { rmSync(join(BACKUP_DIR, n), { recursive: true, force: true }) } catch { /* ignore */ }
    }
    return names.slice(0, keep)
  }

  function restartDsh() {
    const exe = process.execPath // DeepSeek Harness.exe
    const script = join(DATA_DIR, 'restart-dsh.ps1')
    const logFile = join(DATA_DIR, 'restart-dsh.log')
    const exePath = String(exe).replace(/'/g, "''")
    const body = [
      '$log = ' + JSON.stringify(String(logFile).replace(/\\/g, '/')),
      '"[$(Get-Date -Format o)] restart begin" | Out-File -Append -Encoding utf8 $log',
      'Start-Sleep -Seconds 2',
      'taskkill /F /T /IM "DeepSeek Harness.exe" 2>&1 | Out-File -Append -Encoding utf8 $log',
      'Start-Sleep -Seconds 3',
      '$left = Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue',
      'if ($left) { "[$(Get-Date -Format o)] extra " + $left.Count | Out-File -Append -Encoding utf8 $log ; $left | Stop-Process -Force -ErrorAction SilentlyContinue ; Start-Sleep -Seconds 2 }',
      'Start-Process -FilePath "' + exePath + '"',
      '"[$(Get-Date -Format o)] started" | Out-File -Append -Encoding utf8 $log',
      '',
    ].join('\r\n')
    writeFileSync(script, body, 'utf8')
    const psExe = join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    // 必须经 cmd 的 start /b 启动：直接 spawn powershell + detached 在本机实测不会执行（子进程被静默丢弃）
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', '""', '/b', psExe, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { detached: true, stdio: 'ignore', windowsHide: true },
    )
    child.unref()
    child.on('error', (e) => log('重启器启动失败：' + String(e?.message || e)))
    child.on('spawn', () => log('重启器已启动（PID ' + child.pid + '，5 秒后执行）'))
    log('已请求重启 DSH（约 5 秒后回来），重启器：' + script)
    return { ok: true, script, exe, etaMs: 5000 }
  }

  let backupBusy = false
  /** 每天到点自动备份一次（跨重载记在文件里，避免重复备份） */

  function backupTick() {
    if (!config.backupDaily || backupBusy) return
    const now = new Date()
    const hour = Math.max(0, Math.min(23, Number(config.backupHour) || 4))
    if (now.getHours() < hour) return
    const day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
    const state = readJson(BACKUP_STATE_FILE, {})
    if (state.lastDay === day) return
    backupBusy = true
    try {
      const r = backupNow()
      pruneBackups()
      try { writeJson(BACKUP_STATE_FILE, { lastDay: day, at: Date.now(), name: r.name }) } catch { /* ignore */ }
      log('每日自动备份完成：' + r.name + '（保留 ' + (Number(config.backupKeep) || 7) + ' 份）')
    } catch (e) {
      log('每日自动备份失败：' + String(e?.message || e))
    } finally {
      backupBusy = false
    }
  }

  function backupList() {
    let names = []
    try {
      if (existsSync(BACKUP_DIR)) {
        names = readdirSync(BACKUP_DIR).filter((n) => statSync(join(BACKUP_DIR, n)).isDirectory())
      }
    } catch { /* ignore */ }
    return names.sort().reverse()
  }
  return { softReload, backupNow, pruneBackups, restartDsh, backupTick, backupList }
}
