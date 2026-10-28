import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

function blockRange(nameMarker) {
  const idx = lines.findIndex((l) => l.includes(nameMarker))
  if (idx < 0) throw new Error('找不到 ' + nameMarker)
  let start = idx
  while (start >= 0 && !lines[start].includes('ctx.effect(() =>')) start--
  let close = -1
  for (let i = idx; i < lines.length; i++) {
    if (lines[i] === '  )') {
      close = i
      break
    }
  }
  if (start < 0 || close < 0) throw new Error('找不到块边界 ' + nameMarker)
  return [start, close]
}

for (const name of ['qqbot_selftest_ops', 'qqbot_panel']) {
  const [s, e] = blockRange(`name: '${name}'`)
  lines.splice(s, e - s + 1)
}

const anchor = lines.findIndex((l) => l.includes('memoryTools({'))
if (anchor < 0) throw new Error('找不到 memoryTools 注册')
let closeAnchor = anchor
while (closeAnchor < lines.length && lines[closeAnchor] !== '  }') closeAnchor++
lines.splice(closeAnchor + 1, 0,
  '',
  '  // 面板/底层自测工具交给 lib/tools-panel.mjs',
  '  for (const tool of panelTools({',
  '    panelState, pickCanned, normText, detectTrigger, config, decide, selfcheck, usageView,',
  '    isManagedRoom, memDirOf, addFact, factsOf, facts, rmSync, searchHistory, extractSearchQuery,',
  '    sensitiveQuery, resolveVisionRoute, ob, stickers, tailLines, logFile: LOG_FILE, configKeys: CONFIG_KEYS,',
  '    applyConfigPatch, textOut,',
  '  })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

const memImport = lines.findIndex((l) => l.includes("from './tools-memory.mjs'"))
lines.splice(memImport + 1, 0, "import { panelTools } from './tools-panel.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-panel 抽取完成，行数', lines.length)
