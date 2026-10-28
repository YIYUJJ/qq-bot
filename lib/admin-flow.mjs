/**
 * 管理员遥控流程：规则解析 → 确认 → 执行；规则没命中时交给模型拆解。
 *
 * pendingAdmin（待确认指令）也放在模块内，避免 index.js 再存一份可变状态。
 */
export const ADMIN_FLOW_DEPS = ["config","describeAdminAction","generate","isAllowedGroup","log","metrics","normalizePlannedActions","ob","parseAdminCommand","roomOverrides","roomState","sendWithRetry","setRoomOverride","sleep","stats","systemPrompt"]

export function createAdminFlow(deps) {
  const missing = ADMIN_FLOW_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('管理员流程缺少依赖：' + missing.join(', '))
  const { config, describeAdminAction, generate, isAllowedGroup, log, metrics, normalizePlannedActions, ob, parseAdminCommand, roomOverrides, roomState, sendWithRetry, setRoomOverride, sleep, stats, systemPrompt } = deps

  let pendingAdmin = null
  const CONFIRM_WORDS = /^(确认|确定|执行|是的|yes|y|ok)$/i
  const CANCEL_WORDS = /^(取消|算了|不用了|不|no|n)$/i


  /** 先数"这句话里有几个动作"，避免把复合指令只执行一半。 */

  /** 从一句话里认出管理员的遥控指令。 */


  async function replyAdmin(adminId, text) {
    try {
      await ob.sendPrivate(adminId, text)
    } catch (e) {
      log('回复管理员失败：' + String(e?.message || e))
    }
  }

  async function executeAdminAction(a) {
    const roomId = a.target.roomId
    const name = a.target.name || roomId
    try {
      if (a.action === 'say') {
        const res = await sendWithRetry(roomId, true, 'text', a.text)
        return res.queued ? `⚠️ 网络抖动，已排队重发到「${name}」` : `✅ 已发到「${name}」`
      }
      if (a.action === 'compose') {
        const rr = roomState(roomId)
        const out = await generate({
          system: systemPrompt(rr),
          user: `现在按这个要求，用你在这个群里平时的口气说一句话：${a.instruction}\n只输出这句话本身，不要解释、不要引号。`,
          maxTokens: Math.max(80, Number(config.adminComposeTokens) || 400),
        })
        const line = String(out.text || '').trim()
        if (!line) return `⚠️ 「${name}」生成失败`
        if (a.at) {
          await ob.sendGroupSegments(roomId, [
            { type: 'at', data: { qq: String(a.at) } },
            { type: 'text', data: { text: ' ' + line } },
          ])
          return `✅ 在「${name}」@${a.at} 说了：${line.slice(0, 50)}`
        }
        const res = await sendWithRetry(roomId, true, 'text', line)
        return res.queued ? `⚠️ 网络抖动，已排队重发到「${name}」` : `✅ 在「${name}」说了：${line.slice(0, 50)}`
      }
      if (a.action === 'mute') {
        const r = roomState(roomId)
        r.muteUntil = Date.now() + a.minutes * 60000
        return `🔇 「${name}」已静音 ${a.minutes} 分钟`
      }
      if (a.action === 'unmute') {
        const r = roomState(roomId)
        r.muteUntil = 0
        return `🔊 「${name}」已恢复说话`
      }
      if (a.action === 'alwaysReplyOn' || a.action === 'alwaysReplyOff') {
        const cur = roomOverrides[roomId] || {}
        setRoomOverride(roomId, { ...cur, alwaysReply: a.action === 'alwaysReplyOn' })
        return `✅ 「${name}」必回=${a.action === 'alwaysReplyOn' ? '开' : '关'}`
      }
      if (a.action === 'persona') {
        const cur = roomOverrides[roomId] || {}
        setRoomOverride(roomId, { ...cur, persona: a.value })
        return `✅ 「${name}」人设已更新`
      }
    } catch (e) {
      return '❌ 执行失败：' + String(e?.message || e)
    }
    return '❓ 不认识的指令'
  }

  // ── 自然语言指令：规则没命中时，让模型翻译成动作计划 ──
  const ADMIN_ACTION_DOC = [
    '- say {room, text}：把 text 原样发到群里',
    '- compose {room, instruction, at?}：按 instruction 用该群人格生成一句话发到群里；at 是要 @ 的 QQ 号',
    '- mute {room, minutes}：静音该群 minutes 分钟',
    '- unmute {room}：解除静音',
    '- alwaysReplyOn {room} / alwaysReplyOff {room}：开/关该群必回',
    '- persona {room, value}：把该群人设改成 value',
  ].join('\n')

  async function planAdminCommand(text) {
    const groups = [...groupNames.entries()]
      .slice(0, 30)
      .map(([id, name]) => `${id} ${name || ''}`)
      .join('\n')
    const max = Math.max(1, Math.min(5, Number(config.adminMaxActions) || 3))
    try {
      const req = {
        system: '你是指令解析器。只输出 JSON，不要解释、不要代码块标记。',
        user: [
          `管理员说：「${text}」`,
          '（管理员＝跟你私聊的这个人；"我/我一句"都指管理员本人）',
          '',
          '可用动作：',
          ADMIN_ACTION_DOC,
          '',
          '判断要点：',
          '- 让你"喊他/叫他/夸他/说一句/打招呼"→ 用 compose（instruction 写清要什么口气、称呼什么）',
          '- 明确给了要原样发出去的句子 → 用 say',
          '- 带"然后/顺便/同时"的多件事 → 拆成多个动作',
          '',
          '可选群（room 只能从这里选）：',
          groups,
          '',
          `把这句话翻译成动作，最多 ${max} 个。输出格式：{"actions":[...]}；不确定就输出 {"actions":[]}。`,
        ].join('\n'),
        // 带思考的模型会把预算花在思考上；解析器输出必须完整，预算可在面板里调
        maxTokens: Math.max(200, Number(config.adminPlanTokens) || 3000),
        temperature: 0.1,
        reasoningEffort: config.adminPlanReasoning || undefined,
      }
      let out
      try {
        out = await generate(req)
      } catch (e) {
        // 有的模型不认 low 档 → 退回默认档再来一次
        log('指令解析低推理档失败，回退默认：' + String(e?.message || e))
        out = await generate({ ...req, reasoningEffort: undefined })
      }
      const raw = String(out.text || '')
        .trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/, '')
        .trim()
      const m = /\{[\s\S]*\}/.exec(raw)
      if (!m) {
        log(`指令解析：没找到 JSON（finish=${out.finish?.kind || '?'}，原文 ${raw.slice(0, 120)}）`)
        return []
      }
      const j = JSON.parse(m[0])
      const list = Array.isArray(j?.actions) ? j.actions : []
      if (!list.length) log(`指令解析：模型给出空动作（finish=${out.finish?.kind || '?'}，原文 ${raw.slice(0, 160)}）`)
      return list
    } catch (e) {
      log('指令解析失败：' + String(e?.message || e))
      return []
    }
  }

  /** 模型给的动作只是"提案"：这里逐项校验，非法的一律丢掉。 */

  /** true = 这条私聊已被指令流程消费，不要再走正常回复。 */
  async function handleAdminCommand(r, trigger) {
    if (r.isGroup || !config.adminCommands) return false
    const adminId = String(r.roomId)
    if (!config.adminQQ.includes(adminId)) return false
    const text = String(trigger.text || '').trim()
    if (!text) return false

    if (pendingAdmin) {
      if (Date.now() > pendingAdmin.expiresAt) {
        pendingAdmin = null
        await replyAdmin(adminId, '那条指令超时作废了。')
        return true
      }
      if (CONFIRM_WORDS.test(text)) {
        const plan = pendingAdmin
        pendingAdmin = null
        const lines = []
        for (const a of plan.actions) lines.push(await executeAdminAction(a))
        await replyAdmin(adminId, lines.join('\n'))
        log(`管理员指令已执行：${plan.actions.map((a) => `${a.action}@${a.target.roomId}`).join('、')}`)
        return true
      }
      if (CANCEL_WORDS.test(text)) {
        pendingAdmin = null
        await replyAdmin(adminId, '好，已取消。')
        return true
      }
      pendingAdmin = null // 说了别的 → 当成新指令重新解析
    }

    // ① 确定性规则（快、不花 token）；带"然后/顺便/同时"的复合句直接交给模型拆
    let actions = []
    const compound = /(顺便|然后|同时|接着|之后|并且)/.test(text)
    const cmd = compound ? null : parseAdminCommand(text)
    if (cmd?.action === 'multi') {
      await replyAdmin(adminId, '这句话里像是同时让我做好几件事，一次说一件吧（先静音，再说别的）。')
      return true
    }
    if (cmd?.action) {
      if (!cmd.target) {
        await replyAdmin(adminId, '要操作哪个群？把群名或群号说清楚一点（例如「我的群」或 123456789）。')
        return true
      }
      actions = [cmd]
    } else if (config.adminNL) {
      // ② 规则没命中 → 让模型翻译成动作计划（只是提案，下面逐项校验）
      actions = normalizePlannedActions(await planAdminCommand(text))
    }
    if (!actions.length) return false

    const bad = actions.find((a) => !isAllowedGroup(a.target.roomId))
    if (bad) {
      await replyAdmin(adminId, `群「${bad.target.name || bad.target.roomId}」不在白名单里，不能操作。`)
      return true
    }

    const ttl = Number(config.adminConfirmTtlMs) || 120000
    pendingAdmin = { actions, expiresAt: Date.now() + ttl }
    log(`管理员指令待确认：${actions.map((a) => `${a.action}@${a.target.roomId}`).join('、')}`)
    const list = actions.map((a, i) => `${i + 1}. ${describeAdminAction(a)}`).join('\n')
    await replyAdmin(
      adminId,
      `【待确认】\n${list}\n\n回复「确认」执行；回复「取消」或说别的都会作废（${Math.round(ttl / 1000)} 秒内有效）。`,
    )
    return true
  }
  return { handleAdminCommand, executeAdminAction, planAdminCommand, replyAdmin }
}
