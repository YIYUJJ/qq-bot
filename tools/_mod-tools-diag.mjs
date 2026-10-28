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
  if (start < 0) throw new Error('找不到 ctx.effect: ' + nameMarker)
  let close = -1
  for (let i = idx; i < lines.length; i++) {
    if (lines[i] === '  )') {
      close = i
      break
    }
  }
  if (close < 0) throw new Error('找不到块结束: ' + nameMarker)
  return [start, close]
}

// 删两个块（从后往前）
const b2 = blockRange("name: 'qqbot_stickers'")
lines.splice(b2[0], b2[1] - b2[0] + 1)
const b1 = blockRange("name: 'qqbot_llm_models'")
lines.splice(b1[0], b1[1] - b1[0] + 1)

// 在 statusTools 循环之后注册诊断工具
const anchor = lines.findIndex((l) => l.includes('ctx.effect(() => safeRegister(tool))'))
if (anchor < 0) throw new Error('找不到 statusTools 注册')
lines.splice(anchor + 3, 0,
  '',
  '  // 诊断工具（模型路由/图库）交给 lib/tools-diagnostics.mjs',
  '  for (const tool of diagnosticTools({ getLlm: () => ctx.get?.(\'llm\'), stickers, existsSync, textOut })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

// import
const statusImport = lines.findIndex((l) => l.includes("from './tools-status.mjs'"))
lines.splice(statusImport + 1, 0, "import { diagnosticTools } from './tools-diagnostics.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-diagnostics 抽取完成，行数', lines.length)
