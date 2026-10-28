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
    headers: {},
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

console.log('')
if (fails.length) {
  console.log(`❌ test-http-api.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-http-api.mjs 通过 ${pass} 项，失败 0 项`)
