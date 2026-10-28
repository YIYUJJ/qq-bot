/**
 * 提示词拼装：情绪（mood）、聊天记录转录、系统提示词（人设 + 记忆 + 画像 + 关系）。
 */
  export const MOODS = {
    困: { len: 1, desc: '你有点困，反应慢半拍，话很少，懒得展开' },
    馋: { len: 2, desc: '你有点馋，注意力容易飘到吃的上面' },
    得意: { len: 2, desc: '你刚被夸了，有点得意，尾巴翘着' },
    委屈: { len: 1, desc: '你被说了，有点蔫，话短，不太想解释' },
    被惹到: { len: 1, desc: '你刚被逗/被拍，嘴硬，但没真生气' },
    开心: { len: 2, desc: '你心情不错，愿意多搭两句' },
    平静: { len: 2, desc: '你心情平平，正常说话' },
  }
  const MOOD_TTL_MS = 40 * 60 * 1000 // 40 分钟没被重新触发就淡掉

export const PROMPT_DEPS = ["config","cfgFor","getFeatures","isManagedRoom","memDirOf","pickFacts","roomTextOf"]

export function createPrompt(deps) {
  const missing = PROMPT_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('提示词模块缺少依赖：' + missing.join(', '))
  const { cfgFor, getFeatures, isManagedRoom, memDirOf, pickFacts, roomTextOf } = deps
  function moodName(r) {
    const m = r && r.mood
    if (!m || !m.name) return ''
    if (Date.now() - (m.at || 0) > MOOD_TTL_MS) return ''
    return m.name
  }

  function inferMood(r, text) {
    if (!cfgFor(r.roomId).moodEnabled) return
    const t = String(text || '')
    if (!t) return
    if (/滚|闭嘴|烦人|讨厌|笨|傻|蠢|废物/.test(t)) return setMood(r, '委屈', 2)
    if (/可爱|乖|好棒|真棒|喜欢你|爱你|厉害|聪明/.test(t)) return setMood(r, '得意', 2)
    if (/拍(拍)?|戳|捏/.test(t)) return setMood(r, '被惹到', 1)
    if (/饿|吃|白饭|饭|好吃|夜宵|奶茶/.test(t)) return setMood(r, '馋', 1)
    const h = new Date().getHours()
    if (h >= 1 && h < 5) return setMood(r, '困', 2)
    if (/哈哈|笑死|开心|好耶/.test(t)) return setMood(r, '开心', 1)
    if (moodName(r)) setMood(r, '平静', 1)
  }

  function buildTranscript(r, limit) {
    const lines = []
    const slice = r.msgs.slice(-Math.max(4, limit))
    // 最近 8 条里的图片保留描述（否则"图里有什么"会答"看不清"），更早的只留标记省 token
    for (let i = 0; i < slice.length; i++) {
      const m = slice[i]
      const keepDesc = i >= slice.length - 8
      // 时间戳在入库时就算好（hhmm），这里不再每条都 new Date + 补零
      let hhmm = m.hhmm
      if (!hhmm) {
        const t = new Date(m.ts)
        hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
        m.hhmm = hhmm
      }
      const who = m.isSelf ? '我' : m.senderName
      // 识图描述很长：历史里只留 [图片]/[表情] 标记，否则整段记录会被撑到 4000+ token
      // 早期消息只留标记省 token；最近 8 条保留前 60 字，模型才答得出"图里有什么"
      let text = String(m.text || '').replace(/\[(图片|表情)：([^\]]*)\]/g, (all, kind, desc) => {
        if (!keepDesc) return '[' + kind + ']'
        const d = String(desc || '').trim().slice(0, 60)
        return d ? '[' + kind + '：' + d + ']' : '[' + kind + ']'
      })
      if (text.length > 80) text = text.slice(0, 80) + '…'
      lines.push(`${hhmm} ${who}: ${text}`)
    }
    return lines.join('\n')
  }

  function systemPrompt(r) {
    const c = cfgFor(r.roomId)
    const now = new Date()
    const wd = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const where = r.isGroup ? `QQ 群「${r.roomName || r.roomId}」` : 'QQ 私聊'
    const f = pickFacts(r, Number(c.factsLimit) || 8)
    // 托管会话（大肥鱼群 / 管理员私聊）额外带上画像与摘要
    let memProfile = ''
    let memSummary = ''
    let memRelations = ''
    if (isManagedRoom(r.roomId)) {
      const dir = memDirOf(r.roomId)
      if (dir) {
        const t = roomTextOf(dir)
        memProfile = String(t.profile || '').slice(0, 900)
        memSummary = String(t.summary || '').slice(0, 600)
        memRelations = String(t.relations || '').slice(0, 800)
      }
    }
    return [
      c.persona,
      '',
      `当前：${where}｜${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 星期${wd} ${hh}:${mm}。`,
      c.masterName ? `群里的「${c.masterName}」是你最熟的人，可以更随便一点。` : '',
      (() => {
        const m = c.moodEnabled ? moodName(r) : ''
        return m && MOODS[m] ? `你现在的状态：${MOODS[m].desc}。` : ''
      })(),
      memProfile ? '你整理过这里的画像（谁是谁、性格、禁忌）：\n' + memProfile : '',
      memSummary ? '之前聊过的事（摘要）：\n' + memSummary : '',
      memRelations ? '你了解的这里的人际关系：\n' + memRelations : '',
      getFeatures().bondLine(r),
      (() => {
        if (!isManagedRoom(r.roomId)) return ''
        const dir = memDirOf(r.roomId)
        if (!dir) return ''
        const t = roomTextOf(dir)
        return [t.self ? '你对自己的认识：\n' + String(t.self).slice(0, 300) : '', t.diary ? '你最近写的日记：\n' + String(t.diary).slice(-400) : '']
          .filter(Boolean)
          .join('\n')
      })(),
      f.length ? '你记得关于这个群的事：\n' + f.map((x) => '- ' + x.text).join('\n') : '',
      '规则：',
      '- 只输出你要发到群里的话本身，不要旁白、不要解释、不要用引号包起来。',
      `- 像真人打字：这次最多说 ${r.lineTarget || c.maxLines} 句，总长不超过 ${r.replyCharsCap || c.maxReplyChars} 字；不用 markdown、不列清单。`,
      '- 不要用「咕/唔/嗷/呜」这类拟声词开头；一整条回复里最多出现一次，没必要时就不要用。',
      '- 不要 @ 所有人；不要提自己是 AI 或模型。',
      '- 上下文里「我」指你，「昵称: 内容」是群友发言。',
      '- 没话可说时就回一句短的（一句完整的话，别只甩一个「嗯」），不要强行展开。',
    ].filter(Boolean).join('\n')
  }
  function setMood(r, name, intensity = 1) {
    if (!r || !name || !MOODS[name]) return
    r.mood = { name, at: Date.now(), intensity }
  }

  return { moodName, inferMood, buildTranscript, systemPrompt, setMood }
}
