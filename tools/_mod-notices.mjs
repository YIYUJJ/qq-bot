import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

function findFn(name) {
  return lines.findIndex((l) => l.includes('function ' + name + '('))
}
function fnEnd(start) {
  let depth = 0
  let started = false
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth++
        started = true
      } else if (ch === '}') depth--
    }
    if (started && depth === 0) return i
  }
  throw new Error('没闭合：' + lines[start])
}

// 1) import
const adminImport = lines.findIndex((l) => l.includes("from './admin-commands.mjs'"))
if (adminImport < 0) throw new Error('找不到 admin-commands 导入')
lines.splice(adminImport + 1, 0, "import { createNoticeHandler } from './notices.mjs'")

// 2) 删除原 handleNotice
const s = findFn('handleNotice')
if (s < 0) throw new Error('找不到 handleNotice')
const e = fnEnd(s)
lines.splice(s, e - s + 1)

// 3) 在 adminCommands 初始化之后创建 noticeHandler
const anchor = lines.findIndex((l) => l.includes('const { findRoomByText, detectIntents'))
if (anchor < 0) throw new Error('找不到 adminCommands 解构')
lines.splice(anchor + 1, 0,
  '',
  '  // 撤回/拍一拍交给 lib/notices.mjs（副作用通过依赖注入）',
  '  const noticeHandler = createNoticeHandler({',
  '    ob,',
  '    config,',
  '    log,',
  '    roomState,',
  '    cfgFor,',
  '    allowedHere,',
  '    setMood,',
  '    scheduleFlush,',
  '  })',
  '  const { handleNotice } = noticeHandler',
)

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('notices 抽取完成')
