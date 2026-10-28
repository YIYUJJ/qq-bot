import { readFileSync, writeFileSync } from 'node:fs'

// 1) http-api 补 recentErrors import
let h = readFileSync('lib/http-api.mjs', 'utf8')
if (!h.includes('recentErrors')) throw new Error('use 点已丢？')
if (!h.includes("from './safe.mjs'")) {
  h = h.replace("import { readFileSync } from 'node:fs'", "import { readFileSync } from 'node:fs'\nimport { recentErrors } from './safe.mjs'")
  writeFileSync('lib/http-api.mjs', h, 'utf8')
  console.log('http-api 补 recentErrors import')
}

// 2) test-http-api 增加真实 op 测试
let t = readFileSync('lib/test-http-api.mjs', 'utf8')
if (!t.includes('metrics 返回用量与延迟')) {
  const block = `
// 3) 真实 op：metrics / usage / rooms / state
{
  const d2 = Object.fromEntries(API_DEPS.map((k) => [k, undefined]))
  Object.assign(d2, {
    config: { enabled: true, allowGroups: ['900001'] },
    stats: { msgsIn: 3, replies: 1, skipped: 1, llmCalls: 1, llmErrors: 0, sends: 1 },
    metrics: { snapshot: () => ({ counters: { msgsIn: 3 }, latency: { totalMs: { p50: 10, p95: 20 } }, recent: [], events: 2 }), inc: () => {}, observe: () => {}, event: () => {} },
    usageView: () => ({ total: 100, calls: 2, today: { total: 40 }, days: [] }),
    panelState: () => ({ ok: true, at: Date.now(), rooms: [], config: {} }),
    rooms: new Map([['900001', { roomId: '900001', roomName: '测试群', msgs: [], replyTimes: [], nameCache: new Map() }]]),
    groupNames: new Map([['900001', '测试群']]),
    stickers: {},
    outbox: { count: 0, items: [] },
    getService: () => null,
    log: () => {},
  })
  const h2 = createApiHandler(d2)
  const call = async (op) => {
    const { req, res } = mkReqRes('/qq-bot/api/action', 'POST', JSON.stringify({ op }))
    await h2(req, res)
    return res
  }
  const m = await call('metrics')
  ok(m.status === 200, 'metrics op 返回 200')
  let mj = {}
  try {
    mj = JSON.parse(m.body)
  } catch {
    /* ignore */
  }
  ok(mj.ok === true && mj.result && mj.result.counters, 'metrics 返回 counters')
  ok(mj.result && mj.result.usage && mj.result.usage.total === 100, 'metrics 包含用量汇总')

  const u = await call('usage')
  ok(u.status === 200, 'usage op 返回 200')

  const r = await call('rooms')
  ok(r.status === 200 && String(r.body).includes('900001'), 'rooms op 返回房间')

  const sres = mkReqRes('/qq-bot/api/state', 'GET')
  await h2(sres.req, sres.res)
  ok(sres.status === 200, 'state 返回 200')
}`
  t = t.replace("\nconsole.log('')", block + "\n\nconsole.log('')")
  writeFileSync('lib/test-http-api.mjs', t, 'utf8')
  console.log('test-http-api 已补真实 op 测试')
}
