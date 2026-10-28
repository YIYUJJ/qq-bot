/**
 * 杂项工具：qqbot_send_sticker / qqbot_backup。
 *
 * 依赖注入：assertGroupAllowed / stickers / config / sendStickerTo /
 *           backupTick / readJson / backupStateFile / backupNow / backupRestore / backupList / textOut。
 */
export function miscTools(deps) {
  const { assertGroupAllowed, stickers, config, sendStickerTo, backupTick, readJson, backupStateFile, backupNow, backupRestore, backupList, textOut } = deps

  return [
    {
      name: 'qqbot_send_sticker',
      description: '从图库挑一张（或指定 id）发到白名单群，用来验证图片段是否可用。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号（必须在白名单）' },
          id: { type: 'string', description: '可选：图库里的 id；留空则随机' },
        },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room ?? '').trim().replace(/^group:/, '')
        assertGroupAllowed(roomId)
        const keys = Object.keys(stickers).filter((k) => !stickers[k].bad)
        if (!keys.length) throw new Error('图库是空的（或条目都已失效）：群里有人发图/表情后才会收进来')
        const key = args?.id ? String(args.id) : keys[Math.floor(Math.random() * keys.length)]
        const s = stickers[key]
        if (!s) throw new Error('图库里没有这个 id：' + key)
        if (s.bad) throw new Error('这张已失效，换一张吧')
        if (config.dryRun) return `[演练] 未发送：${s.url}`
        const res = await sendStickerTo(roomId, s, key)
        if (!res.ok) throw new Error(res.error)
        if (res.queued) return `网络抖动，已排入重发队列：${key}（${res.error}）`
        return `已发到 ${roomId}：${key}（累计用 ${s.uses} 次）\n${s.url}`
      },
    },
    {
      name: 'qqbot_backup',
      description: '备份与恢复：now 立即备份配置和记忆；list 看备份；restore 恢复指定备份（恢复后自动重载）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'now | auto | list | restore' },
          name: { type: 'string', description: 'restore 时的备份名' },
        },
        required: ['action'],
      },
      output: textOut,
      async execute(args) {
        const action = String(args?.action || 'list')
        try {
          if (action === 'auto') {
            backupTick()
            const state = readJson(backupStateFile, {})
            return '已检查：' + (state.lastDay ? '今天已备份（' + state.name + '）' : '还没到点或今天没备份')
          }
          if (action === 'now') {
            const r = backupNow()
            return '已备份：' + r.name + '（' + r.items + ' 项）'
          }
          if (action === 'restore') {
            const r = backupRestore(String(args?.name || ''))
            return '已恢复 ' + r.restored + ' 项：' + r.name + '（配置与记忆已重新加载）'
          }
          const names = backupList()
          return names.length ? names.join('\n') : '还没有备份'
        } catch (e) {
          return '失败：' + String(e?.message || e)
        }
      },
    },
  ]
}
