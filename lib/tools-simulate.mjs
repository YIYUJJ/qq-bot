/**
 * 调试注入工具：qqbot_simulate。
 *
 * 往指定会话注入一条"像真人发来的"消息，走完整的收消息→决策→回复流程。
 * 依赖注入：config / assertGroupAllowed / onEvent / textOut。
 */
export function simulateTools(deps) {
  const { config, assertGroupAllowed, onEvent, textOut } = deps

  return [
    {
      name: 'qqbot_simulate',
      description:
        '调试：往指定会话注入一条"像真人发来的"消息，走完整的收消息→决策→回复流程（会真的在群里说话）。用来测小游戏/提醒/撤回/链接/文档这些新功能。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号或 QQ 号' },
          text: { type: 'string', description: '消息内容' },
          sender: { type: 'string', description: '可选：发送者 QQ（默认管理员）' },
          fileUrl: { type: 'string', description: '可选：模拟一个文件（http 链接）' },
          imageUrl: { type: 'string', description: '可选：模拟一张图片（http 链接）' },
          fileName: { type: 'string', description: '可选：文件名，如 a.docx' },
          forwardId: { type: 'string', description: '可选：模拟一条合并转发（id）' },
        },
        required: ['room', 'text'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room || '').trim().replace(/^group:/, '')
        const text = String(args?.text || '')
        if (!roomId || !text) return '需要 room 和 text'
        const sender = String(args?.sender || config.adminQQ[0] || '10000')
        // 群号长度和 QQ 号一样，不能靠长度猜：先看白名单
        const isGroup = config.allowGroups.includes(roomId)
          ? true
          : config.allowPrivate.includes(roomId) || config.adminQQ.includes(roomId)
            ? false
            : roomId.length > 8
        if (isGroup) assertGroupAllowed(roomId)
        const hasImage = !!args?.imageUrl
        const ev = {
          id: 'sim-' + Date.now(),
          roomId,
          isGroup,
          sender,
          senderName: '测试',
          text: hasImage ? '[图片]' + text : text,
          isAtMe: false,
          images: hasImage ? 1 : 0,
          imageUrls: hasImage ? [String(args.imageUrl)] : [],
          imageKinds: hasImage ? ['image'] : [],
          imageSubTypes: hasImage ? [0] : [],
          files: args?.fileUrl ? [{ url: String(args.fileUrl), name: String(args.fileName || 'file.txt'), size: 0 }] : [],
          forwardId: args?.forwardId ? String(args.forwardId) : '',
          ts: Date.now(),
        }
        await onEvent(ev)
        return '已注入，等它按策略回（看日志或群里）'
      },
    },
  ]
}
