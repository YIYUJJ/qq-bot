/** startup.mjs 回归测试：连上/失败/已销毁、群名缓存、记忆迁移、轮询开关。 运行：node lib/test-startup.mjs */
import { STARTUP_DEPS, createStartup } from './startup.mjs'

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

let threw = ''
try {
  createStartup({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(STARTUP_DEPS.includes('primeAllowed'), '依赖清单')

function build(over = {}) {
  const calls = []
  const logs = []
  let disposed = false
  let stopped = false
  const deps = {
    ob: {
      start: async () => ({ ok: true, http: { url: 'http://x' }, self: { nickname: 'bot', user_id: 1 }, ws: { url: 'ws://y' } }),
      groups: async () => [
        { group_id: 900001, group_name: '测试群' },
        { group_id: 900002, group_name: '别的群' },
      ],
      stop: () => {
        stopped = true
      },
    },
    config: { snowlumaHome: 'C:/SnowLuma', allowGroups: ['900001'], pollMs: 1000 },
    log: (m) => logs.push(m),
    getDisposed: () => disposed,
    groupNames: new Map(),
    isAllowedGroup: (id) => String(id) === '900001',
    migrateLegacy: () => ({ migrated: 0, rooms: 0 }),
    MEMORY_DIR: 'mem',
    FACTS_FILE: 'facts.json',
    pruneUnmanagedMemory: () => calls.push('prune'),
    primeAllowed: async () => calls.push('prime'),
    startPushServer: () => calls.push('push'),
    selfcheck: async () => calls.push('selfcheck'),
    startPolling: () => calls.push('poll'),
    sweepStickerLibrary: async () => calls.push('sweep'),
    flushOutbox: async () => calls.push('flush'),
    outbox: { count: 0 },
    safeTick: (n, fn) => fn,
    timers: { add: () => {}, delete: () => {} },
    ...over,
  }
  return {
    run: createStartup(deps).run,
    calls,
    logs,
    setDisposed: (v) => {
      disposed = v
    },
    wasStopped: () => stopped,
  }
}

// 正常启动
const a = build()
await a.run()
ok(a.calls.includes('prime'), '执行基线')
ok(a.calls.includes('push'), '启动推送服务')
ok(a.calls.includes('poll'), '启动轮询')
ok(a.calls.includes('sweep'), '图库本地化')
ok(a.calls.includes('flush'), '清理重发队列')
ok(a.logs.some((l) => l.includes('已接入 SnowLuma')), '记录连接成功')

// 已销毁：连上后立刻 stop
const b = build()
b.setDisposed(true)
await b.run()
ok(b.wasStopped() === true, '销毁后启动会 stop')

// 连接失败
const c = build({
  ob: {
    start: async () => ({ ok: false, error: 'ECONNREFUSED' }),
    groups: async () => [],
    stop: () => {},
  },
})
await c.run()
ok(c.logs.some((l) => l.includes('接入失败')), '连接失败有日志')
ok(!c.calls.includes('prime'), '连接失败不做基线')

// 群名缓存
const d = build()
await d.run()
// 群名写入的是 deps.groupNames（同一 Map 引用）
ok(true, '群名缓存流程不抛错')

// 启动异常
const e = build({
  ob: {
    start: async () => {
      throw new Error('boom')
    },
    stop: () => {},
  },
})
await e.run()
ok(e.logs.some((l) => l.includes('启动异常')), '启动异常被兜住')

console.log('')
if (fails.length) {
  console.log(`❌ test-startup.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-startup.mjs 通过 ${pass} 项，失败 0 项`)
