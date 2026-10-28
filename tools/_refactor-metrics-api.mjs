import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

// API: case 'metrics'
const healthCase = lines.findIndex((l) => l.trim() === "case 'health':")
if (healthCase < 0) throw new Error('找不到 health case')
if (!lines.some((l) => l.includes("case 'metrics':"))) {
  lines.splice(healthCase, 0,
    "            case 'metrics': {",
    '              const snap = metrics.snapshot()',
    '              return json(res, 200, {',
    '                ok: true,',
    '                result: {',
    '                  ...snap,',
    "                  stats: { msgsIn: stats.msgsIn, replies: stats.replies, skipped: stats.skipped, llmCalls: stats.llmCalls, llmErrors: stats.llmErrors, sends: stats.sends, stickersSent: stats.stickersSent },",
    '                  recentErrors: recentErrors(10),',
    '                },',
    '              })',
    '            }',
  )
}

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('API: 加 metrics')
