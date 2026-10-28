import http from 'node:http'

const req = http.request(
  { host: '127.0.0.1', port: 3101, path: '/qq-bot/api/action', method: 'POST', headers: { 'content-type': 'application/json' } },
  (res) => {
    let b = ''
    res.on('data', (c) => (b += c))
    res.on('end', () => {
      console.log('status', res.statusCode)
      try {
        const j = JSON.parse(b)
        const r = j.result || {}
        console.log('ok:', j.ok)
        console.log('recent:', (r.recent || []).length, '条｜latency keys:', Object.keys(r.latency || {}).join(','))
        console.log('usage:', JSON.stringify(r.usage || {}).slice(0, 120))
        const last = (r.recent || []).filter((x) => x.type === 'reply').pop()
        if (last) console.log('last reply stages:', JSON.stringify(last.stages), 'trace:', last.trace)
      } catch {
        console.log(b.slice(0, 300))
      }
    })
  },
)
req.on('error', (e) => console.log('ERR', e.message))
req.write(JSON.stringify({ op: 'metrics' }))
req.end()
