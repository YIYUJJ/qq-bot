/**
 * 配置类工具：qqbot_room_config / qqbot_admin_cmd。
 *
 * 依赖注入：
 *   room_config   resetRoomOverride / setRoomOverride / roomOverrideOf / cfgFor
 *   admin_cmd     parseAdminCommand / describeAdminAction / planAdminCommand / normalizePlannedActions / config
 */
export function configTools(deps) {
  const { resetRoomOverride, setRoomOverride, roomOverrideOf, cfgFor, parseAdminCommand, describeAdminAction, planAdminCommand, normalizePlannedActions, config, textOut } = deps

  return [
    {
      name: 'qqbot_room_config',
      description:
        '每群性格：查看/设置某个群的独立参数（人设、概率、冷却、延迟、安静时段、拆句、识图、联网、表情包、主动、拍一拍等）。只允许表达层参数，白名单/模型/接入地址不可按群覆盖。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号' },
          show: { type: 'boolean', description: 'true=只查看当前覆盖（默认行为，未传 patch 时）' },
          reset: { type: 'boolean', description: 'true=清空该群所有覆盖，恢复跟随全局' },
          patch: {
            type: 'object',
            description: '要覆盖的参数对象，如 {"persona":"...","replyProbability":0.6}；整份替换',
            additionalProperties: true,
          },
        },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room || '').replace(/^group:/, '').trim()
        if (!roomId) throw new Error('room 为空')
        if (args?.reset) {
          resetRoomOverride(roomId)
          return `群 ${roomId} 已恢复跟随全局`
        }
        if (args?.patch && typeof args.patch === 'object') {
          const r = setRoomOverride(roomId, args.patch)
          const lines = [
            `群 ${roomId} 已覆盖 ${r.count} 项：`,
            ...Object.entries(r.applied).map(([k, v]) => `  ${k} = ${Array.isArray(v) ? v.join(',') : String(v).slice(0, 80)}`),
          ]
          if (!r.ok) lines.push('被拒：' + JSON.stringify(r.rejected))
          return lines.join('\n')
        }
        const ov = roomOverrideOf(roomId)
        const eff = cfgFor(roomId)
        const keys = Object.keys(ov)
        return [
          `群 ${roomId}：${keys.length ? `自定义 ${keys.length} 项` : '跟随全局'}`,
          ...keys.map((k) => `  ${k} = ${Array.isArray(ov[k]) ? ov[k].join(',') : String(ov[k]).slice(0, 80)}`),
          `\n（实际生效的闲聊概率 ${eff.replyProbability}、延迟倍率 ${eff.delayScale}、人设 ${String(eff.persona).slice(0, 30)}…）`,
        ].join('\n')
      },
    },
    {
      name: 'qqbot_admin_cmd',
      description:
        '管理员遥控指令的解析预览（dry-run）：给它一句话，看会被识别成什么操作、目标哪个群。不会真的执行，也不会发确认。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '管理员会说的那句话' } },
        required: ['text'],
      },
      output: textOut,
      async execute(args) {
        const text = String(args?.text || '').trim()
        if (!text) throw new Error('text 为空')
        // 与真实处理器保持一致：带"然后/顺便/同时"的复合句交给模型拆
        const compound = /(顺便|然后|同时|接着|之后|并且)/.test(text)
        const cmd = compound ? null : parseAdminCommand(text)
        if (cmd?.action === 'multi') return '识别为多动作（会要求拆开说），不会执行'
        if (cmd?.action) {
          const target = cmd.target
          return [
            `规则命中：${cmd.action}`,
            `目标群：${target ? `${target.name || '(无名)'}（${target.roomId}）` : '❌ 没找到群'}`,
            target ? `确认后会：\n${describeAdminAction(cmd)}` : '需要把群名或群号说清楚',
          ].join('\n')
        }
        if (!config.adminNL) return '规则没命中（自然语言解析已关闭 adminNL=false）'
        const planned = await planAdminCommand(text)
        const norm = normalizePlannedActions(planned)
        if (!norm.length) {
          return `规则没命中，模型也没给出有效动作。\n原始输出：${JSON.stringify(planned).slice(0, 300)}`
        }
        return ['规则没命中 → 模型解析出：', ...norm.map((a, i) => `${i + 1}. ${describeAdminAction(a)}`)].join('\n')
      },
    },
  ]
}
