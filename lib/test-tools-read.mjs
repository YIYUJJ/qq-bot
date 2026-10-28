/** tools-read.mjs 回归测试：历史渲染 + 重发队列提示。 运行：node lib/test-tools-read.mjs */
import { readTools } from './tools-read.mjs'

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

const now = Date.now()
const rooms = new Map([
  [
    '900001',
    {
      roomId: '900001',
      roomName: '测试群',
      msgs: [
        { ts: now - 2000, isSelf: false, senderName: '张三', text: '在吗' },
        { ts: now - 1000, isSelf: true, senderName: 'bot', text: '在的' },
      ],
    },
  ],
])
const outbox = {
  count: 0,
  list: () => [],
}
const [history, outboxTool] = readTools({ rooms, outbox, flushOutbox: async () => {}, textOut: (t) => t })

const h = await history.execute({ room: '900001', limit: 10 })
ok(h.includes('群「测试群」最近 10 条'), '标题带群名与条数')
ok(h.includes('在吗') && h.includes('在的'), '包含消息内容')
ok(/\d{2}:\d{2}:\d{2}/.test(h), '带时间戳')

const byName = await history.execute({ room: '测试群' })
ok(byName.includes('测试群'), '按群名查找')

// 只有一个群时可以留空
ok((await history.execute({})).includes('测试群'), '单群时可省略 room')

let threw = false
try {
  await history.execute({ room: '不存在的群' })
} catch {
  threw = true
}
ok(threw, '找不到群时抛错')

ok((await outboxTool.execute({})) === '重发队列为空', '空队列提示')

const busy = {
  count: 2,
  list: () => [
    { roomId: '900001', kind: 'text', attempts: 2, preview: '你好', lastError: 'network down' },
    { roomId: '900002', kind: 'segments', attempts: 1, preview: '图片', lastError: 'timeout' },
  ],
}
let flushed = false
const [, busyTool] = readTools({ rooms, outbox: busy, flushOutbox: async () => { flushed = true }, textOut: (t) => t })
const out = await busyTool.execute({ flush: true })
ok(flushed === true, 'flush=true 时调用 flushOutbox')
ok(out.includes('待重发 2 条'), '显示待重发数量')
ok(out.includes('尝试 2 次') || out.includes('第 2 次'), '显示重试次数')
ok(out.includes('network down'), '显示最后错误')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-read.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-read.mjs 通过 ${pass} 项，失败 0 项`)
