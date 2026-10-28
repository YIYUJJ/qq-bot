/**
 * 面板/底层自测工具：qqbot_panel / qqbot_selftest_ops。
 *
 * 两者都是诊断性质：panel 检查 /api/state 字段是否齐全，selftest_ops 逐项跑底层实现。
 * 依赖全部注入（这个模块故意不 import 插件内部状态）。
 */
export function panelTools(deps) {
  const {
    panelState,
    pickCanned,
    normText,
    detectTrigger,
    config,
    decide,
    selfcheck,
    usageView,
    isManagedRoom,
    memDirOf,
    addFact,
    factsOf,
    facts,
    rmSync,
    searchHistory,
    extractSearchQuery,
    sensitiveQuery,
    resolveVisionRoute,
    ob,
    stickers,
    tailLines,
    logFile,
    configKeys,
    applyConfigPatch,
    textOut,
  } = deps

  return [
    {
      name: 'qqbot_panel',
      description: '面板数据自检：检查 /qq-bot/api/state 的字段是否齐全（面板 JS 依赖这些键），返回计数而不是整包 JSON。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const s = panelState()
        const need = ['ok', 'at', 'version', 'config', 'defaults', 'meta', 'groups', 'features', 'stats', 'connection', 'health', 'usage', 'rooms', 'stickers', 'names', 'paths']
        const missing = need.filter((k) => !(k in s))
        return [
          missing.length ? '❌ 缺字段：' + missing.join(', ') : '✅ 字段齐全（' + need.length + ' 个）',
          `meta ${Object.keys(s.meta || {}).length} 项 / groups ${(s.groups || []).length} 组 / features ${(s.features || []).length} 个开关`,
          `rooms ${s.rooms.length} 个 / 表情包 ${s.stickers.count} 张 / 已知群 ${s.names.groups} 个`,
          `usage 累计 ${s.usage.total} token（${s.usage.calls} 次调用）｜健康 ${s.health ? (s.health.bad.length ? s.health.bad.length + ' 项异常' : '正常') : '未检查'}`,
          `面板页：GET /qq-bot｜接口：GET /qq-bot/api/state`,
        ].join('\n')
      },
    },
    {
      name: 'qqbot_selftest_ops',
      description:
        '逐项跑一遍面板与拟人功能的底层实现（自检、用量、记忆、历史检索、表情包、日志、导出、敷衍/防重复/优先级判定），只读或自带清理，不会往群里发消息。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const out = []
        const T = (name, fn) => {
          try {
            out.push(`✅ ${name}：${fn()}`)
          } catch (e) {
            out.push(`❌ ${name}：${String(e?.message || e)}`)
          }
        }
        const TA = async (name, fn) => {
          try {
            out.push(`✅ ${name}：${await fn()}`)
          } catch (e) {
            out.push(`❌ ${name}：${String(e?.message || e)}`)
          }
        }

        // 纯逻辑
        T('敷衍短句', () => [pickCanned('ambient'), pickCanned('at')].filter(Boolean).join(' / ') || '（空）')
        T('文本归一', () => normText('哈哈，[表情] 真的吗？！'))
        T('优先级', () =>
          [
            detectTrigger({ isAtMe: true, text: 'x' }, { aliases: config.aliases }),
            detectTrigger({ isAtMe: false, text: '大肥鱼在吗' }, { aliases: config.aliases }),
            detectTrigger({ isAtMe: false, text: '今天吃什么' }, { aliases: config.aliases }),
          ].join(' / '))
        T('防重复判定', () => {
          const now = Date.now()
          // 长句（≥6 字）刚回过 → 应该拦；短句（"哈哈"）允许重复，这是有意放行的
          const fake = { replyTimes: [], lastReplyAt: 0, repliedTexts: [{ norm: normText('这句话刚刚说过了'), at: now }] }
          const hit = decide(fake, { priority: 'ambient', quiet: false, now, text: '这句话刚刚说过了！' })
          const short = decide(fake, { priority: 'ambient', quiet: false, now, text: '哈哈！' })
          const miss = decide(fake, { priority: 'ambient', quiet: false, now, text: '别的话' })
          return `长句重复 → ${hit.reason}｜短句重复 → ${short.reason}｜新句子 → ${miss.reason}`
        })

        // 自检
        await TA('自检', async () => {
          const h = await selfcheck()
          return `${h.items.length} 项，异常 ${h.bad.length}，提醒 ${h.warn.length}` + (h.bad.length ? `（${h.bad.join('、')}）` : '')
        })

        // 用量
        T('用量统计', () => `${usageView().total} token / ${usageView().calls} 次调用`)

        // 记忆：写一条再删掉
        await TA('长期记忆', async () => {
          const key = '__selftest__'
          const temporary = !isManagedRoom(key)
          if (temporary) config.memoryRooms.push(key)
          const dir = memDirOf(key)
          let added = false
          let listed = 0
          try {
            added = addFact(key, '自检写入')
            listed = factsOf(key).length
          } finally {
            delete facts[key]
            if (temporary) config.memoryRooms = config.memoryRooms.filter((x) => x !== key)
            if (dir) {
              try {
                rmSync(dir, { recursive: true, force: true })
              } catch {
                /* ignore */
              }
            }
          }
          return `写入 ${added ? '成功' : '去重'}，读取 ${listed} 条，已清理目录`
        })

        // 历史检索（走真实 OneBot 接口）
        await TA('历史检索', async () => {
          const room = config.allowGroups[0]
          if (!room) return '没有白名单群，跳过'
          const hits1 = await searchHistory(room, '你刚才说的回复', 3)
          const hits2 = await searchHistory(room, '尾巴怎么摆', 3)
          return `群 ${room}：关键词「回复」命中 ${hits1.length} 条，「尾巴」命中 ${hits2.length} 条`
        })

        // 搜索意图
        T('搜索意图', () =>
          [
            extractSearchQuery('你去搜一下 DeepSeek 最新模型'),
            extractSearchQuery('帮我查查上海天气'),
            extractSearchQuery('@我 看一下包河区天气'),
            extractSearchQuery('今天吃什么'),
          ]
            .map((x) => x || '(不搜)')
            .join(' ｜ '))
        T('隐私拦截', () =>
          [sensitiveQuery('查一下 123456789') || '放行', sensitiveQuery('查一下 https://a.com') || '放行', sensitiveQuery('查一下 deepseek') || '放行'].join(' ｜ '))

        await TA('视觉路由', async () => {
          const r = await resolveVisionRoute()
          return `${r.provider}/${r.model}`
        })
        T('拍一拍配置', () =>
          `被拍当叫我=${config.pokeOnMe ? '开' : '关'}｜拍回去=${config.pokeBack ? Math.round(config.pokeChance * 100) + '%' : '关'}｜回复时顺拍=${Math.round(Number(config.pokeOnReply) * 100)}%`)

        await TA('群成员', async () => {
          const room = config.allowGroups[0]
          if (!room) return '没有白名单群，跳过'
          const list = await ob.groupMembers(room)
          const withCard = list.filter((m) => m.card).length
          return `${list.length} 人（${withCard} 人有群名片）`
        })

        // 表情包
        T('表情包库', () => {
          const keys = Object.keys(stickers)
          return keys.length ? `${keys.length} 张，例：${stickers[keys[0]].url.slice(0, 60)}` : '空（群里还没人发图）'
        })

        // 日志
        T('日志读取', () => {
          const t = tailLines(logFile, 3)
          return t ? `${t.split('\n').length} 行，最后一行 ${t.split('\n').pop().slice(0, 60)}` : '空'
        })

        // 导出
        T('配置导出', () => {
          const dump = {}
          for (const k of configKeys) dump[k] = config[k]
          return `${Object.keys(dump).length} 个键`
        })

        // 导入（把当前值原样贴回去，验证校验器不误伤）
        T('配置导入', () => {
          const patch = {}
          for (const k of configKeys) patch[k] = config[k]
          const r = applyConfigPatch(patch)
          return r.ok ? `${Object.keys(r.applied).length} 个键通过校验` : `被拒：${JSON.stringify(r.rejected)}`
        })

        return ['== 面板/功能底层自测 ==', ...out].join('\n')
      },
    },
  ]
}
