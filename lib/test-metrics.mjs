/** metrics.mjs 回归测试。 运行：node lib/test-metrics.mjs */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMetrics, newTraceId } from './metrics.mjs'

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

const dir = mkdtempSync(join(tmpdir(), 'qqbot-metrics-'))
try {
  const file = join(dir, 'events.jsonl')
  const m = createMetrics({ version: 't', logFile: file, maxBytes: 400 })

  m.inc('replies')
  m.inc('replies')
  m.inc('llmCalls', 3)
  ok(m.snapshot().counters.replies === 2, '计数器累加')
  ok(m.snapshot().counters.llmCalls === 3, '计数器支持步长')

  for (const v of [100, 200, 300, 400, 500]) m.observe('firstTokenMs', v)
  const lat = m.snapshot().latency.firstTokenMs
  ok(lat.n === 5, '延迟样本数')
  ok(lat.p50 >= 200 && lat.p50 <= 400, 'P50 落在合理区间')
  ok(lat.p95 >= 400, 'P95 落在高值区')
  ok(m.snapshot().latency.totalMs === undefined, '未观测的指标不出现')

  m.event('message', { room: '1' })
  m.event('reply', { room: '1', ms: 12 })
  const lines = readFileSync(file, 'utf8').trim().split('\n')
  ok(lines.length >= 2, '事件日志写入 JSONL')
  ok(JSON.parse(lines[0]).type === 'message', '事件行可解析且 type 正确')

  // 滚动：超过 maxBytes 后写到 .1
  for (let i = 0; i < 40; i++) m.event('noise', { i })
  ok(statSync(file).size <= 400 + 200, '事件日志按大小滚动')
  ok(m.snapshot().events >= 40, '事件计数持续累加')

  // 重置
  m.reset()
  ok(m.snapshot().counters.replies === undefined, 'reset 清空计数')
  ok(newTraceId().length === 10, 'traceId 长度固定')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-metrics.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-metrics.mjs 通过 ${pass} 项，失败 0 项`)
