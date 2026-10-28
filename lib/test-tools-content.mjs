/** tools-content.mjs 回归测试：日记查看 + 识图两种入口。 运行：node lib/test-tools-content.mjs */
import { contentTools } from './tools-content.mjs'

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

const rooms = new Map([
  ['900001', { roomId: '900001', roomName: '测试群', msgs: [{ ts: Date.now(), senderName: '张三', vision: ['一只猫', '橘色'] }] }],
  ['900002', { roomId: '900002', roomName: '另一个群', msgs: [{ ts: Date.now(), senderName: '李四' }] }],
])
let diaryRan = false
const mk = (over = {}) =>
  contentTools({
    getFeatures: () => ({ maybeDiary: async () => { diaryRan = true } }),
    isManagedRoom: (id) => id === '900001',
    memDirOf: (id) => (id === '900001' ? 'mem/900001' : ''),
    readDiary: () => '今天吃了白饭',
    readSelf: () => '我是一只鲸鱼',
    rooms,
    describeImage: async (url) => (url.includes('bad') ? '' : '一张猫的图片'),
    config: { allowGroups: ['900001'] },
    assertGroupAllowed: () => {},
    roomState: (id) => rooms.get(id) || { msgs: [] },
    textOut: (t) => t,
    ...over,
  })

const [diary, vision] = mk()

// 日记 run
ok((await diary.execute({ action: 'run' })).includes('日记任务跑完了'), 'run 触发写日记')
ok(diaryRan === true, '确实调用了 maybeDiary')

// 日记 read（指定群）
const read = await diary.execute({ action: 'read', room: 'group:900001' })
ok(read.includes('今天吃了白饭') && read.includes('我是一只鲸鱼'), 'read 显示日记与自述')

// 未托管
ok((await diary.execute({ action: 'read', room: '900002' })).includes('不在托管名单'), '未托管会话提示')

// 不传 room：列托管群
const all = await diary.execute({ action: 'read' })
ok(all.includes('测试群'), '列出托管群的日记摘要')
ok(!all.includes('另一个群'), '未托管群不出现')

// 识图：URL 入口
const v1 = await vision.execute({ url: 'http://x/a.png' })
ok(v1.includes('一张猫的图片'), 'URL 识图返回描述')

const [, visionNoDesc] = mk({ describeImage: async () => '' })
ok((await visionNoDesc.execute({ url: 'http://x/bad.png' })).includes('没拿到描述'), '识图失败提示')

// 识图：最近一条带图消息
const v2 = await vision.execute({})
ok(v2.includes('最近一条带图消息') && v2.includes('一只猫'), '最近带图消息描述')

const [, visionEmpty] = mk({ roomState: () => ({ msgs: [] }) })
ok((await visionEmpty.execute({})).includes('最近没有带图的消息'), '没有带图消息时提示')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-content.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-content.mjs 通过 ${pass} 项，失败 0 项`)
