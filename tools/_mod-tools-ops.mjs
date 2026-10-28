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

// 从后往前删
for (const name of ['qqbot_restart', 'qqbot_autostart', 'qqbot_reload', 'qqbot_config']) {
  const [s, e] = blockRange(`name: '${name}'`)
  lines.splice(s, e - s + 1)
}

const anchor = lines.findIndex((l) => l.includes('simulateTools({'))
if (anchor < 0) throw new Error('找不到 simulateTools 注册')
let closeAnchor = anchor
while (closeAnchor < lines.length && lines[closeAnchor] !== '  }') closeAnchor++
lines.splice(closeAnchor + 1, 0,
  '',
  '  // 运维工具（配置/重载/自启/重启）交给 lib/tools-ops.mjs',
  '  for (const tool of opsTools({',
  '    config, applyConfigPatch, log, rereadConfigFromDisk, reloadSelf,',
  '    setAutostart, isAutostartEnabled, autostartFile, restartDsh, textOut,',
  '  })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

const simImport = lines.findIndex((l) => l.includes("from './tools-simulate.mjs'"))
lines.splice(simImport + 1, 0, "import { opsTools } from './tools-ops.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-ops 抽取完成，行数', lines.length)
