import { readFileSync, writeFileSync } from 'node:fs'

// 1) metrics：保存最近 reply/skip 事件，供面板展示阶段耗时
let m = readFileSync('lib/metrics.mjs', 'utf8')
if (!m.includes('const recentEvents = []')) {
  m = m.replace(
    "  let eventCount = 0\n",
    "  let eventCount = 0\n  const recentEvents = [] // 最近 reply/skip，面板用（最多 20 条）\n",
  )
  m = m.replace(
    "  const event = (type, data = {}) => {\n    eventCount += 1",
    "  const event = (type, data = {}) => {\n    eventCount += 1\n    if (type === 'reply' || type === 'skip') {\n      recentEvents.push({ type, at: Date.now(), ...data })\n      if (recentEvents.length > 20) recentEvents.shift()\n    }",
  )
  m = m.replace('    events: eventCount,\n  })', '    events: eventCount,\n    recent: [...recentEvents],\n  })')
  m = m.replace('    eventCount = 0\n  } }', '    eventCount = 0\n    recentEvents.length = 0\n  } }')
  writeFileSync('lib/metrics.mjs', m, 'utf8')
  console.log('metrics: recent 事件已加')
}

// 2) http-api：metrics 返回里带上用量汇总
let a = readFileSync('lib/http-api.mjs', 'utf8')
if (!a.includes('usage: usageView()')) {
  a = a.replace('                  recentErrors: recentErrors(10),', '                  recentErrors: recentErrors(10),\n                  usage: usageView(),')
  writeFileSync('lib/http-api.mjs', a, 'utf8')
  console.log('http-api: metrics 带 usage')
}

// 3) 面板：补阶段耗时 + 最近回复链路
let p = readFileSync('panel/index.html', 'utf8')
if (!p.includes('stage-box')) {
  p = p.replace(
    "      const errs = (m && m.recentErrors) || [];",
    `      const errs = (m && m.recentErrors) || [];
      const u = (m && m.usage) || {};
      const recent = (m && m.recent) || [];
      const lastReply = [...recent].reverse().find((x) => x.type === 'reply' && x.stages);
      const stageRow = lastReply
        ? '<div class="help" style="margin-top:6px">最近一次回复（trace ' + esc(String(lastReply.trace || '')) + '）</div>' +
          kv('决策', (lastReply.stages.decideMs ?? '-') + ' ms') +
          kv('排队', (lastReply.stages.queueMs ?? '-') + ' ms') +
          kv('生成', (lastReply.stages.generateMs ?? '-') + ' ms') +
          kv('发送', (lastReply.stages.sendMs ?? '-') + ' ms') +
          kv('分段', (lastReply.parts ?? '-') + ' 段')
        : '';`,
  )
  p = p.replace(
    "        kv('总延迟 P50/P95', fmtLat('totalMs')) +",
    `        kv('总延迟 P50/P95', fmtLat('totalMs')) +
        kv('决策 P50/P95', fmtLat('decideMs')) +
        kv('发送 P50/P95', fmtLat('sendMs')) +
        kv('累计 token', (u.total || 0) + '（' + (u.calls || 0) + ' 次调用）') +
        stageRow +`,
  )
  writeFileSync('panel/index.html', p, 'utf8')
  console.log('面板：阶段耗时与最近链路已加')
}
