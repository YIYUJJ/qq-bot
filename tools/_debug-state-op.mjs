import { createApiHandler, API_DEPS } from '../lib/http-api.mjs'

const stub = () => {}
const deps = Object.fromEntries(API_DEPS.map((k) => [k, stub]))
Object.assign(deps, {
  config: { enabled: true, allowGroups: ['900001'] },
  stats: {},
  metrics: { snapshot: () => ({}) },
  usageView: () => ({ total: 1 }),
  panelState: () => ({ ok: true, at: 1 }),
  rooms: new Map(),
  groupNames: new Map(),
  outbox: { count: 0 },
  facts: {},
  replied: {},
  usage: { total: 0, calls: 0, byDay: {} },
  stickers: {},
  getService: () => null,
  log: () => {},
})
const h = createApiHandler(deps)
const res = { status: 0, headers: null, body: '', writeHead(s, hh) { this.status = s; this.headers = hh }, end(s) { this.body += s || '' } }
const req = { url: '/qq-bot/api/state', method: 'GET', headers: {}, on() { return this }, destroy() {} }
await h(req, res)
console.log('status:', res.status, 'body:', res.body.slice(0, 200))
