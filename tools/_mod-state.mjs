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
const stickerImport = lines.findIndex((l) => l.includes("from './sticker-store.mjs'"))
if (stickerImport < 0) throw new Error('找不到 sticker-store 导入')
lines.splice(stickerImport + 1, 0, "import { createStateStore } from './state-store.mjs'")

// 2) 用 stateStore 替换 5 个函数（它们连续分布）
const first = findFn('flushStateNow')
const last = findFn('usageView')
if (first < 0 || last < 0) throw new Error('找不到状态持久化函数')
const end = fnEnd(last)
lines.splice(first, end - first + 1,
  '  // 状态持久化（replied / usage）交给 lib/state-store.mjs',
  '  const stateStore = createStateStore({',
  '    replied,',
  '    usage,',
  '    repliedFile: REPLIED_FILE,',
  '    usageFile: USAGE_FILE,',
  '    writeJson,',
  '    log,',
  '  })',
  '  const { flushStateNow, markStateDirty, recordReplied, alreadyReplied, noteUsage, usageView } = stateStore',
)

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('state-store 抽取完成')
