import { createApiHandler, API_DEPS } from '../lib/http-api.mjs'

const stub = () => {}
const deps = Object.fromEntries(API_DEPS.map((k) => [k, stub]))
Object.assign(deps, {
  config: { enabled: true, allowGroups: ['900001'] },
  stats: {},
  metrics: { snapshot: () => ({ counters: {}, latency: {}, recent: [], events: 0 }) },
  usageView: () => ({ total: 100 }),
  panelState: () => ({ ok: true }),
  rooms: new Map(),
  groupNames: new Map(),
  outbox: { count: 0 },
  getService: () => null,
  log: () => {},
})
const handler = createApiHandler(deps)

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
const body = JSON.stringify({ op: 'metrics' })
const req = {
  url: '/qq-bot/api/action',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  on(ev, cb) {
    if (ev === 'data') cb(Buffer.from(body))
    if (ev === 'end') cb()
    return this
  },
  destroy() {},
}
await handler(req, res)
console.log('status', res.status)
console.log('body', res.body.slice(0, 300))
