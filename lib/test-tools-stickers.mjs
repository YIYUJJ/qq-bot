/** tools-stickers.mjs 回归测试：删除单张/批量、清理统计。 运行：node lib/test-tools-stickers.mjs */
import { stickerTools } from './tools-stickers.mjs'

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

const mk = () => ({
  a: { subType: 1, file: '/tmp/a.png' },
  b: { subType: 0 },
  c: { subType: 1, bad: true },
  d: { subType: 0, bad: true },
})

let stickers = mk()
let writes = 0
let dirties = 0
const deleted = []
const tools = stickerTools({
  stickers,
  writeJson: () => writes++,
  stickersFile: 's.json',
  markStickersDirty: () => dirties++,
  log: () => {},
  rmSync: (f) => deleted.push(f),
  existsSync: () => true,
  sweepStickerLibrary: async () => {},
  stickerDir: 'C:/stickers',
  textOut: (t) => t,
})

const [del, sweep] = tools

const r1 = await del.execute({ id: 'a' })
ok(r1.includes('已删除 a') && !('a' in stickers), '按 id 删除')
ok(deleted.includes('/tmp/a.png'), '删除时清理本地文件')
ok(writes >= 1 && dirties >= 1, '删除后写盘并标脏')

ok((await del.execute({ id: 'nope' })).includes('没有这张'), '删除不存在的 id 有提示')

const r2 = await del.execute({ what: 'bad' })
ok(r2.includes('已删除 2 张'), '批量删失效（c,d）')
ok(!('c' in stickers) && !('d' in stickers), '失效条目已移除')
ok('b' in stickers, '未失效的普通图保留')

const r3 = await del.execute({ what: 'image' })
ok(r3.includes('已删除 1 张'), '批量删普通图（b）')
ok(Object.keys(stickers).length === 0, '清空后图库为空')

ok((await del.execute({})).includes('要么给 id'), '无参数时给出用法')

const r4 = await sweep.execute({})
ok(r4.includes('图库共 0 张'), 'sweep 统计图库数量')
ok(r4.includes('C:/stickers'), 'sweep 显示目录')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-stickers.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-stickers.mjs 通过 ${pass} 项，失败 0 项`)
