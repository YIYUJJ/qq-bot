import { readFileSync, writeFileSync } from 'node:fs'

// 1) 模块：ob → getOb（惰性，避免 index 里 ob 还没定义）
let m = readFileSync('lib/state-init.mjs', 'utf8')
m = m.replace('"mediaKey","ob"', '"mediaKey","getOb"')
m = m.replace('mediaKey, ob, shouldRetrySend', 'mediaKey, getOb, shouldRetrySend')
m = m.replace(/\bawait ob\./g, 'await getOb().')
writeFileSync('lib/state-init.mjs', m, 'utf8')

// 2) index：把 runtime 解构提前
let L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const runtimeDecl = L.findIndex((l) => l.includes('const runtime = createRuntime()'))
const destrIdx = L.findIndex((l) => l.trim() === 'const { rooms, stats, timers, groupNames } = runtime')
if (runtimeDecl < 0 || destrIdx < 0) throw new Error('找不到 runtime 声明/解构')
const destrLine = L[destrIdx]
if (destrIdx > runtimeDecl + 3) {
  L.splice(destrIdx, 1)
  L.splice(runtimeDecl + 1, 0, '', destrLine)
}

// 3) 把 stateInit 块移到 log 定义之后（ROOMS_FILE 之前）
let s = L.join('\n')
const blockStart = s.indexOf('  // 状态容器（持久化对象）交给 lib/state-init.mjs')
if (blockStart < 0) throw new Error('找不到 stateInit 块')
const blockEnd = s.indexOf('  } = stateInit', blockStart) + '  } = stateInit\n'.length
const block = s.slice(blockStart, blockEnd)
s = s.slice(0, blockStart) + s.slice(blockEnd)

const anchor = '  // ── 每群性格覆盖（稀疏覆盖，未覆盖的键跟全局走）────────'
const idx = s.indexOf(anchor)
if (idx < 0) throw new Error('找不到 ROOMS_FILE 锚点')
s = s.slice(0, idx) + block + '\n' + s.slice(idx)

// 4) getOb 注入
s = s.replace('    DATA_DIR, config, isAllowedGroup, log, mediaKey, ob, shouldRetrySend, stats, writeJson,', '    DATA_DIR, config, isAllowedGroup, log, mediaKey, getOb: () => ob, shouldRetrySend, stats, writeJson,')

writeFileSync('lib/index.js', s, 'utf8')
console.log('stateInit 已前移，ob 改惰性')
