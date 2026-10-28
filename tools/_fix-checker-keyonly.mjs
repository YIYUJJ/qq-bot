import { readFileSync, writeFileSync } from 'node:fs'

const p = 'tools/check-module-deps.mjs'
let s = readFileSync(p, 'utf8')
if (!s.includes('keyOnly')) {
  s = s.replace(
    "  const props = new Set([...src.matchAll(/(?<![.\\w$])([A-Za-z_$][\\w$]*)\\s*:/g)].map((m) => m[1]))",
    `  // 只作为对象键出现（props）与作为值出现（uses）要区分：
  // 名字若同时被当作值使用，就不能因为\textquoteright{}它当过键\textquoteright{}而放过。
  const props = new Set()
  const uses = new Set()
  for (const m of src.matchAll(/(?<![.\\w$])([A-Za-z_$][\\w$]*)\\s*(\\:)?/g)) {
    if (m[2]) props.add(m[1])
    else uses.add(m[1])
  }
  const keyOnly = (t) => props.has(t) && !uses.has(t)`,
  )
  s = s.replace('!KW.has(t) && !props.has(t)).sort()', '!KW.has(t) && !keyOnly(t)).sort()')
  writeFileSync(p, s, 'utf8')
  console.log('已区分键/值用法')
}
