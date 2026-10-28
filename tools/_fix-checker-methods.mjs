import { readFileSync, writeFileSync } from 'node:fs'

const p = 'tools/check-module-deps.mjs'
let s = readFileSync(p, 'utf8')
if (!s.includes('方法简写')) {
  s = s.replace(
    '  for (const m of src.matchAll(/^import \\{([^}]+)\\}/gm))',
    `  // 方法简写：decide(...) { / onEvent(cb) { —— 属于"声明"而不是引用
  for (const m of src.matchAll(/(?:async\\s+)?([A-Za-z_$][\\w$]*)\\s*\\(([^)]*)\\)\\s*\\{/g)) {
    known.add(m[1])
    for (const n of names(m[2])) known.add(n)
  }
  for (const m of src.matchAll(/^import \\{([^}]+)\\}/gm))`,
  )
  writeFileSync(p, s, 'utf8')
  console.log('已识别方法简写')
}
