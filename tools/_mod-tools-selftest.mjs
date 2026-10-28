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

for (const name of ['qqbot_selfcheck', 'qqbot_selftest']) {
  const [s, e] = blockRange(`name: '${name}'`)
  lines.splice(s, e - s + 1)
}

const anchor = lines.findIndex((l) => l.includes('miscTools({'))
if (anchor < 0) throw new Error('找不到 miscTools 注册')
let closeAnchor = anchor
while (closeAnchor < lines.length && lines[closeAnchor] !== '  }') closeAnchor++
lines.splice(closeAnchor + 1, 0,
  '',
  '  // 自检类工具（链路自测/自检明细）交给 lib/tools-selftest.mjs',
  '  for (const tool of selftestTools({',
  '    assertGroupAllowed, ob, normalizeEvent, roomState, stats, onEvent, log, sleep, cfgFor, config, selfcheck, textOut,',
  '  })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

const miscImport = lines.findIndex((l) => l.includes("from './tools-misc.mjs'"))
lines.splice(miscImport + 1, 0, "import { selftestTools } from './tools-selftest.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-selftest 抽取完成，行数', lines.length)
