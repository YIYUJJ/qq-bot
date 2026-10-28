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
const stateImport = lines.findIndex((l) => l.includes("from './state-store.mjs'"))
if (stateImport < 0) throw new Error('找不到 state-store 导入')
lines.splice(stateImport + 1, 0, "import { createVisionCache } from './vision-cache.mjs'")

// 2) 初始化缓存（VISION_FILE / visionCache 定义处）
const vf = lines.findIndex((l) => l.includes("const VISION_FILE = join(DATA_DIR, 'vision-cache.json')"))
if (vf < 0) throw new Error('找不到 VISION_FILE')
// 删掉 VISION_FILE / visionCache 两行
lines.splice(vf, 2,
  '  // 识图缓存交给 lib/vision-cache.mjs（key 归一化 + 上限裁剪 + 落盘）',
  '  const vision = createVisionCache({',
  '    file: join(DATA_DIR, \'vision-cache.json\'),',
  '    config,',
  '    readJson,',
  '    writeJson,',
  '    log,',
  '  })',
  '  const visionCache = vision.cache',
)

// 3) visionKey → vision.key（删函数，保留引用名）
const vk = findFn('visionKey')
if (vk >= 0) {
  const end = fnEnd(vk)
  lines.splice(vk, end - vk + 1, '  const visionKey = (url) => vision.key(url)')
}

// 4) trimVisionCache / writeJson(VISION_FILE...) → vision.trim()/vision.persist()
const tv = findFn('trimVisionCache')
if (tv >= 0) {
  const end = fnEnd(tv)
  lines.splice(tv, end - tv + 1, '  const trimVisionCache = () => vision.trim()')
}
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('writeJson(VISION_FILE, visionCache)')) {
    lines[i] = lines[i].replace('writeJson(VISION_FILE, visionCache)', 'vision.persist()')
  }
}

writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('vision-cache 抽取完成')
