/**
 * 面板挂载：把 /qq-bot 前缀注册到 DSH 的 webServer 上。
 *
 * webServer 可能比插件晚就绪，所以这里带重试（最多 60 次 × 2s），
 * 插件被卸载后通过 ctx.effect 的清理函数停止重试。
 */
export function createPanelMount({ ctx, log, handler }) {
  let panelDisposed = false
  ctx.effect(() => () => {
    panelDisposed = true
  })

  const getService = (n) => {
    try {
      return (typeof ctx.get === 'function' ? ctx.get(n) : null) ?? ctx[n] ?? null
    } catch {
      return null
    }
  }

  let mounted = false
  let tries = 0
  const mount = () => {
    if (panelDisposed || mounted) return
    const ws = getService('webServer')
    if (!ws || typeof ws.register !== 'function') {
      if (++tries <= 60) {
        const t = setTimeout(mount, 2000)
        if (t.unref) t.unref()
        return
      }
      log('没有 webServer 服务，面板跳过（机器人本体不受影响）')
      return
    }
    mounted = true
    try {
      ctx.effect(
        () => ws.register({ kind: 'prefix', path: '/qq-bot', handler }),
        'dsh-qq-bot: panel route',
      )
      log('面板已挂载：/qq-bot')
    } catch (e) {
      mounted = false
      log('面板挂载失败：' + String(e?.message || e))
    }
  }

  mount()
  return { isMounted: () => mounted }
}
