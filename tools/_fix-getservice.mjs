import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let s = readFileSync(p, 'utf8')
if (!s.includes('const getService = (n) => {')) {
  const anchor = s.indexOf('const handleRequest = createApiHandler({')
  if (anchor < 0) throw new Error('找不到 handler 调用')
  const def = `  const getService = (n) => {
    try {
      return (typeof ctx.get === 'function' ? ctx.get(n) : null) ?? ctx[n] ?? null
    } catch {
      return null
    }
  }
`
  s = s.slice(0, anchor) + def + '\n' + s.slice(anchor)
  writeFileSync(p, s, 'utf8')
  console.log('getService 已补到 index 作用域')
} else {
  console.log('getService 已存在')
}
