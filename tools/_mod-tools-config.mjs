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

const b2 = blockRange("name: 'qqbot_admin_cmd'")
lines.splice(b2[0], b2[1] - b2[0] + 1)
const b1 = blockRange("name: 'qqbot_room_config'")
lines.splice(b1[0], b1[1] - b1[0] + 1)

const anchor = lines.findIndex((l) => l.includes('actionTools({'))
if (anchor < 0) throw new Error('找不到 actionTools 注册')
let closeAnchor = anchor
while (closeAnchor < lines.length && lines[closeAnchor] !== '  }') closeAnchor++
lines.splice(closeAnchor + 1, 0,
  '',
  '  // 配置类工具（每群覆盖/管理员指令预览）交给 lib/tools-config.mjs',
  '  for (const tool of configTools({',
  '    resetRoomOverride, setRoomOverride, roomOverrideOf, cfgFor,',
  '    parseAdminCommand, describeAdminAction, planAdminCommand, normalizePlannedActions, config, textOut,',
  '  })) {',
  '    ctx.effect(() => safeRegister(tool))',
  '  }',
)

const actionsImport = lines.findIndex((l) => l.includes("from './tools-actions.mjs'"))
lines.splice(actionsImport + 1, 0, "import { configTools } from './tools-config.mjs'")

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('tools-config 抽取完成，行数', lines.length)
