/**
 * SnowLuma HTTP 推送接收端（POST /qq-bot/push）。
 *
 * 抽出来的意义：这是唯一一个"对外监听端口"的组件，安全边界（只允许 127.0.0.1、
 * 可选 Bearer secret、2MB 体积上限）集中在一处，便于审查和测试。
 *
 * 依赖注入：config / log / stats / onEvent / ingestHistory。
 */
import { createServer } from 'node:http'

export function createPushServer({ config, log, stats, onEvent, ingestHistory }) {
  let server = null

  function stop() {
    if (!server) return
    try {
      server.close()
    } catch {
      /* ignore */
    }
    server = null
  }

  function start() {
    stop()
    if (!config.pushEnabled) return null
    const port = Math.max(1024, Math.min(65535, Number(config.pushPort) || 3101))
    const secret = String(config.pushSecret || '')
    const s = createServer((req, res) => {
      stats.pushHits = (stats.pushHits || 0) + 1
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      const ra = String(req.socket.remoteAddress || '')
      // 只接受本机（IPv4/IPv6 回环）；SnowLuma 和插件永远在同一台机器
      if (!/^(::1$|::ffff:127\.|127\.)/.test(ra)) {
        res.writeHead(403)
        res.end()
        return
      }
      if (secret && String(req.headers.authorization || '') !== `Bearer ${secret}`) {
        res.writeHead(401)
        res.end()
        return
      }
      let body = ''
      let tooBig = false
      req.on('data', (c) => {
        body += c
        if (body.length > 2_000_000) {
          tooBig = true
          try {
            req.destroy()
          } catch {
            /* ignore */
          }
        }
      })
      req.on('end', () => {
        res.writeHead(204)
        res.end()
        if (tooBig) return
        try {
          const parsed = JSON.parse(body)
          const list = Array.isArray(parsed) ? parsed : [parsed]
          let n = 0
          for (const raw of list) {
            if (!raw || raw.post_type !== 'message') continue
            const peerId = raw.message_type === 'private' ? String(raw.user_id || '') : ''
            for (const ev of ingestHistory([raw], peerId)) {
              if (!ev.roomId) continue
              void onEvent(ev).catch((e) => log('推送处理失败：' + String(e?.message || e)))
              n += 1
            }
          }
          if (n) stats.pushed = (stats.pushed || 0) + n
        } catch (e) {
          log('推送解析失败：' + String(e?.message || e))
        }
      })
    })
    s.on('error', (e) => log(`推送端口 ${port} 监听失败：${String(e?.message || e)}`))
    s.listen(port, '127.0.0.1', () => log(`HTTP 推送已监听 127.0.0.1:${port}（SnowLuma httpClients → /qq-bot/push）`))
    server = s
    return s
  }

  return {
    start,
    stop,
    get server() {
      return server
    },
    get listening() {
      return !!server?.listening
    },
  }
}
