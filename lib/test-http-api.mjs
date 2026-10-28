/** http-api.mjs 回归测试：依赖校验、面板页输出、未知路由 404。 运行：node lib/test-http-api.mjs */
import { API_DEPS, createApiHandler } from './http-api.mjs'

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

// 1) 缺依赖启动即报错
let threw = ''
try {
  createApiHandler({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖时抛错')
ok(API_DEPS.includes('panelState') && API_DEPS.includes('config'), '依赖清单包含关键项')
ok(threw.includes('panelState'), '错误信息列出缺失项')

// 2) 最小依赖：页面路由 + 未知路由
const deps = Object.fromEntries(API_DEPS.map((k) => [k, {}]))
deps.getService = () => null
deps.log = () => {}
const handler = createApiHandler(deps)

function mkReqRes(url, method = 'GET', body = '') {
  const res = {
    status: 0,
    headers: null,
    body: '',
    writeHead(s, h) {
      this.status = s
      this.headers = h
    },
    end(s) {
      this.body += s || ''
    },
  }
  const req = {
    url,
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    on(ev, cb) {
      if (ev === 'data' && body) cb(Buffer.from(body))
      if (ev === 'end') cb()
      return this
    },
    destroy() {},
  }
  return { req, res }
}

// 面板页（非 API）：返回 HTML
const page = mkReqRes('/qq-bot')
await handler(page.req, page.res)
ok(page.res.status === 200, '面板页返回 200')
ok(/<html|<!doctype/i.test(page.res.body), '面板页返回 HTML')
ok(String(page.res.headers?.['content-type'] || '').includes('text/html'), '面板页 content-type 正确')

// 未知 API：404 JSON
const unknown = mkReqRes('/qq-bot/api/does-not-exist', 'POST', '{}')
await handler(unknown.req, unknown.res)
ok(unknown.res.status >= 400 && unknown.res.status < 500, '未知路由返回 4xx（实际 ' + unknown.res.status + '）')
ok(String(unknown.res.headers?.['content-type'] || '').includes('application/json'), '未知路由返回 JSON')

// 403/401 之外的请求也不会把异常抛给宿主
const weird = mkReqRes('/qq-bot/api/state', 'GET')
await handler(weird.req, weird.res)
ok(typeof weird.res.status === 'number' && weird.res.status > 0, 'GET state 有响应（异常被 handler 兜住）')

// 3) 真实 op：metrics / usage / rooms / state
{
  const stub = () => {}
  const d2 = Object.fromEntries(API_DEPS.map((k) => [k, stub]))
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
    facts: {},
    replied: {},
    usage: { total: 0, calls: 0, byDay: {} },
    stickers: {},
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
  ok(sres.res.status === 200, 'state 返回 200（实际 ' + sres.res.status + '）')
}

console.log('')
if (fails.length) {
  console.log(`❌ test-http-api.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-http-api.mjs 通过 ${pass} 项，失败 0 项`)
