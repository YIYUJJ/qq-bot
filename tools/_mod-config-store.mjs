import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

// 1) 找配置块起点与终点
const start = L.findIndex((l) => l.includes('// 配置优先级：文件 > cordis.patch.yml 的 row config > 默认值'))
if (start < 0) throw new Error('找不到配置块起点')
const warnLine = L.findIndex((l, i) => i > start && l.includes('for (const w of configWarnings) log("配置校验：" + w)'))
if (warnLine < 0) throw new Error('找不到 warnings 日志行')
// 终点：normalizeLists 函数结束（warnLine 之后的第一个 "  }" 之后）
let end = warnLine
let seenFn = false
for (let i = warnLine; i < L.length; i++) {
  if (L[i].includes('function normalizeLists()')) seenFn = true
  if (seenFn && L[i].trim() === '}') {
    end = i
    break
  }
}

const block = [
  '  // 配置子系统交给 lib/config-store.mjs（副作用用 hooks 注入）',
  '  const configStore = createConfigStore({',
  '    file: CONFIG_FILE, defaults: DEFAULT_CONFIG, validateConfig,',
  '    keys: CONFIG_KEYS, booleanSet: BOOLEAN, numericSet: NUMERIC, listSet: LIST, meta: CONFIG_META,',
  '    log,',
  '    hooks: {',
  '      onVisionRouteDirty: () => { visionRoute = null },',
  '      onPushRestart: () => { try { startPushServer() } catch { /* ignore */ } },',
  '      onPollRestart: () => { try { startPolling() } catch { /* ignore */ } },',
  '      onQuietChanged: (q) => { quietWindows = parseQuietWindows(q) },',
  '      bumpCfg: () => bumpCfg(),',
  '      reloadRoomOverrides: () => {',
  '        try {',
  '          const ro = JSON.parse(readFileSync(ROOMS_FILE, "utf8"))',
  '          roomOverrides = ro && typeof ro === "object" && !Array.isArray(ro) ? ro : {}',
  '        } catch { /* ignore */ }',
  '      },',
  '    },',
  '  })',
  '  configStore.load(rawConfig)',
  '  const config = configStore.config',
  '  const { saveConfig, applyConfigPatch, rereadConfigFromDisk } = configStore',
  '  for (const w of configStore.warnings) log("配置校验：" + w)',
]
L.splice(start, end - start + 1, ...block)

// 2) 删除三个旧函数
function removeFn(name) {
  const s = L.findIndex((l) => new RegExp('^(  )(async )?function ' + name + '\\(').test(l))
  if (s < 0) return false
  const bc = L[s].lastIndexOf('{')
  let depth = 0
  let inStr = null
  let inLine = false
  for (let i = s; i < L.length; i++) {
    const from = i === s ? bc : 0
    for (let k = from; k < L[i].length; k++) {
      const c = L[i][k]
      const n = L[i][k + 1]
      if (inLine) break
      if (inStr) {
        if (c === '\\') {
          k++
          continue
        }
        if (c === inStr) inStr = null
        continue
      }
      if (c === '/' && n === '/') {
        inLine = true
        break
      }
      if (c === "'" || c === '"' || c === '`') {
        inStr = c
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          L.splice(s, i - s + 1)
          return true
        }
      }
    }
    inLine = false
  }
  return false
}
for (const n of ['saveConfig', 'applyConfigPatch', 'rereadConfigFromDisk']) console.log('remove', n, removeFn(n))

let out = L.join('\n')
if (!out.includes("from './config-store.mjs'")) {
  const a = out.indexOf("import { createDecision } from './decision.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createConfigStore } from './config-store.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('config-store 接入完成')
