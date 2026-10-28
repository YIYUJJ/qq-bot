/** tools-actions.mjs 回归测试：拍一拍 + 联网搜索的边界。 运行：node lib/test-tools-actions.mjs */
import { actionTools } from './tools-actions.mjs'

let pass = 0
const fails = []
const ok = (c, n) => {
  if (c) {
    pass += 1
    console.log('  PASS  ' + n)
  } else {
    fails.push(n)
    console.log('  FAIL  ' + n)
  }
}

const pokes = []
const searches = []
let allow = true
const tools = actionTools({
  assertGroupAllowed: (id) => {
    if (!allow) throw new Error('群不在白名单：' + id)
  },
  config: { dryRun: false, searchTimeoutMs: 8000 },
  ob: { sendPoke: async (p) => pokes.push(p) },
  sensitiveQuery: (q) => (/密码|身份证/.test(q) ? '包含敏感信息' : ''),
  webSearch: async (q, n, t) => {
    searches.push({ q, n, t })
    return { count: 2, text: '- 结果一\n- 结果二' }
  },
  textOut: (t) => t,
})

const [poke, search] = tools

const r1 = await poke.execute({ room: 'group:900001', user: '42' })
ok(r1.includes('已拍 42'), '拍一拍成功文案')
ok(pokes.length === 1 && pokes[0].groupId === '900001', 'group: 前缀被去掉并调用 sendPoke')

allow = false
let threw = false
try {
  await poke.execute({ room: '999999', user: '42' })
} catch {
  threw = true
}
ok(threw, '非白名单群抛错（不发送）')
allow = true

threw = false
try {
  await poke.execute({ room: '900001', user: '  ' })
} catch {
  threw = true
}
ok(threw, 'user 为空抛错')

const [, searchDry] = actionTools({
  assertGroupAllowed: () => {},
  config: { dryRun: true, searchTimeoutMs: 8000 },
  ob: { sendPoke: async () => {} },
  sensitiveQuery: () => '',
  webSearch: async () => ({ count: 0, text: '' }),
  textOut: (t) => t,
})
ok((await searchDry.execute({ query: '天气' })).includes('搜索「天气」'), '搜索正常路径')

const r2 = await search.execute({ query: '我的密码是多少' })
ok(r2.startsWith('没搜：'), '敏感词不搜')
ok(searches.length === 0, '敏感词不会发起搜索')

const r3 = await search.execute({ query: 'deepseek', count: 99 })
ok(r3.includes('2 条') && r3.includes('结果一'), '搜索结果格式化')
ok(searches[0].n === 10, 'count 被夹到 10')

threw = false
try {
  await search.execute({ query: '  ' })
} catch {
  threw = true
}
ok(threw, '空 query 抛错')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-actions.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-actions.mjs 通过 ${pass} 项，失败 0 项`)
