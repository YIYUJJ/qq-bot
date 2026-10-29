/**
 * 链接/搜索/视频链接的"笔记"生成 + 搜索工具函数。
 */
import { pickWebLink, fetchPageSummary } from './extras.mjs'
import { pickVideoLinks, ytdlpInfo, ytdlpSubtitleText } from './video.mjs'

export const NOTES_DEPS = ["addFact","cfgFor","config","ctx","delFact","factsOf","isManagedRoom","log","stats"]

export function createNotes(deps) {
  const missing = NOTES_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('笔记模块缺少依赖：' + missing.join(', '))
  const { ctx, addFact, cfgFor, config, delFact, factsOf, isManagedRoom, log, stats } = deps

  const webCache = new Map() // url -> { at, data }
  const linkCache = new Map() // url -> { info, at }（只在内存，重启清空）

  const SEARCH_TRIGGER =
    /(搜一下|搜一搜|搜搜|搜下|搜索|帮我搜|你去搜|给我搜|查一下|查一查|查查|查下|帮我查|你去查|给我查|百度一下|谷歌一下|google一下|bing一下|联网查|上网查|核实一下|验证一下|查证一下|看一下|看一看|看一眼|看看|瞧一瞧)/i
  const SEARCH_STRIP =
    /(?:你|帮我|给我|麻烦你?|能不能|可不可以|可以|要不|那就)?\s*(?:去|上网上|联网|上网)?\s*(?:搜一下|搜一搜|搜搜|搜下|搜索|搜|查一下|查一查|查查|查下|查|百度一下|百度|谷歌一下|谷歌|google一下|google|bing一下|核实一下|验证一下|查证一下|看一下|看一看|看一眼|看看|瞧一瞧)\s*(?:一下|下|个|一搜)?\s*[:：]?/i
  const SEARCH_TAIL =
    /(?:[，,。.！!]?\s*(?:然后|再|顺便)?\s*(?:告诉我|跟我说|回复我|回我|发我|说一下|讲讲|总结一下|整理一下|给我看看)[\s\S]*)$/i

  function rememberVideo(r, v, info) {
    const c = cfgFor(r.roomId)
    if (!c.videoRemember) return
    if (!isManagedRoom(r.roomId)) return
    const rawTitle = info?.title ? String(info.title).replace(/\s+/g, ' ').trim() : ''
    const title = rawTitle ? (rawTitle.length > 26 ? rawTitle.slice(0, 26) + '…' : rawTitle) : ''
    let desc = String(v?.desc || '').replace(/\s+/g, ' ').trim()
    if (desc === '-' || /^[-—\s]*$/.test(desc)) desc = ''
    if (!title && !desc) return
    const secs = Math.round(Number(v?.duration || info?.duration || 0))
    const text = ('看过一个视频' + (title ? `《${title}》` : '') + (secs ? `（${secs} 秒）` : '') + '：' + (desc || '只拿到标题，没看到画面')).slice(0, 160)
    // 只保留最近 N 条视频记忆
    const max = Math.max(1, Number(c.videoRememberMax) || 5)
    const old = factsOf(r.roomId).filter((x) => !x.supersededAt && x.text.startsWith('看过一个视频'))
    while (old.length >= max) {
      const victim = old.shift()
      try { delFact(r.roomId, victim.text) } catch { /* ignore */ }
    }
    // 看视频得来的：来源记成「观察」（记忆深化第 7 项）
    const ok = addFact(r.roomId, text, Date.now(), { source: '观察' })
    if (ok) log('视频记忆：' + text.slice(0, 50))
  }

  async function buildWebLinkNote(text, c) {
    if (!c.linkSummary) return ''
    const links = pickWebLink(text, 1)
    if (!links.length) return ''
    const url = links[0]
    const hit = webCache.get(url)
    let data = hit && Date.now() - hit.at < 3600000 ? hit.data : null
    if (!data) {
      try {
        data = await fetchPageSummary(url, { maxChars: 1200 })
        webCache.set(url, { at: Date.now(), data })
        if (webCache.size > 200) {
          const oldest = [...webCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, webCache.size - 200)
          for (const [k] of oldest) webCache.delete(k)
        }
      } catch (e) {
        log('网页摘要失败：' + String(e?.message || e))
        return '\n【群友发的链接】没打开（' + String(e?.message || '').slice(0, 50) + '）。别装看过，就说没打开。'
      }
    }
    if (!data) return ''
    return [
      '\n【群友发的网页链接（已抓到的内容）】',
      data.title ? '标题：' + data.title : '',
      data.description ? '简介：' + data.description : '',
      data.text ? '正文节选：' + data.text : '',
      '（用平时口气说一句它讲什么，别念链接、别列条目。）',
    ].filter(Boolean).join('\n')
  }

  async function buildVideoLinkNote(text, c) {
    if (!c.linkVideo) return null
    const links = pickVideoLinks(text, 1)
    if (!links.length) return null
    const link = links[0]
    const cachedLink = linkCache.get(link)
    const fresh = !!cachedLink && Date.now() - cachedLink.at < 3600000
    const info = fresh
      ? cachedLink.info
      : await ytdlpInfo(link, { timeoutMs: Math.min(30000, Number(c.linkVideoTimeoutMs) || 15000) })
    if (!info.ok) {
      log('视频链接解析失败：' + String(info.error || '').slice(0, 120))
      return { note: '\n【群友发的视频链接】没解析出来（' + String(info.error || '未知原因').slice(0, 80) + '）。别装看过，就说没打开。', info: null }
    }
    // 字幕也缓存：同一个链接 1 小时内不再跑 yt-dlp（抓不到也记住"试过了"，别反复超时）
    let sub = fresh && typeof cachedLink.sub === 'string' ? cachedLink.sub : ''
    const subTried = fresh && cachedLink.subTried === true
    if (!subTried && !sub && info.duration && info.duration <= 900) {
      try {
        sub = await ytdlpSubtitleText(link, { timeoutMs: Math.min(30000, Number(c.linkVideoTimeoutMs) || 15000), maxChars: Number(c.linkVideoChars) || 1200 })
      } catch { /* 没字幕就算了 */ }
    }
    linkCache.set(link, { info, sub, subTried: true, at: Date.now() })
    if (linkCache.size > 200) {
      const oldest = [...linkCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, linkCache.size - 200)
      for (const [k] of oldest) linkCache.delete(k)
    }
    log('视频链接：' + info.title.slice(0, 40) + '｜' + (sub ? '有字幕 ' + sub.length + ' 字' : '无字幕'))
    const note = [
      '\n【群友发的视频链接（已抓到的信息）】',
      info.title ? '标题：' + info.title : '',
      info.uploader ? 'UP主：' + info.uploader : '',
      info.duration ? '时长：' + Math.round(info.duration) + ' 秒' : '',
      info.description && info.description !== '-' ? '简介：' + info.description : '',
      sub ? '字幕节选：' + sub : '（没抓到字幕）',
      '（用平时的口气说一句你看到的内容；没抓到具体内容就说没打开，别编。）',
    ].filter(Boolean).join('\n')
    return { note, info: { ...info, subtitle: sub } }
  }

  function stripHtml(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
  }

  async function fetchExcerpt(url, chars, timeoutMs) {
    const web = ctx.get?.('web')
    if (!web || typeof web.fetch !== 'function') return ''
    const r = await web.fetch({ url }, AbortSignal.timeout(timeoutMs))
    // 先截断再剥标签：有的页面几 MB，整段 stripHtml 会明显卡住
    const body = String(r?.body?.content || '').slice(0, 200000)
    const text = r?.body?.kind === 'html' ? stripHtml(body) : body
    return text.slice(0, chars)
  }

  async function webSearch(query, limit, timeoutMs) {
    const web = ctx.get?.('web')
    if (!web || typeof web.search !== 'function') throw new Error('DSH 没有可用的 web 搜索服务')
    const r = await web.search({ query, maxResults: limit }, AbortSignal.timeout(timeoutMs))
    const srcs = (r?.sources || []).slice(0, limit)
    const lines = srcs.map(
      (s, i) => `${i + 1}. ${s.title || '(无标题)'}${s.snippet ? ' — ' + s.snippet : ''}${s.url ? `（${s.url}）` : ''}`,
    )
    // 搜索常常只给标题：抓第一条正文补足事实（天气/价格/比分这类必须靠它）
    let excerpt = ''
    if (config.searchFetchTop && srcs[0]?.url) {
      try {
        excerpt = await fetchExcerpt(
          srcs[0].url,
          Number(config.searchFetchChars) || 1200,
          Math.max(3000, timeoutMs),
        )
      } catch {
        /* 抓不到就算了，别影响搜索本身 */
      }
    }
    const text = [
      r?.content ? String(r.content) : '',
      ...lines,
      excerpt ? `页面摘录（${srcs[0].url}）：\n${excerpt}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    return { text, count: srcs.length, fetched: !!excerpt }
  }

  function extractSearchQuery(text) {
    const t = String(text || '').trim()
    if (!t || !SEARCH_TRIGGER.test(t)) return ''
    let q = t.replace(SEARCH_STRIP, '').replace(SEARCH_TAIL, '').trim()
    // 去掉开头的 @我 / @所有人 占位（只认这三个，别贪吃掉整句）
    q = q
      .replace(/^@(?:我|所有人|全体成员)\s*/, '')
      .replace(/^[，,。.：:\s]+/, '')
      .replace(/[？?！!。.]+$/, '')
      .trim()
    if (!q) {
      q = t
        .replace(SEARCH_STRIP, '')
        .replace(/@(?:我|所有人|全体成员)/g, ' ')
        .trim()
        .slice(0, 80)
    }
    return q.slice(0, 80)
  }

  function sensitiveQuery(q) {
    const s = String(q || '')
      .replace(/@(我|所有人|全体成员)/g, ' ')
      .trim()
    if (/\d{6,}/.test(s)) return '含长数字（可能是 QQ 号/手机号）'
    if (/https?:\/\//i.test(s)) return '含链接'
    if (/@[A-Za-z0-9_.-]{2,}/.test(s)) return '含 @ 账号'
    return ''
  }

  async function buildSearchNote(room, text, c = cfgFor(room.roomId)) {
    if (!c.webSearch) return null
    const query = extractSearchQuery(text)
    if (!query) return null
    const bad = sensitiveQuery(query)
    if (bad) {
      log(`不搜「${query}」：${bad}`)
      return { query, skipped: bad, text: '' }
    }
    const now = Date.now()
    if (room.lastSearchAt && now - room.lastSearchAt < Number(c.searchCooldownMs)) {
      return { query, skipped: '冷却中', text: '' }
    }
    const t0 = Date.now()
    try {
      const { text: body, count } = await webSearch(
        query,
        Number(c.searchMaxResults) || 5,
        Number(c.searchTimeoutMs) || 8000,
      )
      room.lastSearchAt = Date.now()
      stats.searches += 1
      log(`联网搜索「${query}」→ ${count} 条（${Date.now() - t0}ms）`)
      return { query, text: body, count, ms: Date.now() - t0 }
    } catch (e) {
      const msg = String(e?.message || e)
      log(`联网搜索失败「${query}」：${msg}`)
      return { query, error: msg, text: '' }
    }
  }
  return { buildWebLinkNote, buildVideoLinkNote, buildSearchNote, extractSearchQuery, sensitiveQuery, webSearch, rememberVideo }
}
