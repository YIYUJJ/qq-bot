/** state-store.mjs 回归测试：已回复去重、token 用量分桶、合并写。 运行：node lib/test-state-store.mjs */
import { createStateStore } from './state-store.mjs'

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

const replied = {}
const usage = { total: 0, prompt: 0, completion: 0, calls: 0, byDay: {} }
const writes = []
const store = createStateStore({
  replied,
  usage,
  repliedFile: 'replied.json',
  usageFile: 'usage.json',
  writeJson: (f, v) => writes.push({ f, v: JSON.parse(JSON.stringify(v)) }),
  log: () => {},
})

// 已回复
ok(store.recordReplied('g1', 'm1') === true, '首次记录返回 true')
ok(store.recordReplied('g1', 'm1') === false, '重复记录返回 false（去重）')
ok(store.alreadyReplied('g1', 'm1') === true, 'alreadyReplied 命中')
ok(store.alreadyReplied('g1', 'nope') === false, 'alreadyReplied 未命中')
ok(replied.g1.length === 1, '每个会话只存一条')

// 过期的不算
replied.g1 = [{ id: 'old', at: Date.now() - 8 * 86400000 }]
ok(store.alreadyReplied('g1', 'old') === false, '7 天前的记录视为过期')

// 用量
store.noteUsage({ inputTokens: 10, outputTokens: 5 })
store.noteUsage({ promptTokens: 2, completionTokens: 3 })
ok(usage.total === 20, 'token 总数累加')
ok(usage.calls === 2, '调用次数累加')
const view = store.usageView()
ok(view.days.length === 1, '用量按天分桶')
ok(view.today.total === 20, '今天的用量正确')

// 只留 30 天
const now = new Date()
for (let i = 0; i < 35; i++) {
  const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10)
  usage.byDay[d] = { prompt: 0, completion: 0, total: 0, calls: 0 }
  if (i === 34) break
}
for (let i = 0; i < 35; i++) {
  const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10)
  usage.byDay[d] = { prompt: 0, completion: 0, total: 0, calls: 0 }
}
store.noteUsage({ inputTokens: 1 })
ok(Object.keys(usage.byDay).length <= 30, '用量只保留 30 天')

// 合并写
ok(store.dirty === true, '有改动时是脏的')
store.flushStateNow()
ok(store.dirty === false, 'flush 后不脏')
ok(writes.length >= 2, 'flush 写了两份文件')

// dispose 清定时器
store.markStateDirty()
ok(store.dirty === true, 'markStateDirty 生效')
store.dispose()
ok(store.dirty === false, 'dispose 会立即 flush')

console.log('')
if (fails.length) {
  console.log(`❌ test-state-store.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-state-store.mjs 通过 ${pass} 项，失败 0 项`)
