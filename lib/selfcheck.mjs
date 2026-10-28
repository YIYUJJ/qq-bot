/**
 * 自检：WS/HTTP/白名单/收消息通路/模型路由/日志可写。
 *
 * 抽出时顺便把 healthCache 从"隐式全局"改成显式状态读取（getHealth/setHealth），
 * 面板拿到的健康数据只有这一条写路径。
 */
import { appendFileSync } from 'node:fs'

export const SELFCHECK_DEPS = ['ob', 'config', 'groupNames', 'resolveModel', 'getLlm', 'logFile', 'getHealth', 'setHealth']

export function createSelfcheck(deps) {
  const missing = SELFCHECK_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('自检缺少依赖：' + missing.join(', '))
  const { ob, config, groupNames, resolveModel, getLlm, logFile, getHealth, setHealth } = deps

  async function selfcheck() {
    const items = []
    const push = (name, level, text, advice) =>
      items.push({ name, level, text, ...(advice ? { advice } : {}) })
    const st = ob.status
    push(
      'WS 连接',
      st.connected ? 'ok' : 'bad',
      st.connected ? `已连接（重连 ${st.reconnects} 次）` : st.lastError || '未连接',
      st.connected ? '' : '确认 SnowLuma 在跑；换账号后 token 会变，插件会自动重新发现',
    )
    try {
      const h = await ob.health()
      push('HTTP 动作', h.http ? 'ok' : 'bad', h.http ? 'get_login_info 正常' : h.error || '不可用', h.http ? '' : '确认 OneBot HTTP 端口和 token')
      if (h.self) {
        const same = String(h.self.user_id) === String(st.self?.user_id ?? '')
        push('账号一致', same ? 'ok' : 'warn', `${h.self.nickname}（${h.self.user_id}）`, same ? '' : 'HTTP 与 WS 可能指向不同账号')
      }
    } catch (e) {
      push('HTTP 动作', 'bad', String(e?.message || e))
    }
    push(
      '白名单群',
      config.allowGroups.length ? 'ok' : 'warn',
      config.allowGroups.map((g) => `${groupNames.get(String(g)) || '未知群'}（${g}）`).join('、') || '未配置',
      config.allowGroups.length ? '' : '没有白名单群，机器人谁都不回',
    )
    push(
      '收消息通路',
      config.pollMs > 0 || st.connected ? 'ok' : 'bad',
      config.pollMs > 0 ? `WS + 轮询 ${config.pollMs}ms` : '只靠 WS 推送',
      config.pollMs > 0 ? '' : '本机实测 WS 不推群消息，建议把轮询打开',
    )
    try {
      const m = resolveModel()
      let level = 'ok'
      let text = `${m.provider}/${m.model}`
      let advice = ''
      // 配置留空 = 用 DSH 默认模型：默认 provider 没登录时会让所有回复变成空（踩过一次）
      if (!config.provider || !config.model) {
        level = 'warn'
        text += '（用的是 DSH 默认模型）'
        advice = '建议在「人设与模型」里显式填 provider/model；默认模型不可用时所有回复都会是空的'
      }
      try {
        const llm = getLlm()
        if (llm?.listModels) {
          const models = (await llm.listModels(m.provider)) || []
          if (!models.length) {
            level = 'bad'
            text += '｜该 provider 当前没有可用模型'
            advice = '去 DSH 设置里登录这个 provider，或换成有模型的 provider/model'
          } else if (!models.some((x) => String(x.id) === String(m.model))) {
            level = 'bad'
            text += `｜${m.model} 不在该 provider 的模型列表里`
            advice = '可用模型：' + models.slice(0, 6).map((x) => x.id).join(', ')
          }
        }
      } catch (e) {
        if (level === 'ok') level = 'warn'
        text += '｜无法校验模型列表：' + String(e?.message || e).slice(0, 60)
      }
      push('模型路由', level, text, advice)
    } catch (e) {
      push('模型路由', 'bad', String(e?.message || e), '在「人设与模型」里填 provider/model')
    }
    try {
      appendFileSync(logFile, '')
      push('日志可写', 'ok', logFile)
    } catch (e) {
      push('日志可写', 'bad', String(e?.message || e))
    }
    const health = {
      at: Date.now(),
      items,
      bad: items.filter((i) => i.level === 'bad').map((i) => i.name),
      warn: items.filter((i) => i.level === 'warn').map((i) => i.name),
    }
    setHealth(health)
    return health
  }

  return selfcheck
}
