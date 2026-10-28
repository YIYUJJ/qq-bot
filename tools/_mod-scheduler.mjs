import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

function grabFn(name) {
  const start = L.findIndex((l) => new RegExp('^  (async )?function ' + name + '\\(').test(l))
  if (start < 0) throw new Error('找不到 ' + name)
  const bc = L[start].lastIndexOf('{')
  let depth = 0
  let inStr = null
  let inLine = false
  for (let i = start; i < L.length; i++) {
    const from = i === start ? bc : 0
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
          const lines = L.slice(start, i + 1)
          L.splice(start, i - start + 1)
          return lines
        }
      }
    }
    inLine = false
  }
  throw new Error(name + ' 没闭合')
}

const proactiveTick = grabFn('proactiveTick')
const inHours = grabFn('inHours')
const startPolling = grabFn('startPolling')

// 删掉 let pollTimer = null
const pi = L.findIndex((l) => l.trim() === 'let pollTimer = null')
if (pi >= 0) L.splice(pi, 1)

const deps = ['config', 'rooms', 'cfgFor', 'allowedHere', 'isQuiet', 'quietWindowsFor', 'generate', 'systemPrompt', 'buildTranscript', 'humanizeText', 'sendReply', 'log', 'safeTick', 'timers', 'pollOnce', 'privateTargets']
const header = `/**
 * 运行期调度：主动说话（proactive）与轮询定时器。
 *
 * 从 index.js 抽出；pollTimer 由模块自己持有，dispose 时调 stopPolling。
 */
export const SCHEDULER_DEPS = ${JSON.stringify(deps)}

export function createScheduler(deps) {
  const missing = SCHEDULER_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('调度模块缺少依赖：' + missing.join(', '))
  const { ${deps.join(', ')} } = deps
  let pollTimer = null

`
const footer = `
  function stopPolling() {
    if (!pollTimer) return
    clearInterval(pollTimer)
    try {
      timers.delete(pollTimer)
    } catch {
      /* ignore */
    }
    pollTimer = null
  }

  return { proactiveTick, inHours, startPolling, stopPolling }
}
`
writeFileSync('lib/scheduler.mjs', header + [proactiveTick, inHours, startPolling].map((x) => x.join('\n')).join('\n\n') + footer, 'utf8')

const anchor = L.findIndex((l) => l.includes('// 轮询兜底交给 lib/polling.mjs'))
if (anchor < 0) throw new Error('找不到 polling 锚点')
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
L.splice(anchor, 0,
  '  // 运行期调度交给 lib/scheduler.mjs',
  '  const scheduler = createScheduler({',
  ...chunk(deps, 5).map((g) => '    ' + g.join(', ') + ','),
  '  })',
  '  const { proactiveTick, inHours, startPolling, stopPolling } = scheduler',
  '',
)

let out = L.join('\n')
if (!out.includes("from './scheduler.mjs'")) {
  const a = out.indexOf("import { createPolling } from './polling.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createScheduler } from './scheduler.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('scheduler 抽取完成')
