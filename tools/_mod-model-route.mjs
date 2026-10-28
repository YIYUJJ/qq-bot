import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

function grabFn(name) {
  const s = L.findIndex((l) => new RegExp('^(  )(async )?function ' + name + '\\(').test(l))
  if (s < 0) return false
  let depth = 0
  let started = false
  let end = s
  for (let i = s; i < L.length; i++) {
    for (const ch of L[i]) {
      if (ch === '{') {
        depth++
        started = true
      } else if (ch === '}') depth--
    }
    if (started && depth === 0) {
      end = i
      break
    }
  }
  L.splice(s, end - s + 1)
  return true
}
console.log('resolveVisionRoute', grabFn('resolveVisionRoute'))
console.log('resolveModel', grabFn('resolveModel'))

// visionRoute 仍由 index 持有（config hook 会置空），路由模块通过 get/set 操作
const anchor = L.findIndex((l) => l.includes('const { generate, analyze, keywordsOf, whoHint } = model'))
if (anchor < 0) throw new Error('找不到 model 解构')
L.splice(anchor + 1, 0,
  '',
  '  // 模型路由交给 lib/model-route.mjs',
  '  const modelRoute = createModelRoute({',
  '    config, ctx, log,',
  '    getVisionRoute: () => visionRoute,',
  '    setVisionRoute: (v) => { visionRoute = v },',
  '  })',
  '  const { resolveModel, resolveVisionRoute } = modelRoute',
)

let out = L.join('\n')
if (!out.includes("from './model-route.mjs'")) {
  const a = out.indexOf("import { createModel } from './model.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createModelRoute } from './model-route.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('model-route 抽取完成')
