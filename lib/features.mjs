/**
 * 更多玩法：投票 / 亲密度 / 曲线 / 小游戏 / 提醒 / 日记。
 * 从 index.js 抽出的第一块（只移动、不改逻辑），外部能力全部通过 deps 注入。
 * 注意：必须由 index.js 懒初始化，别在 apply 早期构造（会踩 const 的 TDZ）。
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readDiary, appendDiary, writeSelf } from './memory.mjs'
import { rollDice, rps, drawLot, pickRiddle, parseReminder } from './extras.mjs'

export function createFeatures(d) {
  const config = d.config
  const rooms = d.rooms
  const reminders = d.reminders
  const polls = d.polls
  const REMINDERS_FILE = d.REMINDERS_FILE
  const POLLS_FILE = d.POLLS_FILE
  const log = d.log
  const sendReply = d.sendReply
  const roomState = d.roomState
  const allowedHere = d.allowedHere
  const isManagedRoom = d.isManagedRoom
  const memDirOf = d.memDirOf
  const readJson = d.readJson
  const writeJson = d.writeJson
  const normText = d.normText
  const recordReplied = d.recordReplied
  const generate = d.generate
  const factsOf = d.factsOf
  const invalidateRoomText = d.invalidateRoomText
  const moodName = d.moodName
  const ob = d.ob

  /** 投票：发起 / 投 / 结果 */
  async function tryPoll(r, trigger, c, gate = "") {
    if (!c.polls) return false
    const t = String(trigger.text || '').trim()
    const start = /^(?:发起投票)[:：]?\s*(.+)$/.exec(t) || /^投票[:：\s]+(.+)$/.exec(t)
    if (start) {
      if (gate) return true
      const raw = start[1]
      const opts = raw.split(/[\/|、,，]+/).map((x) => x.trim()).filter(Boolean)
      const q = opts.length >= 2 ? opts.shift() : raw.slice(0, 30)
      if (opts.length < 2) {
        await sendReply(r, { text: '投票至少要有两个选项，用 / 隔开', priority: 'at', quoteTo: trigger.id })
        return true
      }
      polls[r.roomId] = { q, options: opts.slice(0, 9), votes: {}, at: Date.now() }
      try { writeJson(POLLS_FILE, polls) } catch { /* ignore */ }
      const lines = opts.slice(0, 9).map((o, i) => (i + 1) + ' ' + o)
      await sendReply(r, { text: '投票｜' + q + '｜' + lines.join(' / ') + '｜投哪个回「投 1」', priority: 'at', quoteTo: trigger.id })
      return true
    }
    let p0 = polls[r.roomId]
    if (!p0) return false
    // 投票 24 小时过期，避免第二天"投 1"投到昨天的票上
    if (Date.now() - (Number(p0.at) || 0) > 24 * 3600 * 1000) {
      delete polls[r.roomId]
      try { writeJson(POLLS_FILE, polls) } catch { /* ignore */ }
      return false
    }
    if (/^投票(结果|票数)[。.!！]?$/.test(t) || /^(结果|票数)[？?]?$/.test(t)) {
      const counts = p0.options.map((o, i) => ({ o, n: Object.values(p0.votes).filter((v) => v === i + 1).length }))
      counts.sort((a2, b2) => b2.n - a2.n)
      await sendReply(r, { text: '票数：' + counts.map((x) => x.o + ' ' + x.n).join(' / '), priority: 'at', quoteTo: trigger.id })
      noteExtraReply(r)
      return true
    }
    if (/^结束投票[。.!！]?$/.test(t)) {
      delete polls[r.roomId]
      try { writeJson(POLLS_FILE, polls) } catch { /* ignore */ }
      await sendReply(r, { text: '投票结束了', priority: 'at', quoteTo: trigger.id })
      noteExtraReply(r)
      return true
    }
    const vote = /^(?:投|选)\s*([1-9]|一|二|三|四|五|六|七|八|九)$/.exec(t)
    if (vote) {
      if (gate) return true
      const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
      const idx = map[vote[1]] || Number(vote[1])
      if (idx < 1 || idx > p0.options.length) {
        await sendReply(r, { text: '没这个选项哦', priority: 'at', quoteTo: trigger.id })
        return true
      }
      p0.votes[String(trigger.sender)] = idx
      noteExtraReply(r)
      try { writeJson(POLLS_FILE, polls) } catch { /* ignore */ }
      await sendReply(r, { text: '记下了：' + p0.options[idx - 1], priority: 'at', quoteTo: trigger.id })
      return true
    }
    if (/^(?:投票结果|结果|票数)[？?]?$/.test(t)) {
      const counts = p0.options.map((o, i) => ({ o, n: Object.values(p0.votes).filter((v) => v === i + 1).length }))
      counts.sort((a, b) => b.n - a.n)
      await sendReply(r, { text: '票数：' + counts.map((x) => x.o + ' ' + x.n).join(' / '), priority: 'at', quoteTo: trigger.id })
      return true
    }
    return false
  }

  // ── 更多玩法：亲密度 / 小游戏 / 提醒 / 撤回 / 网页摘要 / 文档 / 日记 ──
  const BOND_LEVELS = [[800, '最亲'], [500, '很熟'], [250, '熟了'], [80, '有点熟'], [0, '还不熟']]
  function bondFile(r) {
    const dir = isManagedRoom(r.roomId) ? memDirOf(r.roomId) : ''
    return dir ? join(dir, 'bond.json') : ''
  }
  function loadBond(r) {
    if (r.bond) return r.bond
    r.bond = new Map()
    const f = bondFile(r)
    if (f) {
      const j = readJson(f, {})
      for (const [k, v] of Object.entries(j)) r.bond.set(String(k), Number(v) || 0)
    }
    return r.bond
  }
  function bumpBond(r, sender, n = 1) {
    if (!r || !config.bondEnabled || !sender) return
    const b = loadBond(r)
    const cur = b.get(String(sender)) || 0
    b.set(String(sender), Math.max(0, Math.min(2000, cur + n)))
    r.bondDirty = true
  }
  function saveBond(r) {
    if (!r?.bondDirty) return
    r.bondDirty = false
    const f = bondFile(r)
    if (!f) return
    const o = {}
    for (const [k, v] of r.bond) o[k] = v
    try { writeJson(f, o) } catch { /* ignore */ }
  }
  function bondLine(r) {
    if (!config.bondEnabled || !r.isGroup) return ''
    const b = loadBond(r)
    if (!b.size) return ''
    const top = [...b.entries()].sort((a, b2) => b2[1] - a[1])[0]
    if (!top || top[1] < 20) return ''
    const name = r.nameCache.get(top[0]) || top[0]
    const lvl = BOND_LEVELS.find(([min]) => top[1] >= min)[1]
    return `你和「${name}」最熟（亲密度 ${Math.min(100, Math.round(top[1] / 10))}/100，${lvl}）。`
  }

  /** 提醒到点：逐条发出去 */
  async function checkReminders() {
    if (!config.reminders) return
    const now = Date.now()
    const due = reminders.filter((x) => Number(x.at) <= now)
    if (!due.length) return
    for (const item of due) {
      const i = reminders.indexOf(item)
      if (i >= 0) reminders.splice(i, 1)
      try {
        const r = roomState(item.roomId)
        if (!allowedHere(r)) continue
        if (typeof r.isGroup === 'boolean' && r.isGroup !== !!item.isGroup) r.isGroup = !!item.isGroup
        await sendReply(r, { text: '到点了……你说要' + item.text, priority: 'at' })
        log('提醒发送：' + String(item.text).slice(0, 30))
      } catch (e) {
        log('提醒发送失败：' + String(e?.message || e))
      }
    }
    try { writeJson(REMINDERS_FILE, reminders) } catch { /* ignore */ }
  }

  let diaryBusy = false
  function localDay(d = new Date()) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
  /** 每天过了 diaryHour，就给托管群写一篇日记 + 更新自述 */
  async function maybeDiary(force = false) {
    if (!config.diaryEnabled || diaryBusy) return
    const now = new Date()
    const hour = Math.max(0, Math.min(23, Number(config.diaryHour) || 23))
    if (!force && now.getHours() < hour) return
    const day = localDay(now)
    diaryBusy = true
    try {
      for (const r of rooms.values()) {
        if (!r.isGroup || !isManagedRoom(r.roomId) || !r.msgs.length) continue
        if (r.lastDiaryDay === day) continue
        const todayStart = new Date(now)
        todayStart.setHours(0, 0, 0, 0)
        const todays = r.msgs.filter((m) => m.ts >= todayStart.getTime())
        if (todays.length < 4) continue
        const dir = memDirOf(r.roomId)
        if (!dir) continue
        // 同一天已经写过就不再写（避免重载/手动跑重复追加）
        if (String(readDiary(dir, 8000)).includes('## ' + day)) {
          r.lastDiaryDay = day
          continue
        }
        const recent = todays.slice(-40).map((m) => (m.isSelf ? '我' : m.senderName) + ': ' + m.text).join('\n')
        try {
          const { text } = await generate({
            system: '你在帮一个有人设的聊天角色写当天日记。只输出日记正文，第一人称，80~150 字，口语，不要日期、不要标题、不要解释。注意：聊天里那位常说话的人用「他」指代。',
            user: '今天的聊天记录：\n' + recent + '\n\n写今天的日记。',
            maxTokens: 500,
            temperature: 0.7,
          })
          const body = String(text || '').trim()
          if (!body) continue
          appendDiary(dir, body, day)
          invalidateRoomText(dir)
          r.lastDiaryDay = day
          log('日记：' + (r.roomName || r.roomId) + ' 已写（' + body.length + ' 字）')
          // 自述：模型偶尔会把预算花在"想"上返回空，给足预算并重试一次
          let selfText = ''
          for (const budget of [700, 1100]) {
            try {
              const { text: self } = await generate({
                system: '用第一人称写一段"我是谁"，100 字以内，口语，不要标题、不要解释。',
                user: '日记：\n' + body + '\n\n记得的事：\n' + factsOf(r.roomId).map((f) => '- ' + f.text).join('\n'),
                maxTokens: budget,
                temperature: 0.6,
              })
              selfText = String(self || '').trim()
              if (selfText) break
              log('自述：模型返回空，换大预算重试（' + budget + '）')
            } catch (e) {
              log('自述失败（' + budget + '）：' + String(e?.message || e))
            }
          }
          if (selfText) {
            writeSelf(dir, selfText)
            invalidateRoomText(dir)
            log('自述：' + (r.roomName || r.roomId) + ' 已更新（' + selfText.length + ' 字）')
          } else {
            log('自述：两次都没生成出来，保留旧版')
          }
        } catch (e) {
          log('写日记失败：' + String(e?.message || e))
        }
      }
    } finally {
      diaryBusy = false
    }
  }

  function curvePath(r) {
    const dir = isManagedRoom(r.roomId) ? memDirOf(r.roomId) : ''
    return dir ? join(dir, 'curve.json') : ''
  }
  /** 记一格曲线：当天的心情分布 + 最高亲密度 */
  function recordCurve(r) {
    if (!config.curveEnabled) return
    const f = curvePath(r)
    if (!f) return
    if (!r.curve) r.curve = readJson(f, {})
    const day = localDay()
    const slot = r.curve[day] || { m: {}, bond: 0, msgs: 0 }
    const mood = (config.moodEnabled && moodName(r)) || '平静'
    slot.m = slot.m || {}
    slot.m[mood] = (slot.m[mood] || 0) + 1
    slot.msgs = (slot.msgs || 0) + 1
    const b = loadBond(r)
    if (b.size) {
      const top = Math.max(...b.values())
      slot.bond = Math.max(Number(slot.bond) || 0, top)
    }
    r.curve[day] = slot
    r.curveDirty = true
  }

  /** 玩法类（游戏/投票/建提醒）不看概率，但要看最小间隔和 10 分钟上限 */
  function extrasGate(r, c) {
    const now = Date.now()
    const gap = Math.max(1500, Number(c.minReplyGapMs) || 0)
    if (r.lastReplyAt && now - r.lastReplyAt < gap) return '间隔太近'
    const cap = Number(c.maxRepliesPer10Min) || 200
    const recent = (r.replyTimes || []).filter((t) => now - t < 600000).length
    if (recent >= cap) return '10 分钟上限'
    return ''
  }
  function noteExtraReply(r) {
    const now = Date.now()
    r.lastReplyAt = now
    r.replyTimes = (r.replyTimes || []).filter((t) => now - t < 600000)
    r.replyTimes.push(now)
  }

  /** 小游戏：骰子 / 猜拳 / 抽签 / 猜谜（不走模型，直接回） */
  async function tryGame(r, trigger, c, gate = "") {
    if (!c.games) return false
    const t = String(trigger.text || '')
    let reply = ''
    let riddleAnswered = false
    // 上一句是谜语，这句先当答案（除非又下了新指令）
    const isCmd = /(猜谜|出个谜|猜个谜|骰子|dice|roll\b|石头剪刀布|猜拳|rps|抽(个)?签)/i.test(t)
    if (r.pendingRiddle && !isCmd) {
      const ans = r.pendingRiddle.a
      const hit = normText(t).includes(normText(ans))
      reply = hit ? `对，就是${ans}！` : `不对哦，是「${ans}」`
      r.pendingRiddle = null
    } else if (/(掷|摇|滚)?\s*(个)?\s*骰子|dice|\broll\b/i.test(t)) {
      reply = `掷出 ${rollDice(t)}`
    } else if (/石头剪刀布|猜拳|\brps\b/i.test(t)) {
      const pick = (t.match(/石头|剪刀|布/) || [])[0]
      const g = rps(pick)
      const res = g.res === '平' ? '平局' : g.res === '我赢' ? '我赢啦' : '你赢了'
      reply = `我出${g.me}，你出${g.you}，${res}`
    } else if (/抽(个)?签|求个签/.test(t)) {
      reply = `抽到「${drawLot()}」`
    } else if (/猜谜|出个谜|猜个谜/.test(t)) {
      const q = pickRiddle()
      r.pendingRiddle = q
      reply = q.q
    } else {
      return false
    }
    if (gate) {
      log('玩法跳过（' + gate + '）：' + reply.slice(0, 20))
      return true
    }
    const sent = await sendReply(r, { text: reply, priority: 'at', quoteTo: trigger.id, atUser: trigger.sender })
    noteExtraReply(r)
    r.lastSender = String(trigger.sender)
    log(`小游戏 ${r.roomName || r.roomId}｜${reply.slice(0, 40)}`)
    if (sent.length) recordReplied(r.roomId, trigger.id)
    return true
  }

  /** 定时提醒 */
  async function tryReminder(r, trigger, c, gate = "") {
    if (!c.reminders) return false
    const parsed = parseReminder(trigger.text)
    if (!parsed || !parsed.text) return false
    if (gate) return true
    const mine = reminders.filter((x) => x.roomId === r.roomId)
    if (mine.length >= 20) {
      await sendReply(r, { text: '提醒太多了，先清几个吧', priority: 'at', quoteTo: trigger.id })
      return true
    }
    noteExtraReply(r)
    const item = {
      id: randomUUID(),
      roomId: r.roomId,
      isGroup: !!r.isGroup,
      at: parsed.at,
      text: parsed.text,
      createdAt: Date.now(),
    }
    reminders.push(item)
    try { writeJson(REMINDERS_FILE, reminders) } catch { /* ignore */ }
    const d = new Date(item.at)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const dayTxt = d.toDateString() === new Date().toDateString() ? '' : '明天'
    await sendReply(r, {
      text: `好，${dayTxt}${hh}:${mm} 提醒你${parsed.text}`,
      priority: 'at',
      quoteTo: trigger.id,
    })
    return true
  }

  /** 撤回：管理员说"撤回"就撤机器人上一条（群里只认管理员 QQ） */
  async function tryRecall(r, trigger, c) {
    if (!c.recallCmd) return false
    const t = String(trigger.text || '').trim()
    if (!/^(撤回|撤回上一条|撤了|收回|删掉上一条)[。.!！]?$/.test(t)) return false
    const isAdmin = config.adminQQ.includes(String(trigger.sender))
    if (!isAdmin) return false
    const id = r.lastBotMsgId
    if (!id) {
      await sendReply(r, { text: '没什么可撤的呀', priority: 'at', quoteTo: trigger.id })
      return true
    }
    try {
      await ob.call('delete_msg', { message_id: Number(id) || id })
      r.lastBotMsgId = ''
      log(`撤回了一条消息（${r.roomName || r.roomId}）`)
    } catch (e) {
      log('撤回失败：' + String(e?.message || e))
    }
    return true
  }


  /** 把脏了的曲线写盘（原来在 index.js 的定时器里直接调 curvePath，搬家后漏了 → 定时器抛异常把宿主进程带崩） */
  function flushCurves() {
    let n = 0
    for (const rr of rooms.values()) {
      if (!rr.curveDirty) continue
      rr.curveDirty = false
      const cf = curvePath(rr)
      if (cf && rr.curve) {
        try {
          writeJson(cf, rr.curve)
          n += 1
        } catch {
          /* ignore */
        }
      }
    }
    return n
  }

  return {
    bumpBond, saveBond, bondLine, recordCurve, flushCurves,
    curvePathFor: (r) => curvePath(r),
    extrasGate, noteExtraReply,
    tryGame, tryPoll, tryReminder, tryRecall,
    checkReminders, maybeDiary,
  }
}
