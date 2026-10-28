import { readFileSync, writeFileSync } from 'node:fs'

const modFile = 'lib/on-event.mjs'
let m = readFileSync(modFile, 'utf8')
const depName = 'CREATEONEVENT_DEPS'
let deps = JSON.parse(m.match(new RegExp(depName + ' = (\\[[^\\]]*\\])'))[1])

const imports = {
  existsSync: "import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'",
  mkdirSync: null,
  rmSync: null,
  writeFileSync: null,
  join: "import { join } from 'node:path'",
  extractDocText: "import { resolveDocPython, extractDocText } from './extras.mjs'",
  resolveDocPython: null,
  newTraceId: "import { newTraceId } from './metrics.mjs'",
}
const selfNames = new Set(['createOnEvent', 'onEvent'])
const importNames = new Set(Object.keys(imports))

deps = deps.filter((d) => !selfNames.has(d) && !importNames.has(d))
deps.sort()

// 插入 import（放在文件头注释后）
const needed = [...new Set(Object.values(imports).filter(Boolean))]
for (const line of needed) {
  if (!m.includes(line)) {
    const idx = m.indexOf('export const')
    m = m.slice(0, idx) + line + '\n' + m.slice(idx)
  }
}

m = m.replace(new RegExp(depName + ' = \\[[^\\]]*\\]'), depName + ' = ' + JSON.stringify(deps))
m = m.replace(/const \{[^}]*\} = deps/, 'const { ' + deps.join(', ') + ' } = deps')
writeFileSync(modFile, m, 'utf8')

// 更新 index 工厂参数
let i = readFileSync('lib/index.js', 'utf8')
const start = i.indexOf('const onEvent = createOnEvent({')
const end = i.indexOf('})', start)
const chunk = (list, size) => {
  const out = []
  for (let k = 0; k < list.length; k += size) out.push(list.slice(k, k + size))
  return out
}
const call = 'const onEvent = createOnEvent({\n' + chunk(deps, 5).map((g) => '    ' + g.join(', ') + ',').join('\n') + '\n  })'
i = i.slice(0, start) + call + i.slice(end + 2)
writeFileSync('lib/index.js', i, 'utf8')
console.log('on-event 依赖已修正：', deps.length, '项')
