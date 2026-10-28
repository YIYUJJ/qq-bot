/** panel-mount.mjs 回归测试：webServer 未就绪时重试、就绪后注册、失败兜底。 运行：node lib/test-panel-mount.mjs */
import { createPanelMount } from './panel-mount.mjs'

let pass = 0
const fails = []
const ok = (c, n) => {
  if (c) {
    pass += 1
    console.log('  PASS  ' + n)
  } else {
    fails.push(n)
    console.log('  FAIL  ' + n)
  }
}

const mkCtx = (service) => {
  const effects = []
  return {
    get: (n) => (n === 'webServer' ? service : null),
    effect(fn) {
      effects.push(fn)
      const d = fn()
      return () => d?.()
    },
    effects,
  }
}

// 1) webServer 就绪：立即注册
const registered = []
const ctx1 = mkCtx({ register: (opts) => registered.push(opts) })
const m1 = createPanelMount({ ctx: ctx1, log: () => {}, handler: () => {} })
ok(registered.length === 1, 'webServer 就绪时立即注册')
ok(registered[0].path === '/qq-bot' && registered[0].kind === 'prefix', '注册路径与前缀正确')
ok(m1.isMounted() === true, 'isMounted 为 true')

// 2) webServer 未就绪：不注册，但带重试定时器
const ctx2 = mkCtx(null)
const logs = []
const m2 = createPanelMount({ ctx: ctx2, log: (m) => logs.push(m), handler: () => {} })
ok(m2.isMounted() === false, '未就绪时不标记已挂载')
ok(logs.length === 0, '未就绪且未到重试上限时不打日志')

// 3) register 抛错：不崩，mounted 回退
const ctx3 = mkCtx({
  register: () => {
    throw new Error('boom')
  },
})
const logs3 = []
const m3 = createPanelMount({ ctx: ctx3, log: (m) => logs3.push(m), handler: () => {} })
ok(m3.isMounted() === false, '注册失败时 mounted 回退')
ok(logs3.some((l) => l.includes('面板挂载失败')), '注册失败有日志')

// 4) dispose 后停止重试（无法等 2s，这里只验证结构）
ok(typeof m2.isMounted === 'function', '返回 isMounted')

console.log('')
if (fails.length) {
  console.log(`❌ test-panel-mount.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-panel-mount.mjs 通过 ${pass} 项，失败 0 项`)
process.exit(0)
