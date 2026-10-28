import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

// 1) import safe
const metaImport = lines.findIndex((l) => l.includes("from './meta.mjs'"))
if (metaImport < 0) throw new Error('找不到 meta 导入')
if (!lines.some((l) => l.includes("from './safe.mjs'"))) {
  lines.splice(metaImport + 1, 0, "import { installProcessGuards, safe, safeAsync, wrapTool, recentErrors } from './safe.mjs'")
}

// 2) apply 开头安装进程兜底
const applyLine = lines.findIndex((l) => l.startsWith('export function apply('))
if (applyLine < 0) throw new Error('找不到 apply')
const mkdirLine = lines.findIndex((l, i) => i > applyLine && l.includes('mkdirSync(DATA_DIR'))
if (mkdirLine < 0) throw new Error('找不到 mkdirSync')
lines.splice(mkdirLine + 1, 0, '',
  '  // 最后一道防线：未捕获异常只记录、不带崩 DSH（热重载不会重复安装）',
  '  installProcessGuards(log)',
)

// 3) safeRegister 里包一层 wrapTool
const sr = lines.findIndex((l) => l.includes('function safeRegister(def)'))
if (sr < 0) throw new Error('找不到 safeRegister')
lines.splice(sr + 1, 0, '    // 工具执行抛错时转成错误文本，不把异常抛给宿主', '    def = wrapTool(def, log)')

// 4) safeTick 改成同一套实现
const st = lines.findIndex((l) => l.includes('function safeTick(name, fn)'))
if (st < 0) throw new Error('找不到 safeTick')
// 找到 safeTick 的结束（'  } }' 或 '  }' 行）
let stEnd = -1
for (let i = st + 1; i < st + 14; i++) {
  if (/^\s*\}\s*\}?\s*$/.test(lines[i])) {
    stEnd = i
    break
  }
}
if (stEnd < 0) stEnd = st + 6
lines.splice(st, stEnd - st + 1, '  function safeTick(name, fn) {', "    return safe('timer:' + name, fn)", '  }')

// 5) ob.onEvent 用 safe 包（已有 catch，统一入口）
const oe = lines.findIndex((l) => l.includes('ob.onEvent((ev) => {'))
if (oe > 0) {
  // 只替换下一行的 catch 写法，保留原有函数体
  if (lines[oe + 1].includes('void onEvent(ev).catch')) {
    lines[oe + 1] = "    void safeAsync('event:' + (ev?.postType || 'message'), () => onEvent(ev))"
  }
}

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('index.js: 接入统一错误边界')
