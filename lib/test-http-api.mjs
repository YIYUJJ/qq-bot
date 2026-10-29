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

// 4) 表情包「收藏」按钮：sticker.favorite
{
  const stub = () => {}
  const favCalls = []
  const lib = { s1: { url: 'http://x/1.png', from: '小美' }, s2: { url: 'http://x/2.png', emojiId: 'E9' }, s3: { url: 'http://x/3.png', bad: true } }
  const mk = (favoriteSticker) => {
    const d3 = Object.fromEntries(API_DEPS.map((k) => [k, stub]))
    Object.assign(d3, { config: { stickerFavorite: false }, stickers: lib, writeJson: () => {}, log: () => {}, getService: () => null, favoriteSticker })
    const h = createApiHandler(d3)
    return async (args) => {
      const { req, res } = mkReqRes('/qq-bot/api/action', 'POST', JSON.stringify({ op: 'sticker.favorite', args }))
      await h(req, res)
      let j = {}
      try {
        j = JSON.parse(res.body)
      } catch {
        /* ignore */
      }
      return { status: res.status, j }
    }
  }
  const act = mk(async (st, url, id, opts) => {
    favCalls.push([id, url, opts])
    st.emojiId = 'E1'
    return { ok: true, emojiId: 'E1' }
  })
  const r1 = await act({ id: 's1' })
  ok(r1.status === 200 && r1.j.ok && lib.s1.emojiId === 'E1' && favCalls[0][1] === 'http://x/1.png' && favCalls[0][2]?.manual === true, 'sticker.favorite：手动收藏（传 manual）')
  ok(r1.j.result?.autoSendOff === true, 'sticker.favorite：「收进 QQ 收藏表情」开关关着时告诉面板')
  const r2 = await act({ id: 's2' })
  ok(r2.status === 200 && r2.j.result?.already === true && favCalls.length === 1, 'sticker.favorite：已经收过的不重复收')
  const r3 = await act({ id: 's3' })
  ok(r3.status === 400 && favCalls.length === 1, 'sticker.favorite：失效又没本地文件的直接拒绝')
  const r4 = await act({ id: 'nope' })
  ok(r4.status === 404, 'sticker.favorite：图库里没有返回 404')
  lib.s4 = { url: 'http://x/4.png' }
  const failAct = mk(async () => ({ ok: false, error: '接口没返回 emoji_id' }))
  const r5 = await failAct({ id: 's4' })
  ok(r5.status === 500 && String(r5.j.error).includes('接口没返回 emoji_id') && !lib.s4.emojiId, 'sticker.favorite：收不进去时把原因带回面板')
  const oldAct = mk(undefined)
  const r6 = await oldAct({ id: 's4' })
  ok(r6.status === 400 && String(r6.j.error).includes('不支持'), 'sticker.favorite：没传收藏函数时提示不支持')
}

console.log('')
if (fails.length) {
  console.log(`❌ test-http-api.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-http-api.mjs 通过 ${pass} 项，失败 0 项`)
