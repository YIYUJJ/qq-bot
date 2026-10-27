/**
 * 重试队列回归测试：注入假发送器 + 假时钟，把退避、放弃、持久化全跑一遍。
 * 运行：node lib/test-outbox.mjs
 */
import { Outbox, shouldRetrySend } from './outbox.mjs'

let pass = 0
const fails = []
const ok = (cond, name) => {
  if (cond) {
    pass += 1
    console.log('  PASS  ' + name)
  } else {
    fails.push(name)
    console.log('  FAIL  ' + name)
  }
}

// 假时钟：手动推进
let clock = 1_700_000_000_000
const now = () => clock

function makeBox({ deliver, items = [], maxItems = 50 } = {}) {
  let saved = items
  const logs = []
  const box = new Outbox({
    load: () => saved,
    save: (x) => {
      saved = JSON.parse(JSON.stringify(x))
    },
    deliver,
    log: (m) => logs.push(m),
    now,
    maxItems,
  })
  return { box, logs, saved: () => saved }
}

console.log('== 重试队列 ==')

// 1) 网络错误 → 入队、退避、仍在队列
{
  let calls = 0
  const { box } = makeBox({
    deliver: async () => {
      calls += 1
      throw new Error('fetch failed')
    },
  })
  box.enqueue({ roomId: '1', isGroup: true, kind: 'text', payload: 'a', error: 'fetch failed' })
  ok(box.count === 1, '入队后队列里有 1 条')
  const r0 = await box.flush()
  ok(r0.failed === 0 && calls === 0, '刚入队不会立刻重试（先等一个退避间隔）')
  clock += 5000
  const r1 = await box.flush()
  ok(r1.failed === 1 && calls === 1, '到点后第一次重发失败')
  ok(box.items[0].attempts === 1, 'attempts 记到 1')
  ok(box.items[0].nextAt === clock + 10000, '第二次退避 10s')
  ok(box.count === 1, '失败后仍留在队列')
}

// 2) 到点后成功 → 出队
{
  let calls = 0
  const { box } = makeBox({
    deliver: async () => {
      calls += 1
      if (calls < 2) throw new Error('ETIMEDOUT')
    },
  })
  box.enqueue({ roomId: '2', isGroup: true, kind: 'text', payload: 'b', error: 'ETIMEDOUT' })
  clock += 5000
  await box.flush() // 第一次失败
  clock += 10_000
  const r2 = await box.flush() // 第二次成功
  ok(r2.sent === 1 && box.count === 0, '到点重发成功后出队')
}

// 3) 永久失败（被踢出群）→ 立刻丢弃，不重试
{
  let calls = 0
  const { box } = boxWith()
  function boxWith() {
    return makeBox({
      deliver: async () => {
        calls += 1
        throw new Error('发送失败，你已被移出该群，请重新加群')
      },
    })
  }
  box.enqueue({ roomId: '3', isGroup: true, kind: 'text', payload: 'c', error: '被移出' })
  clock += 5000
  const r3 = await box.flush()
  ok(r3.dropped === 1 && box.count === 0 && calls === 1, '永久失败只试一次就丢弃')
}

// 4) 连续失败到上限 → 丢弃
{
  let calls = 0
  const { box } = makeBox({
    deliver: async () => {
      calls += 1
      throw new Error('HTTP 502 Bad Gateway')
    },
  })
  box.enqueue({ roomId: '4', isGroup: true, kind: 'text', payload: 'd', error: 'HTTP 502' })
  clock += 5000
  for (let i = 0; i < 6; i++) {
    await box.flush()
    clock += 10 * 60_000 // 每次都推进到远超退避
  }
  ok(box.count === 0, '达到次数上限后丢弃')
  ok(calls <= 5, `最多尝试 5 次（实际 ${calls}）`)
}

// 5) 超过 10 分钟时效 → 丢弃
{
  const { box } = makeBox({ deliver: async () => {} })
  box.enqueue({ roomId: '5', isGroup: true, kind: 'text', payload: 'e', error: 'x' })
  clock += 11 * 60_000
  const r5 = await box.flush()
  ok(r5.dropped === 1 && box.count === 0, '超过 10 分钟直接丢弃')
}

// 6) 持久化：保存的内容能被新实例读回
{
  const { box, saved } = makeBox({ deliver: async () => {} })
  box.enqueue({ roomId: '6', isGroup: true, kind: 'text', payload: '持久化', error: 'boom' })
  const snap = saved()
  const { box: box2 } = makeBox({ deliver: async () => {}, items: snap })
  ok(box2.count === 1 && box2.items[0].payload === '持久化', '重启后能读回队列')
}

// 7) 容量上限
{
  const { box } = makeBox({ deliver: async () => {}, maxItems: 3 })
  for (let i = 0; i < 10; i++) box.enqueue({ roomId: '7', isGroup: true, kind: 'text', payload: 'x' + i, error: 'e' })
  ok(box.count === 3, '超过上限只保留最后 3 条')
  ok(box.items[2].payload === 'x9', '保留的是最新的')
}

// 8) 错误分类
{
  ok(shouldRetrySend('fetch failed'), 'fetch failed → 可重试')
  ok(shouldRetrySend('HTTP 503'), 'HTTP 503 → 可重试')
  ok(shouldRetrySend('OneBot HTTP 端点未就绪'), '端点未就绪 → 可重试')
  ok(!shouldRetrySend('你已被移出该群'), '被移出群 → 不可重试')
  ok(!shouldRetrySend('retcode 1404 unknown action'), '未知动作 → 不可重试')
}

console.log('')
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`)
if (fails.length) {
  console.log('失败项：')
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log('重试队列回归全部通过 ✅')
