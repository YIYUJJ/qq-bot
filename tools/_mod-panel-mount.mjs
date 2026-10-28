import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const L = readFileSync(p, 'utf8').split(/\r?\n/)

// 1) 抓 createApiHandler 调用文本
const hStart = L.findIndex((l) => l.includes('const handleRequest = createApiHandler({'))
if (hStart < 0) throw new Error('找不到 createApiHandler 调用')
let depth = 0
let hEnd = -1
for (let i = hStart; i < L.length && hEnd < 0; i++) {
  for (const ch of L[i]) {
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) {
        hEnd = i
        break
      }
    }
  }
}
const handlerCall = L.slice(hStart, hEnd + 1)

// 2) 定位要删除的块：panelDisposed 起，到 IIFE 的 })() 结束
const blockStart = L.findIndex((l) => l.trim() === 'let panelDisposed = false')
if (blockStart < 0) throw new Error('找不到 panelDisposed')
const iifeEnd = L.findIndex((l, i) => i > blockStart && l.trim() === '})()')
if (iifeEnd < 0) throw new Error('找不到 IIFE 结束')

const replacement = [
  ...handlerCall.map((l) => l.replace(/^\s{0,4}/, '  ')),
  '',
  '  // 面板挂载（webServer 注册 + 重试）交给 lib/panel-mount.mjs',
  '  createPanelMount({ ctx, log, handler: handleRequest })',
  '',
]
L.splice(blockStart, iifeEnd - blockStart + 1, ...replacement)
writeFileSync(p, L.join('\n'), 'utf8')

// 3) 生成模块
const mod = `/**
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
`
writeFileSync('lib/panel-mount.mjs', mod, 'utf8')

let s = readFileSync(p, 'utf8')
if (!s.includes("from './panel-mount.mjs'")) {
  const a = s.indexOf("import { createModel } from './model.mjs'")
  const i = s.indexOf('\n', a) + 1
  s = s.slice(0, i) + "import { createPanelMount } from './panel-mount.mjs'\n" + s.slice(i)
  writeFileSync(p, s, 'utf8')
}
console.log('panel-mount 抽取完成')
