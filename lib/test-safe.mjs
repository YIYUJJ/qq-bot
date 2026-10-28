/** 统一错误边界回归测试：safe / safeAsync / wrapTool / installProcessGuards / errorRing。 运行：node lib/test-safe.mjs */
import { safe, safeAsync, wrapTool, installProcessGuards, errorRing, recentErrors } from './safe.mjs'

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

// 1) safe 同步：抛错被吞掉，返回值 undefined
const boom = safe('sync', () => {
  throw new Error('sync-boom')
})
let threw = false
try {
  const r = boom()
  ok(r === undefined, 'safe 同步异常不抛出、返回 undefined')
} catch {
  threw = true
}
ok(!threw, 'safe 同步异常确实没冒出来')
ok(errorRing.some((e) => e.message === 'sync-boom'), 'errorRing 记录了同步异常')

// 2) safe 异步：reject 被吞掉
const asyncBoom = safe('async', async () => {
  throw new Error('async-boom')
})
const r2 = await asyncBoom()
ok(r2 === undefined, 'safe 异步 reject 不抛出')
await new Promise((r) => setTimeout(r, 20))
ok(errorRing.some((e) => e.message === 'async-boom'), 'errorRing 记录了异步异常')

// 3) safeAsync：正常值原样返回
const good = await safeAsync('ok', async () => 42)
ok(good === 42, 'safeAsync 正常返回不改变结果')
const bad = await safeAsync('bad', async () => {
  throw new Error('bad-boom')
})
ok(bad === undefined, 'safeAsync 异常返回 undefined')

// 4) wrapTool：execute 抛错 → 返回人话，不抛
const tool = wrapTool({
  name: 'demo',
  execute: async () => {
    throw new Error('tool-boom')
  },
})
const msg = await tool.execute({})
ok(/执行失败/.test(msg) && /tool-boom/.test(msg), 'wrapTool 把异常转成错误文本')
const toolOk = wrapTool({ name: 'ok', execute: async (a) => 'hi ' + a.x })
ok((await toolOk.execute({ x: 'there' })) === 'hi there', 'wrapTool 正常值不被改写')

// 5) installProcessGuards 只装一次
const first = installProcessGuards((m) => console.log('  (log) ' + m))
const second = installProcessGuards()
ok(first === true, '首次安装进程兜底')
ok(second === false, '重复安装被忽略（热重载不叠加监听）')

// 6) recentErrors 条数限制
const recent = recentErrors(2)
ok(recent.length <= 2, 'recentErrors 最多返回 N 条')

console.log('')
if (fails.length) {
  console.log(`\n❌ test-safe.mjs 失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-safe.mjs 通过 ${pass} 项`)
