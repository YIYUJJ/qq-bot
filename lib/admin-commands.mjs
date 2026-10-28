/**
 * 管理员指令：识别 / 描述 / 归一化。
 *
 * 从 index.js 抽出的第一批"业务纯逻辑"：
 *   - findRoomByText：把"大肥鱼群"这类说法解析成群号
 *   - detectIntents：一句话里有几个动作（避免复合指令只执行一半）
 *   - parseAdminCommand：规则解析（不调模型）
 *   - describeAdminAction：给管理员看的中文描述（执行前确认用）
 *   - normalizePlannedActions：模型给出的动作计划做白名单/长度/范围过滤
 *
 * 依赖注入：rooms / groupNames / config（都按引用传，配置热更新自动生效）。
 */

export function createAdminCommands({ rooms, groupNames, config }) {
  function findRoomByText(text) {
    const t = String(text || '')
    for (const id of new Set([...groupNames.keys(), ...rooms.keys()])) {
      if (id && t.includes(id)) return { roomId: id, name: groupNames.get(id) || (rooms.get(id) || {}).roomName || '' }
    }
    let best = null
    for (const [id, name] of groupNames) {
      if (!name || name.length < 2) continue
      if (t.includes(name) && (!best || name.length > best.name.length)) best = { roomId: id, name }
    }
    if (best) return best
    for (const r of rooms.values()) {
      if (r.roomName && r.roomName.length >= 2 && t.includes(r.roomName)) {
        if (!best || r.roomName.length > best.name.length) best = { roomId: r.roomId, name: r.roomName }
      }
    }
    return best
  }

  /** 先数"这句话里有几个动作"，避免把复合指令只执行一半。 */
  function detectIntents(t) {
    const out = []
    if (/(取消|不用|别)[\s\S]{0,12}?必回/.test(t)) out.push('alwaysReplyOff')
    else if (/必回|必须回|一定回/.test(t)) out.push('alwaysReplyOn')
    if (/(恢复|解除|取消)[\s\S]{0,8}?(安静|静音|说话)/.test(t)) out.push('unmute')
    else if (/(安静|闭嘴|别说话|静音|歇一会)/.test(t)) out.push('mute')
    if (/(?:人设|性格)[\s\S]{0,8}?(?:改成|改为|设为|换成)/.test(t)) out.push('persona')
    if (/(?:说|发|告诉|通知|转告|喊)(?:一句|一句话|句话)?\s*[:：]\s*([\s\S]+)/.test(t)) out.push('say')
    return [...new Set(out)]
  }

  /** 从一句话里认出管理员的遥控指令（规则部分，不调模型）。 */
  function parseAdminCommand(text) {
    const t = String(text || '').trim()
    const target = findRoomByText(t)
    const intents = detectIntents(t)
    if (!intents.length) return null
    if (intents.length > 1) return { action: 'multi', target, intents }
    const action = intents[0]
    if (action === 'mute') {
      const m = /(\d{1,3})\s*(分钟|小时)/.exec(t)
      const minutes = m ? (m[2] === '小时' ? Number(m[1]) * 60 : Number(m[1])) : 60
      return { action, target, minutes }
    }
    if (action === 'persona') {
      const pm = /(?:人设|性格)[\s\S]{0,8}?(?:改成|改为|设为|换成)\s*[:：]?\s*([\s\S]+)/.exec(t)
      return pm ? { action, target, value: pm[1].trim().slice(0, 800) } : null
    }
    if (action === 'say') {
      const sm =
        /(?:说|发|告诉|通知|转告|喊)(?:一句|一句话|句话)?\s*[:：]\s*([\s\S]+)/.exec(t) ||
        /(?:说一句|说句话|发一句|发句话)\s*[:：]?\s*([\s\S]+)/.exec(t)
      return sm ? { action, target, text: sm[1].trim().slice(0, 500) } : null
    }
    return { action, target }
  }

  function describeAdminAction(a) {
    const name = a.target?.name || a.target?.roomId || '?'
    if (a.action === 'multi') return `一句话里有多个动作（${(a.intents || []).join('、')}），一次只能说一件`
    if (a.action === 'compose') return `在群「${name}」按你的要求说一句：${a.instruction}`
    if (a.action === 'say') return `在群「${name}」发送：\n${a.text}`
    if (a.action === 'mute') return `把群「${name}」静音 ${a.minutes} 分钟`
    if (a.action === 'unmute') return `让群「${name}」恢复正常说话`
    if (a.action === 'alwaysReplyOn') return `让群「${name}」变成必回（不看概率）`
    if (a.action === 'alwaysReplyOff') return `取消群「${name}」的必回`
    if (a.action === 'persona') return `把群「${name}」的人设改成：\n${a.value}`
    return '未知操作'
  }

  function normalizePlannedActions(list) {
    const max = Math.max(1, Math.min(5, Number(config.adminMaxActions) || 3))
    const allowed = new Set(['say', 'compose', 'mute', 'unmute', 'alwaysReplyOn', 'alwaysReplyOff', 'persona'])
    const out = []
    for (const raw of (Array.isArray(list) ? list : []).slice(0, max)) {
      const action = String(raw?.action || '')
      if (!allowed.has(action)) continue
      const room = String(raw?.room || '')
        .trim()
        .replace(/^group:/, '')
      if (!room) continue
      const target = { roomId: room, name: groupNames.get(room) || (rooms.get(room) || {}).roomName || '' }
      const a = { action, target }
      if (action === 'say') {
        const t = String(raw.text || '').trim()
        if (!t) continue
        a.text = t.slice(0, 500)
      } else if (action === 'compose') {
        const ins = String(raw.instruction || '').trim()
        if (!ins) continue
        a.instruction = ins.slice(0, 300)
        if (raw.at) a.at = String(raw.at).replace(/\D/g, '').slice(0, 12)
      } else if (action === 'mute') {
        a.minutes = Math.max(1, Math.min(720, Number(raw.minutes) || 60))
      } else if (action === 'persona') {
        const v = String(raw.value || '').trim()
        if (!v) continue
        a.value = v.slice(0, 800)
      }
      out.push(a)
    }
    return out
  }

  return { findRoomByText, detectIntents, parseAdminCommand, describeAdminAction, normalizePlannedActions }
}
