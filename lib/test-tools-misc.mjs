/** tools-misc.mjs 回归测试：发表情 + 备份动作。 运行：node lib/test-tools-misc.mjs */
import { miscTools } from './tools-misc.mjs'

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

const stickers = {
  good: { url: 'http://x/a.png', uses: 3 },
  bad: { url: 'http://x/b.png', bad: true, uses: 0 },
}
const sent = []
const mk = (over = {}) =>
  miscTools({
    assertGroupAllowed: (id) => {
      if (id !== '900001') throw new Error('不在白名单')
    },
    stickers,
    config: { dryRun: false },
    sendStickerTo: async (room, s, key) => {
      sent.push([room, key])
      return { ok: true }
    },
    backupTick: () => {},
    readJson: () => ({}),
    backupStateFile: 'state.json',
    backupNow: () => ({ name: 'bk-1', items: 5 }),
    backupRestore: (name) => ({ name, restored: 5 }),
    backupList: () => ['bk-1', 'bk-2'],
    textOut: (t) => t,
    ...over,
  })

const [sendTool, backupTool] = mk()

// 发表情
const r1 = await sendTool.execute({ room: 'group:900001', id: 'good' })
ok(r1.includes('已发到 900001') && sent.length === 1, '指定 id 发送')
ok(sent[0][1] === 'good', '发送的是指定的那张')

// 失效/不存在
let threw = false
try {
  await sendTool.execute({ room: '900001', id: 'bad' })
} catch {
  threw = true
}
ok(threw, '失效表情抛错')

threw = false
try {
  await sendTool.execute({ room: '900001', id: 'nope' })
} catch {
  threw = true
}
ok(threw, '不存在的 id 抛错')

// 空图库
const [emptySend] = mk({ stickers: {} })
threw = false
try {
  await emptySend.execute({ room: '900001' })
} catch {
  threw = true
}
ok(threw, '空图库抛错')

// 演练
const [drySend] = mk({ config: { dryRun: true } })
ok((await drySend.execute({ room: '900001', id: 'good' })).includes('[演练]'), '演练不发送')

// 备份
ok((await backupTool.execute({ action: 'now' })).includes('bk-1'), 'now 备份')
ok((await backupTool.execute({ action: 'restore', name: 'bk-2' })).includes('bk-2'), 'restore 指定备份')
ok((await backupTool.execute({ action: 'list' })).includes('bk-2'), 'list 列出备份')
ok((await backupTool.execute({ action: 'auto' })).includes('已检查'), 'auto 检查')

// 备份失败兜底
const [, brokenBackup] = mk({ backupNow: () => { throw new Error('disk full') } })
ok((await brokenBackup.execute({ action: 'now' })).includes('失败：disk full'), '备份异常转文案')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-misc.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-misc.mjs 通过 ${pass} 项，失败 0 项`)
