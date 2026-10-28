import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

// 1) import runtime/timers
const metricsImport = lines.findIndex((l) => l.includes("from './metrics.mjs'"))
if (metricsImport < 0) throw new Error('找不到 metrics 导入')
lines.splice(metricsImport + 1, 0,
  "import { createRuntime } from './runtime.mjs'",
  "import { startTimers } from './timers.mjs'",
)

// 2) 创建 runtime（apply 开头 mkdir 之后）
const mk = lines.findIndex((l) => l.includes('mkdirSync(DATA_DIR, { recursive: true })'))
if (mk < 0) throw new Error('找不到 mkdir')
lines.splice(mk + 1, 0,
  '',
  '  // 运行时状态集中管理（rooms/stats/timers/groupNames）',
  '  const runtime = createRuntime()',
)

// 3) rooms / stats / groupNames / timers 改为从 runtime 取
const roomsLine = lines.findIndex((l) => l.trim() === 'const rooms = new Map()')
if (roomsLine < 0) throw new Error('找不到 rooms')
lines[roomsLine] = '  const { rooms, stats, timers, groupNames } = runtime'

// 删除 stats 对象块
const statsStart = lines.findIndex((l) => l.trim() === 'const stats = {')
if (statsStart < 0) throw new Error('找不到 stats')
let statsEnd = statsStart
while (statsEnd < lines.length && lines[statsEnd].trim() !== '}') statsEnd++
lines.splice(statsStart, statsEnd - statsStart + 1)

// 删除 timers/groupNames 的独立定义
for (const pat of ['const timers = new Set()', 'const groupNames = new Map()']) {
  const i = lines.findIndex((l) => l.trim() === pat)
  if (i >= 0) lines.splice(i, 1)
}

// 4) 定时器块 → startTimers
const t0 = lines.findIndex((l) => l.includes('定时任务统一兜底'))
if (t0 < 0) throw new Error('找不到定时器块')
const t1 = lines.findIndex((l, i) => i > t0 && l.trim().startsWith('log('))
if (t1 < 0) throw new Error('找不到定时器块结束')
const block = [
  '  // 后台定时任务交给 lib/timers.mjs（统一 safe 包装 + 统一清理）',
  '  const lifecycle = startTimers({',
  '    safe,',
  '    timers,',
  '    config,',
  '    handlers: {',
  '      proactive: () => proactiveTick(),',
  "      reminders: () => getFeatures().checkReminders(),",
  "      diary: () => getFeatures().maybeDiary(),",
  '      backup: () => backupTick(),',
  '      bond: () => {',
  '        for (const rr of rooms.values()) if (rr.bondDirty) getFeatures().saveBond(rr)',
  '        getFeatures().flushCurves()',
  '      },',
  '      health: () => selfcheck(),',
  '    },',
  '  })',
  "  ctx.effect(() => () => lifecycle.stop(), 'dsh-qq-bot: timers')",
  '',
]
lines.splice(t0, t1 - t0, ...block)

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('index.js: RuntimeContext + timers 模块化')
