/**
 * 图库维护工具：qqbot_sticker_del / qqbot_sticker_sweep。
 *
 * 依赖注入：stickers / writeJson / stickersFile / markStickersDirty / log /
 *           rmSync / existsSync / sweepStickerLibrary / stickerDir / textOut。
 */
export function stickerTools(deps) {
  const { stickers, writeJson, stickersFile, markStickersDirty, log, rmSync, existsSync, sweepStickerLibrary, stickerDir, textOut } = deps

  return [
    {
      name: 'qqbot_sticker_del',
      description: '删除图库里的一张或一批表情。id 指定单张；what=bad 删失效；what=image 删普通图片（subType<1）。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要删除的表情 id（面板表情库里显示的编号）' },
          what: { type: 'string', enum: ['bad', 'image'], description: '批量删除：bad=失效，image=普通图片' },
        },
      },
      output: textOut,
      async execute(args) {
        const id = String(args?.id || '')
        const what = String(args?.what || '')
        if (id) {
          const st = stickers[id]
          if (!st) return '图库里没有这张：' + id
          try {
            if (st.file) rmSync(st.file, { force: true })
          } catch {
            /* ignore */
          }
          delete stickers[id]
          try {
            writeJson(stickersFile, stickers)
          } catch {
            /* ignore */
          }
          markStickersDirty()
          log('图库删除：' + id)
          return '已删除 ' + id + '，剩 ' + Object.keys(stickers).length + ' 张'
        }
        if (what === 'bad' || what === 'image') {
          let removed = 0
          for (const [k, st] of Object.entries(stickers)) {
            const hit = what === 'image' ? Number(st.subType || 0) < 1 : !!st.bad
            if (!hit) continue
            try {
              if (st.file) rmSync(st.file, { force: true })
            } catch {
              /* ignore */
            }
            delete stickers[k]
            removed++
          }
          try {
            writeJson(stickersFile, stickers)
          } catch {
            /* ignore */
          }
          markStickersDirty()
          log('图库批量清理：' + what + ' 删除 ' + removed + ' 张')
          return '已删除 ' + removed + ' 张，剩 ' + Object.keys(stickers).length + ' 张'
        }
        return '要么给 id（单张），要么给 what=bad|image（批量）'
      },
    },
    {
      name: 'qqbot_sticker_sweep',
      description: '图库维护：把还没存到本地的表情图重新下载并本地化，过期的标记作废。返回可用/失效数量。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const before = Object.keys(stickers).length
        const badBefore = Object.keys(stickers).filter((k) => stickers[k].bad).length
        await sweepStickerLibrary()
        const badAfter = Object.keys(stickers).filter((k) => stickers[k].bad).length
        const withFile = Object.keys(stickers).filter((k) => stickers[k].file && existsSync(stickers[k].file)).length
        return [
          `图库共 ${before} 张，本地可用 ${withFile} 张`,
          `失效 ${badBefore} → ${badAfter}（本次新标记 ${badAfter - badBefore} 张）`,
          `目录：${stickerDir}`,
        ].join('\n')
      },
    },
  ]
}
