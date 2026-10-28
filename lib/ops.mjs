/**
 * 运维/诊断工具：备份恢复、历史检索、日志尾巴、原子写 JSON、连接信息。
 */
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { atomicWriteJson } from './store.mjs'
import { normalizeEvent } from './onebot.mjs'

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
