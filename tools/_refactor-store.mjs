import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

// 1) import store
const safeImport = lines.findIndex((l) => l.includes("from './safe.mjs'"))
if (safeImport < 0) throw new Error('找不到 safe 导入')
if (!lines.some((l) => l.includes("from './store.mjs'"))) {
  lines.splice(safeImport + 1, 0, "import { atomicWriteJson, acquireInstanceLock } from './store.mjs'")
}

// 2) writeJson 改成原子写
const wj = lines.findIndex((l) => l.includes('function writeJson(file, v)'))
if (wj < 0) throw new Error('找不到 writeJson')
let wjEnd = -1
for (let i = wj + 1; i < wj + 12; i++) {
  if (lines[i].trim() === '}') {
    wjEnd = i
    break
  }
}
if (wjEnd < 0) throw new Error('找不到 writeJson 结束')
lines.splice(wj, wjEnd - wj + 1,
  '  function writeJson(file, v) {',
  '    // 原子写：先 tmp 再 rename，崩溃不会留下半个 JSON',
  '    const ok = atomicWriteJson(file, v)',
  "    if (!ok) log('写文件失败 ' + file)",
  '  }',
)

// 3) 单实例锁：disposed 标志之前抢锁
const disposedLine = lines.findIndex((l) => l.includes('let disposed = false'))
if (disposedLine < 0) throw new Error('找不到 disposed')
lines.splice(disposedLine, 0,
  '  // 单实例锁：两个 DSH 同时跑会重复回复、互相写坏数据；抢不到锁就退化成只读',
  "  const instanceLock = acquireInstanceLock(join(DATA_DIR, 'instance.lock'), { label: 'dsh-qq-bot' })",
  '  if (!instanceLock.ok) {',
  "    log('⚠️ 另一个实例正在运行（PID ' + (instanceLock.holder?.pid || '?') + '），本实例进入只读模式（不回复、不写数据）')",
  '    config.enabled = false',
  '  }',
  '',
)

// 4) dispose 时释放锁
const dflag = lines.findIndex((l) => l.includes('dsh-qq-bot: disposed flag'))
if (dflag < 0) throw new Error('找不到 disposed effect')
lines.splice(dflag, 0, '    try { instanceLock.release() } catch { /* ignore */ }')

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('index.js: 原子写 + 单实例锁')
