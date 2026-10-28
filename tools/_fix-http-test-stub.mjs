import { readFileSync, writeFileSync } from 'node:fs'

let t = readFileSync('lib/test-http-api.mjs', 'utf8')
t = t.replace(
  "const d2 = Object.fromEntries(API_DEPS.map((k) => [k, undefined]))",
  "const stub = () => {}\n  const d2 = Object.fromEntries(API_DEPS.map((k) => [k, stub]))",
)
// 对象型依赖补默认值，避免 op 之外的初始化用到
t = t.replace(
  "    outbox: { count: 0, items: [] },",
  "    outbox: { count: 0, items: [] },\n    facts: {},\n    replied: {},\n    usage: { total: 0, calls: 0, byDay: {} },\n    stickers: {},",
)
writeFileSync('lib/test-http-api.mjs', t, 'utf8')
console.log('测试 deps 改用 stub')
