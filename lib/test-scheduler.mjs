/** scheduler.mjs 回归测试：inHours、prouds 主动说话门控、轮询定时器增删。 运行：node lib/test-scheduler.mjs */
import { SCHEDULER_DEPS, createScheduler } from './scheduler.mjs'

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
  createScheduler({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(SCHEDULER_DEPS.includes('pollOnce'), '依赖清单')

function build(over = {}) {
  const timers = new Set()
  const sent = []
  const deps = {
    config: { enabled: true, pollMs: 1000, allowGroups: ['900001'] },
    rooms: new Map(),
    cfgFor: () => ({ proactive: true, proactiveChance: 1, proactiveIdleMs: 0, proactiveMinGapMs: 0, proactiveHours: '00:00-23:59', maxRepliesPer10Min: 200, quietHours: '', humanize: false }),
    allowedHere: () => true,
    isQuiet: () => false,
    quietWindowsFor: () => [],
    generate: async () => ({ text: '自言自语一句' }),
    systemPrompt: () => '人设',
    buildTranscript: () => '历史',
    humanizeText: (t) => t,
    sendReply: async (r, opts) => {
      sent.push(opts.text)
      return [opts.text]
    },
    log: () => {},
    safeTick: (name, fn) => fn,
    timers: {
      add: (t) => timers.add(t),
      delete: (t) => timers.delete(t),
    },
    pollOnce: () => {},
    privateTargets: () => [],
    ...over,
  }
  return { api: createScheduler(deps), timers, sent, deps }
}

// inHours
const a = build()
ok(a.api.inHours('', new Date()) === true, '空时段=全天')
ok(a.api.inHours('00:00-23:59', new Date()) === true, '全时段命中')
ok(a.api.inHours('bad-format', new Date()) === true, '格式错误视为全天')

// 主动说话：满足条件 → 发一句
const room = { roomId: '900001', roomName: '测试群', isGroup: true, flushing: false, replyTimes: [], lastActivityAt: Date.now() - 3600000, lastProactiveAt: 0, msgs: [] }
const b = build()
b.deps.rooms.set('900001', room)
b.api.proactiveTick()
await new Promise((r) => setTimeout(r, 50))
ok(b.sent.length === 1, '满足条件时主动说话')
ok(room.lastProactiveAt > 0, '记录主动时间')

// 关闭启用：不说话
const c = build()
c.deps.config.enabled = false
c.deps.rooms.set('900001', { ...room, flushing: false })
c.api.proactiveTick()
await new Promise((r) => setTimeout(r, 30))
ok(c.sent.length === 0, '插件停用时不主动说话')

// 安静时段：不说话
const d = build({ isQuiet: () => true })
d.deps.rooms.set('900001', { ...room, flushing: false })
d.api.proactiveTick()
await new Promise((r) => setTimeout(r, 30))
ok(d.sent.length === 0, '安静时段不主动说话')

// 最近有活动：不说话（proactiveIdleMs 很大）
const e = build({ cfgFor: () => ({ proactive: true, proactiveChance: 1, proactiveIdleMs: 3600000, proactiveMinGapMs: 0, proactiveHours: '', maxRepliesPer10Min: 200, humanize: false }) })
e.deps.rooms.set('900001', { ...room, lastActivityAt: Date.now() - 1000 })
e.api.proactiveTick()
await new Promise((r) => setTimeout(r, 30))
ok(e.sent.length === 0, '刚有人说话时不主动插话')

// 轮询定时器：开启后 add，stop 后 delete
const f = build()
f.api.startPolling()
ok(f.timers.size === 1, 'startPolling 建定时器')
f.api.stopPolling()
ok(f.timers.size === 0, 'stopPolling 清理定时器')

// pollMs=0：不建定时器
const g = build({ config: { enabled: true, pollMs: 0, allowGroups: ['900001'] } })
g.api.startPolling()
ok(g.timers.size === 0, 'pollMs=0 不建定时器')

console.log('')
if (fails.length) {
  console.log(`❌ test-scheduler.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-scheduler.mjs 通过 ${pass} 项，失败 0 项`)
