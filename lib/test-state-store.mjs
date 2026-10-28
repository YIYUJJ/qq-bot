/** state-store.mjs 回归测试：已回复去重、token 用量分桶、合并写。 运行：node lib/test-state-store.mjs */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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

// ── SQLite 状态库（可选后端）──
const fakeDb = {
  backend: 'sqlite',
  empty: true,
  saved: [],
  loaded: null,
  isEmpty() {
    return this.empty
  },
  save(replied, usage) {
    this.saved.push({ replied: JSON.parse(JSON.stringify(replied)), usage: JSON.parse(JSON.stringify(usage)) })
    this.empty = false
  },
  load() {
    return this.loaded || { replied: {}, usage: null }
  },
}
{
  const dir2 = mkdtempSync(join(tmpdir(), 'qqbot-state-db-'))
  const replied2 = { '900001': [{ id: 'm1', at: Date.now() }] }
  const usage2 = { total: 10, prompt: 4, completion: 6, calls: 1, byDay: {} }
  const st2 = createStateStore({
    replied: replied2,
    usage: usage2,
    repliedFile: join(dir2, 'replied.json'),
    usageFile: join(dir2, 'usage.json'),
    writeJson: (f, v) => writeFileSync(f, JSON.stringify(v), 'utf8'),
    log: () => {},
    flushMs: 1e9,
  })
  const r = st2.attachDb(fakeDb)
  ok(r.ok === true && r.imported === true, 'attachDb 空库 → 导入 JSON')
  ok(fakeDb.saved.length === 1 && fakeDb.saved[0].replied['900001'], '导入内容正确')
  ok(st2.backend === 'sqlite', 'backend 反映 sqlite')

  // 写入：flush 同时写库
  st2.recordReplied('900001', 'm2')
  st2.flushStateNow()
  ok(fakeDb.saved.length === 2, 'flush 会写状态库')
  ok(fakeDb.saved[1].replied['900001'].some((x) => x.id === 'm2'), '库里有新记录')

  // 非空库：以库为准
  const replied3 = {}
  const usage3 = { total: 0, prompt: 0, completion: 0, calls: 0, byDay: {} }
  const st3 = createStateStore({
    replied: replied3,
    usage: usage3,
    repliedFile: join(dir2, 'r3.json'),
    usageFile: join(dir2, 'u3.json'),
    writeJson: () => {},
    log: () => {},
    flushMs: 1e9,
  })
  const db3 = {
    backend: 'sqlite',
    isEmpty: () => false,
    load: () => ({ replied: { '800001': [{ id: 'x1', at: Date.now() }] }, usage: { total: 77, prompt: 1, completion: 2, calls: 3, byDay: { '2026-01-01': { total: 77 } } } }),
    save: () => {},
  }
  const r3 = st3.attachDb(db3)
  ok(r3.ok === true && r3.imported === false, 'attachDb 非空库 → 以库为准')
  ok(replied3['800001'] && replied3['800001'].length === 1, 'replied 被库覆盖')
  ok(st3.usageView().total === 77, 'usage 被库覆盖')

  rmSync(dir2, { recursive: true, force: true })
}

console.log('')
if (fails.length) {
  console.log(`❌ test-state-store.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-state-store.mjs 通过 ${pass} 项，失败 0 项`)
