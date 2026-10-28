import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

// 1) import metrics
const storeImport = lines.findIndex((l) => l.includes("from './store.mjs'"))
if (storeImport < 0) throw new Error('找不到 store 导入')
if (!lines.some((l) => l.includes("from './metrics.mjs'"))) {
  lines.splice(storeImport + 1, 0, "import { createMetrics, newTraceId } from './metrics.mjs'")
}

// 2) 创建 metrics（LOG_FILE 定义之后）
const logFileLine = lines.findIndex((l) => l.includes("const LOG_FILE = join(DATA_DIR, 'bot.log')"))
if (logFileLine < 0) throw new Error('找不到 LOG_FILE')
lines.splice(logFileLine + 1, 0,
  '  // 指标 + 结构化事件（事件日志单独一个文件，方便排查单条消息链路）',
  "  const metrics = createMetrics({ version, logFile: join(DATA_DIR, 'events.jsonl') })",
)

// 3) 关键计数点
const patches = [
  ['    stats.msgsIn += 1', '    stats.msgsIn += 1\n    metrics.inc(\'msgsIn\')'],
  ['      stats.llmCalls += 1', '      stats.llmCalls += 1\n      metrics.inc(\'llmCalls\')'],
  ['    stats.replies += 1', '    stats.replies += 1\n    metrics.inc(\'replies\')'],
  ['      stats.skipped += 1', '      stats.skipped += 1\n      metrics.inc(\'skipped\')'],
]
for (const [a, b] of patches) {
  const idx = lines.findIndex((l) => l === a)
  if (idx < 0) {
    console.log('⚠️ 找不到计数行:', a.trim())
    continue
  }
  lines.splice(idx, 1, ...b.split('\n'))
}

// 4) 回复成功时记录延迟与事件
const replyLog = lines.findIndex((l) => l.includes('`回复 ${r.roomName || r.roomId}｜${priority}｜首字 ${out.firstTokenMs}ms'))
if (replyLog < 0) throw new Error('找不到回复日志行')
lines.splice(replyLog, 0,
  "    metrics.inc('sends')",
  "    metrics.observe('totalMs', Date.now() - t0)",
  '    if (Number(out.firstTokenMs) >= 0) metrics.observe(\'firstTokenMs\', out.firstTokenMs)',
  "    metrics.event('reply', { room: r.roomId, priority, firstTokenMs: out.firstTokenMs, totalMs: Date.now() - t0, trace: r.traceId })",
)

// 5) 收到消息时生成 traceId + 事件
const recv = lines.findIndex((l) => l === '    stats.msgsIn += 1')
if (recv >= 0) {
  // 找到 entry 创建后的位置（entry 定义在 stats.msgsIn 之后）
  lines.splice(recv + 3, 0, "    r.traceId = r.traceId || newTraceId()")
}

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('index.js: 接入指标/事件')
