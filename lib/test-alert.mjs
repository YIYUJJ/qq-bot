/** alert.mjs 回归测试：阈值、冷却、无管理员、reset。 运行：node lib/test-alert.mjs */
import { ALERT_DEPS, createAlert } from './alert.mjs'

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
  createAlert({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(ALERT_DEPS.includes('getOb'), '依赖清单')

function build(over = {}) {
  const sent = []
  const logs = []
  let t = 1000
  const deps = {
    config: { adminQQ: ['2237116031'] },
    getOb: () => ({ sendPrivate: async (to, text) => sent.push({ to, text }) }),
    log: (m) => logs.push(m),
    ...over,
  }
  const api = createAlert(deps, { windowMs: 60000, threshold: 3, cooldownMs: 60000, now: () => t })
  return { api, sent, logs, tick: (ms) => (t += ms) }
}

// 达到阈值才发
const a = build()
ok(a.api.record('回复', new Error('boom')) === false, '第 1 次不发')
ok(a.api.record('回复', new Error('boom')) === false, '第 2 次不发')
ok(a.api.record('回复', new Error('boom')) === true, '第 3 次触发告警')
await new Promise((r) => setTimeout(r, 30))
ok(a.sent.length === 1 && a.sent[0].to === '2237116031', '私聊发给管理员')
ok(a.sent[0].text.includes('连续失败 3 次'), '告警文案包含次数')
ok(a.sent[0].text.includes('boom'), '告警文案包含错误信息')

// 冷却期内不重复发
ok(a.api.record('回复', new Error('boom')) === false, '冷却期内不发')
ok(a.sent.length === 1, '仍然只有一条')

// 冷却过后再发
a.tick(61000)
ok(a.api.record('回复', new Error('boom')) === false, '冷却后第 1 次只是重新攒')
ok(a.api.record('回复', new Error('boom')) === false, '第 2 次仍不发')
ok(a.api.record('回复', new Error('boom')) === true, '冷却过后重新攒满 3 次会再发')

// 没有管理员：不发
const b = build({ config: { adminQQ: [] } })
b.api.record('启动', new Error('x'))
b.api.record('启动', new Error('x'))
ok(b.api.record('启动', new Error('x')) === false, '没有管理员时不发')
ok(b.sent.length === 0, '确实没发')

// 窗口外的旧失败会过期
const c = build()
c.api.record('回复', new Error('old'))
c.tick(70000)
ok(c.api.record('回复', new Error('x')) === false, '窗口外的旧失败不算')
ok(c.api.count === 1, '只保留窗口内记录')

// reset 清零
c.api.reset()
ok(c.api.count === 0, 'reset 清空')

// 发送失败只记日志、不抛错
const d = build({ getOb: () => ({ sendPrivate: async () => { throw new Error('net down') } }) })
d.api.record('x', new Error('a'))
d.api.record('x', new Error('b'))
d.api.record('x', new Error('c'))
await new Promise((r) => setTimeout(r, 30))
ok(d.logs.some((l) => l.includes('告警发送失败')), '发送失败有日志')

console.log('')
if (fails.length) {
  console.log(`❌ test-alert.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-alert.mjs 通过 ${pass} 项，失败 0 项`)
