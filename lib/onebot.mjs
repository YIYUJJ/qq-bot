/**
 * SnowLuma OneBot v11 接入层。
 *
 * 设计约束（都是踩过的坑）：
 *   1. token **按账号分文件**：<SnowLuma>/config/onebot_<uin>.json，HTTP 与 WS 是两个不同的 token。
 *      换 QQ 账号后旧 token 直接 401 → 这里不猜，拿候选真去问一次 get_login_info。
 *   2. WS 鉴权两种都试过可用：`Authorization: Bearer <token>` 与 `?access_token=`。
 *   3. 收事件走 WS、发动作走 HTTP：动作是请求/响应，HTTP 有状态码和 retcode，比在 WS 上
 *      靠 echo 配对省心（同一个 echo 表在重连时还得清理）。
 *   4. 事件只做归一化，不做业务判断：业务在 index.js，这一层保持可单测。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 从 SnowLuma 的 per-account 配置里读候选端点。 */
export function readAccounts(homeDir) {
  if (!homeDir) return []
  const dir = path.join(homeDir, 'config')
  let files = []
  try {
    files = fs.readdirSync(dir).filter((f) => /^onebot_\d+\.json$/i.test(f))
  } catch {
    return []
  }
  const out = []
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      const nets = j?.networks ?? {}
      const http = Array.isArray(nets.httpServers) ? nets.httpServers[0] : null
      const ws = Array.isArray(nets.wsServers) ? nets.wsServers[0] : null
      out.push({
        uin: /onebot_(\d+)\.json/i.exec(f)?.[1] ?? '',
        http: http
          ? {
              token: String(http.accessToken ?? ''),
              url: `http://${http.host || '127.0.0.1'}:${Number(http.port) || 3000}`,
            }
          : null,
        ws: ws
          ? {
              token: String(ws.accessToken ?? ''),
              url: `ws://${ws.host || '127.0.0.1'}:${Number(ws.port) || 3001}/`,
            }
          : null,
      })
    } catch {
      /* 单个文件坏了不影响其它账号 */
    }
  }
  return out.sort((a, b) => a.uin.localeCompare(b.uin))
}

async function probeHttp(url, token, timeoutMs = 5000) {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/get_login_info`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: '{}',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const body = await res.json().catch(() => ({}))
    if (body.status !== 'ok' || body.retcode !== 0) {
      return { ok: false, error: `retcode ${body.retcode}${body.wording ? ' ' + body.wording : ''}` }
    }
    return { ok: true, self: body.data }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

/**
 * 找一条真能用的端点。
 * @returns {Promise<{ok:boolean, http?:{url,token}, ws?:{url,token}, self?:object, tried:Array, error?:string}>}
 */
export async function discover({ homeDir, httpUrl = '', wsUrl = '', accessToken = '' } = {}) {
  const accounts = readAccounts(homeDir)
  const candidates = []
  const seen = new Set()
  const add = (url, token, source) => {
    const u = String(url || '').replace(/\/+$/, '')
    if (!u) return
    const key = `${u}|${token}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push({ url: u, token, source })
  }

  // 显式配置优先（用户可能故意指向别的实例），然后是 per-account 文件
  if (httpUrl) add(httpUrl, accessToken, 'config')
  for (const a of accounts) if (a.http) add(a.http.url, a.http.token, `onebot_${a.uin}.json`)
  if (!candidates.length) return { ok: false, tried: [], error: '没有候选端点：SnowLuma 目录下找不到 onebot_*.json' }

  const tried = []
  for (const c of candidates) {
    const r = await probeHttp(c.url, c.token)
    tried.push({ source: c.source, url: c.url, ok: r.ok, error: r.error })
    if (!r.ok) continue
    const uin = /onebot_(\d+)\.json/.exec(c.source)?.[1] ?? String(r.self?.user_id ?? '')
    const acct = accounts.find((a) => a.uin === uin)
    return {
      ok: true,
      http: { url: c.url, token: c.token },
      ws: wsUrl
        ? { url: wsUrl, token: acct?.ws?.token ?? '' }
        : acct?.ws ?? null,
      self: r.self,
      tried,
    }
  }
  return { ok: false, tried, error: `所有候选端点都不可用：${tried[tried.length - 1]?.error ?? '未知'}` }
}

/** 把 OneBot 的 message 段数组归一成 { text, isAtMe, atAll, images, replyId }。 */
export function normalizeSegments(message, selfId) {
  const segs = Array.isArray(message)
    ? message
    : [{ type: 'text', data: { text: String(message ?? '') } }]
  const parts = []
  let isAtMe = false
  let atAll = false
  let images = 0
  let replyId = ''
  const imageUrls = []
  const imageKinds = []
  const imageSubTypes = []
  const videoUrls = []
  const files = []
  let forwardId = ''
  for (const s of segs) {
    const t = String(s?.type || '')
    const d = s?.data ?? {}
    if (t === 'text') {
      parts.push(String(d.text ?? ''))
    } else if (t === 'at') {
      const qq = String(d.qq ?? '')
      if (qq === 'all') {
        atAll = true
        parts.push('@所有人')
      } else if (qq && qq === String(selfId ?? '')) {
        isAtMe = true
        parts.push('@我')
      } else {
        parts.push(`@${d.name || qq}`)
      }
    } else if (t === 'image' || t === 'mface') {
      images += 1
      const u = String(d.url || d.file || '')
      if (u && /^https?:/i.test(u)) {
        imageUrls.push(u)
        imageKinds.push(t === 'mface' ? 'mface' : 'image')
        imageSubTypes.push(Number(d.sub_type) || 0)
      }
      parts.push(t === 'mface' ? '[表情]' : '[图片]')
    } else if (t === 'face') {
      parts.push('[表情]')
    } else if (t === 'reply') {
      replyId = String(d.id ?? '')
    } else if (t === 'record' || t === 'video' || t === 'file') {
      const u = String(d.url || d.file || '')
      if (t === 'video' && u && /^(https?:|file:)/i.test(u)) videoUrls.push(u)
      if (t === 'file' && u && /^https?:/i.test(u)) {
        files.push({
          url: u,
          name: String(d.name || d.file_name || d.file || 'file').slice(0, 120),
          size: Number(d.file_size || d.size) || 0,
        })
      }
      parts.push(`[${t}]`)
    } else if (t === 'forward') {
      if (d.id) forwardId = String(d.id)
      parts.push('[聊天记录]')
    } else if (t === 'json' || t === 'xml') {
      parts.push('[卡片]')
    }
  }
  return { text: parts.join('').trim(), isAtMe, atAll, images, replyId, imageUrls, imageKinds, imageSubTypes, videoUrls, files, forwardId }
}

/** 一条 OneBot 消息事件 → 业务侧的统一形状。 */
export function normalizeEvent(ev, selfId) {
  const mt = String(ev?.message_type || '')
  const group = mt === 'group'
  const seg = normalizeSegments(ev?.message, selfId)
  const sender = ev?.sender ?? {}
  return {
    id: String(ev?.message_id ?? ''),
    roomId: String(group ? ev?.group_id ?? '' : ev?.user_id ?? ''),
    isGroup: group,
    sender: String(ev?.user_id ?? ''),
    senderName: String(
      (group ? sender.card : '') || sender.nickname || ev?.user_id || '',
    ).trim(),
    text: seg.text,
    isAtMe: seg.isAtMe,
    atAll: seg.atAll,
    images: seg.images,
    imageUrls: seg.imageUrls,
    imageKinds: seg.imageKinds,
    imageSubTypes: seg.imageSubTypes,
    videoUrls: seg.videoUrls || [],
    files: seg.files || [],
    forwardId: seg.forwardId || '',
    videos: (seg.videoUrls || []).length,
    replyId: seg.replyId,
    isSelf: String(ev?.user_id ?? '') === String(selfId ?? '') || ev?.message_sender?.user_id === selfId,
    ts: Number(ev?.time ?? 0) * 1000 || Date.now(),
    raw: ev,
  }
}

/**
 * 连接 + 重连 + 动作调用。
 * 事件通过 onEvent(cb) 注册；状态通过 status 读。
 */
export class OneBot {
  constructor({ log = () => {} } = {}) {
    this.log = log
    this.status = {
      connected: false,
      reconnects: 0,
      lastError: '',
      self: null,
      httpUrl: '',
      wsUrl: '',
      lastEventAt: 0,
      msgsIn: 0,
      msgsOut: 0,
      errors: 0,
    }
    this.events = []
    this.ws = null
    this.timer = null
    this.stopped = true
    this.endpoints = null
    this.backoff = 1000
    this.gen = 0
  }

  onEvent(cb) {
    this.events.push(cb)
    return () => {
      const i = this.events.indexOf(cb)
      if (i >= 0) this.events.splice(i, 1)
    }
  }

  emit(ev) {
    for (const cb of this.events.slice()) {
      try {
        cb(ev)
      } catch (e) {
        this.log('事件处理异常：' + String(e?.message || e))
      }
    }
  }

  /** 发现端点并连接；已连接时先断开重来。 */
  async start(opts = {}) {
    this.stopped = false
    this.gen += 1
    const my = this.gen
    this.closeSocket()
    const d = await discover(opts)
    if (my !== this.gen) return d
    if (!d.ok) {
      this.status.lastError = d.error || '端点不可用'
      this.log('连接失败：' + this.status.lastError)
      this.scheduleReconnect(opts)
      return d
    }
    this.endpoints = { http: d.http, ws: d.ws }
    this.status.httpUrl = d.http.url
    this.status.wsUrl = d.ws?.url || ''
    this.status.self = d.self ?? null
    await this.openSocket(my, opts)
    return d
  }

  scheduleReconnect(opts) {
    if (this.stopped) return
    clearTimeout(this.timer)
    const wait = Math.min(30000, this.backoff)
    this.backoff = Math.min(30000, Math.round(this.backoff * 1.7))
    this.timer = setTimeout(() => {
      if (!this.stopped) void this.start(opts)
    }, wait)
    if (this.timer.unref) this.timer.unref()
  }

  closeSocket() {
    try {
      if (this.ws) {
        this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null
        this.ws.close()
      }
    } catch {
      /* ignore */
    }
    this.ws = null
    this.status.connected = false
  }

  openSocket(my, opts) {
    return new Promise((resolve) => {
      const ws = this.endpoints?.ws
      if (!ws?.url) {
        this.status.lastError = '账号配置里没有 wsServers'
        this.scheduleReconnect(opts)
        return resolve(false)
      }
      let settled = false
      const settle = (v) => {
        if (!settled) {
          settled = true
          resolve(v)
        }
      }
      let sock
      try {
        // 两种鉴权都带上：header 是主路径，query 是兜底（SnowLuma 两种都认）
        sock = new WebSocket(ws.url, {
          headers: ws.token ? { Authorization: `Bearer ${ws.token}` } : {},
        })
      } catch (e) {
        this.status.lastError = 'WebSocket 构造失败：' + String(e?.message || e)
        this.scheduleReconnect(opts)
        return settle(false)
      }
      this.ws = sock
      const connectTimer = setTimeout(() => {
        if (!settled) {
          this.status.lastError = 'WebSocket 连接超时'
          try {
            sock.close()
          } catch {
            /* ignore */
          }
          this.scheduleReconnect(opts)
          settle(false)
        }
      }, 12000)
      if (connectTimer.unref) connectTimer.unref()

      sock.onopen = () => {
        clearTimeout(connectTimer)
        if (my !== this.gen) {
          try {
            sock.close()
          } catch {
            /* ignore */
          }
          return settle(false)
        }
        this.status.connected = true
        this.status.lastError = ''
        this.backoff = 1000
        this.log(`已连接 SnowLuma WS ${ws.url}`)
        settle(true)
      }
      sock.onmessage = (m) => {
        let j
        try {
          j = JSON.parse(typeof m.data === 'string' ? m.data : String(m.data))
        } catch {
          return
        }
        if (j?.post_type === 'meta_event') {
          this.status.lastEventAt = Date.now()
          return
        }
        if (j?.post_type === 'message') {
          this.status.msgsIn += 1
          this.status.lastEventAt = Date.now()
          let norm = null
          try {
            norm = normalizeEvent(j, this.status.self?.user_id)
          } catch (e) {
            this.log('消息归一化失败：' + String(e?.message || e))
            return
          }
          this.emit(norm)
        }
        // notice（拍一拍/撤回/入群）也放出去，业务侧自己决定要不要用
        if (j?.post_type === 'notice' || j?.post_type === 'request') this.emit({ notice: j })
      }
      sock.onerror = () => {
        this.status.errors += 1
        this.status.lastError = 'WebSocket 错误'
      }
      sock.onclose = (e) => {
        clearTimeout(connectTimer)
        this.status.connected = false
        this.status.lastError = `连接关闭（${e?.code ?? '?'} ${e?.reason || ''}）`
        if (my === this.gen) {
          this.status.reconnects += 1
          this.scheduleReconnect(opts)
        }
        settle(false)
      }
    })
  }

  /** 动作调用（HTTP）。失败抛错，调用方决定降级。 */
  async call(action, params = {}, timeoutMs = 12000) {
    // 只读动作失败重试一次；发送类动作绝不重试（会产生重复消息）
    const readOnly = /^get_/.test(String(action))
    try {
      return await this._callOnce(action, params, timeoutMs)
    } catch (e) {
      if (!readOnly) throw e
      await new Promise((r) => setTimeout(r, 300))
      return await this._callOnce(action, params, timeoutMs)
    }
  }

  async _callOnce(action, params = {}, timeoutMs = 12000) {
    const ep = this.endpoints?.http
    if (!ep?.url) throw new Error('OneBot HTTP 端点未就绪')
    const res = await fetch(`${ep.url.replace(/\/+$/, '')}/${action}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(ep.token ? { authorization: `Bearer ${ep.token}` } : {}),
      },
      body: JSON.stringify(params ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body?.status === 'failed' || (body?.retcode ?? 0) !== 0) {
      throw new Error(`${action} 失败：HTTP ${res.status} retcode ${body?.retcode ?? '?'} ${body?.wording ?? ''}`.trim())
    }
    return body.data
  }

  async sendGroup(groupId, text) {
    const r = await this.call('send_group_msg', { group_id: groupId, message: String(text) })
    this.status.msgsOut += 1
    return r
  }

  async sendPrivate(userId, text) {
    const r = await this.call('send_private_msg', { user_id: userId, message: String(text) })
    this.status.msgsOut += 1
    return r
  }

  /** 发送任意段数组（@、图片、引用都走这里）。 */
  async sendGroupSegments(groupId, segments) {
    const r = await this.call('send_group_msg', { group_id: groupId, message: segments })
    this.status.msgsOut += 1
    return r
  }

  async sendGroupReply(groupId, messageId, text) {
    const message = [
      { type: 'reply', data: { id: String(messageId) } },
      { type: 'text', data: { text: String(text) } },
    ]
    const r = await this.call('send_group_msg', { group_id: groupId, message })
    this.status.msgsOut += 1
    return r
  }

  async groups() {
    return (await this.call('get_group_list', {}, 8000)) ?? []
  }

  /** 拍一拍（OneBot v11 的 send_poke；群聊带 group_id，私聊只带 user_id）。 */
  async sendPoke({ groupId, userId } = {}) {
    const params = { user_id: Number(userId) || userId }
    if (groupId) params.group_id = Number(groupId) || groupId
    const r = await this.call('send_poke', params, 8000)
    this.status.pokes = (this.status.pokes || 0) + 1
    return r
  }

  /** 单个群成员的资料（拍一拍事件里不带名字，得补一次）。 */
  async groupMember(groupId, userId) {
    return this.call(
      'get_group_member_info',
      { group_id: Number(groupId) || groupId, user_id: Number(userId) || userId, no_cache: false },
      8000,
    )
  }

  async groupMembers(groupId) {
    return (await this.call('get_group_member_list', { group_id: groupId }, 10000)) ?? []
  }

  /** 健康检查：HTTP 通 + WS 开。 */
  async health() {
    const out = { http: false, ws: !!this.status.connected, self: this.status.self, error: '' }
    try {
      const info = await this.call('get_login_info', {}, 5000)
      out.http = true
      out.self = info
      this.status.self = info
    } catch (e) {
      out.error = String(e?.message || e)
    }
    return out
  }

  stop() {
    this.stopped = true
    this.gen += 1
    clearTimeout(this.timer)
    this.closeSocket()
  }
}
