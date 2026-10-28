/**
 * 启动序列：连接 SnowLuma → 群名缓存 → 记忆迁移 → 基线 → 推送/轮询 → 图库/重发队列。
 */
import { renameSync } from 'node:fs'

export const STARTUP_DEPS = ["ob","config","log","getDisposed","groupNames","isAllowedGroup","migrateLegacy","MEMORY_DIR","FACTS_FILE","pruneUnmanagedMemory","primeAllowed","startPushServer","selfcheck","startPolling","sweepStickerLibrary","flushOutbox","outbox","safeTick","timers","recordFailure"]

export function createStartup(deps) {
  const missing = STARTUP_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('启动序列缺少依赖：' + missing.join(', '))
  const { ob, config, log, getDisposed, groupNames, isAllowedGroup, migrateLegacy, MEMORY_DIR, FACTS_FILE, pruneUnmanagedMemory, primeAllowed, startPushServer, selfcheck, startPolling, sweepStickerLibrary, flushOutbox, outbox, safeTick, timers, recordFailure } = deps

  async function run() {
  try {
    const d = await ob.start({
      homeDir: config.snowlumaHome,
      httpUrl: config.httpUrl,
      wsUrl: config.wsUrl,
      accessToken: config.accessToken,
    })
    if (d.ok) {
      if (getDisposed()) {
        ob.stop()
        return
      }
      log(`已接入 SnowLuma：${d.http.url}｜账号 ${d.self?.nickname}（${d.self?.user_id}）｜WS ${d.ws?.url || '未配置'}`)
      // 群名缓存（只读）
      try {
        const gs = await ob.groups()
        for (const g of gs) {
          const rid = String(g.group_id ?? '')
          if (rid) groupNames.set(rid, String(g.group_name || ''))
        }
        log(`已读到 ${gs.length} 个群（授权群：${gs.filter((g) => isAllowedGroup(g.group_id)).map((g) => g.group_name).join('、') || '无'}）`)
      } catch (e) {
        log('读群列表失败：' + String(e?.message || e))
      }
      // 旧版"一个 facts.json 装所有群" → 每个会话一个文件夹
      try {
        const mig = migrateLegacy(
          MEMORY_DIR,
          FACTS_FILE,
          (id) => groupNames.has(String(id)) || config.allowGroups.includes(String(id)),
        )
        if (mig.migrated) {
          log(`记忆迁移：${mig.rooms} 个会话 / ${mig.migrated} 条 → ${MEMORY_DIR}`)
          try {
            renameSync(FACTS_FILE, FACTS_FILE + '.legacy')
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        log('记忆迁移失败：' + String(e?.message || e))
      }
      pruneUnmanagedMemory()
      await primeAllowed()
      startPushServer()
      // 自检必须在连上之后跑，否则会把"还没连上"误报成异常
      void selfcheck().catch(() => {})
      if (Number(config.pollMs) > 0) {
        startPolling()
      } else {
        log('轮询已关闭（pollMs=0）：只靠 WS 推送')
      }
      // 图库本地化：把还没存到本地的图刷一遍（QQ 链接会过期）
      void sweepStickerLibrary().catch((e) => log('图库本地化失败：' + String(e?.message || e)))
      // 重发队列：连上后先清一次，之后每 15 秒扫一遍
      void flushOutbox()
      const obTimer = setInterval(safeTick('重发队列', () => flushOutbox()), 15000)
      if (obTimer.unref) obTimer.unref()
      timers.add(obTimer)
      if (outbox.count) log(`重发队列里有 ${outbox.count} 条待发`)
    } else {
      log('接入失败：' + (d.error || '未知'))
    }
  } catch (e) {
    log('启动异常：' + String(e?.message || e))
      recordFailure('启动', e)
  }
  }

  return { run }
}
