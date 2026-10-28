/** state-init.mjs 回归测试：状态容器构造、去重、用量、重发队列。 运行：node lib/test-state-init.mjs */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { STATE_INIT_DEPS, createStateInit } from './state-init.mjs'

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
  createStateInit({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(STATE_INIT_DEPS.includes('getOb'), '依赖清单')

const dir = mkdtempSync(join(tmpdir(), 'qqbot-stateinit-'))
writeFileSync(join(dir, 'usage.json'), JSON.stringify({ total: 5, prompt: 2, completion: 3, calls: 1, byDay: {} }), 'utf8')
writeFileSync(join(dir, 'replied.json'), JSON.stringify({ '900001': [{ id: 'm1', at: Date.now() }] }), 'utf8')

try {
  const sent = []
  const ob = {
    sendGroup: async (id, text) => sent.push(['group', id, text]),
    sendPrivate: async (id, text) => sent.push(['private', id, text]),
    sendGroupSegments: async (id, segs) => sent.push(['segs', id, segs]),
  }
  const logs = []
  const state = createStateInit({
    DATA_DIR: dir,
    config: { allowPrivate: ['42'] },
    getIsAllowedGroup: () => (id) => String(id) === '900001',
    log: (m) => logs.push(m),
    mediaKey: (u) => u,
    getOb: () => ob,
    shouldRetrySend: (msg) => /ECONNRESET/.test(msg),
    stats: {},
    writeJson: (f, v) => writeFileSync(f, JSON.stringify(v), 'utf8'),
  })

  ok(state.FACTS_FILE.endsWith('facts.json'), '路径常量就绪')
  ok(state.usage.total === 5, '用量从文件载入')
  ok(state.replied['900001'].length === 1, '去重记录载入')
  ok(state.alreadyReplied('900001', 'm1') === true, '已回复判定')

  // recordReplied / noteUsage
  ok(state.recordReplied('900001', 'm2') === true, '记录新回复')
  state.noteUsage({ inputTokens: 10, outputTokens: 4 })
  ok(state.usage.total === 19 && state.usage.calls === 2, '用量累加')
  ok(state.usageView().total === 19, 'usageView 反映总量')

  // hashStr 稳定
  ok(state.hashStr('abc') === state.hashStr('abc'), 'hashStr 稳定')

  // sendWithRetry：成功
  const r1 = await state.sendWithRetry('900001', true, 'text', 'hi')
  ok(r1.ok === true && sent.length === 1, '发送成功')

  // sendWithRetry：可重试错误 → 入队
  const obFail = {
    sendGroup: async () => {
      throw new Error('ECONNRESET')
    },
  }
  const state2 = createStateInit({
    DATA_DIR: dir,
    config: { allowPrivate: [] },
    getIsAllowedGroup: () => () => true,
    log: () => {},
    mediaKey: (u) => u,
    getOb: () => obFail,
    shouldRetrySend: (msg) => /ECONNRESET/.test(msg),
    stats: {},
    writeJson: (f, v) => writeFileSync(f, JSON.stringify(v), 'utf8'),
  })
  const r2 = await state2.sendWithRetry('900001', true, 'text', 'hi')
  ok(r2.queued === true, '可重试错误进入重发队列')
  ok(state2.outbox.count >= 1, '队列里有条目')

  // 不可重试错误：抛出
  const state3 = createStateInit({
    DATA_DIR: dir,
    config: { allowPrivate: [] },
    getIsAllowedGroup: () => () => true,
    log: () => {},
    mediaKey: (u) => u,
    getOb: () => ({ sendGroup: async () => { throw new Error('bad request') } }),
    shouldRetrySend: () => false,
    stats: {},
    writeJson: (f, v) => writeFileSync(f, JSON.stringify(v), 'utf8'),
  })
  let threw3 = false
  try {
    await state3.sendWithRetry('900001', true, 'text', 'x')
  } catch {
    threw3 = true
  }
  ok(threw3, '不可重试错误直接抛')

  // 落盘
  state.flushStateNow()
  ok(JSON.parse(readFileSync(join(dir, 'replied.json'), 'utf8'))['900001'].length >= 2, 'replied 已落盘')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-state-init.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-state-init.mjs 通过 ${pass} 项，失败 0 项`)
