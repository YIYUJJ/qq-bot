/** tools-media.mjs + tools-simulate.mjs 回归测试。 运行：node lib/test-tools-media.mjs */
import { videoTools } from './tools-media.mjs'
import { simulateTools } from './tools-simulate.mjs'

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

// 视频：本地/直链
const removed = []
const [video] = videoTools({
  assertGroupAllowed: () => {},
  cfgFor: () => ({ videoFrames: 6 }),
  config: { videoFrames: 6 },
  pickVideoLinks: () => [],
  buildVideoLinkNote: async () => ({ note: '链接笔记' }),
  rememberVideo: () => {},
  roomState: () => ({ msgs: [] }),
  describeVideo: async () => ({ desc: '一只猫在跑', duration: 12, files: ['/tmp/f1.jpg', '/tmp/f2.jpg'] }),
  rmSync: (f) => removed.push(f),
  textOut: (t) => t,
})

const v1 = await video.execute({ source: 'C:/tmp/a.mp4' })
ok(v1.includes('时长 12 秒') && v1.includes('一只猫在跑'), '本地视频：时长+描述')
ok(removed.length === 2, '看完清理临时帧文件')

// 视频：平台链接
const [videoLink] = videoTools({
  assertGroupAllowed: () => {},
  cfgFor: () => ({}),
  config: { videoFrames: 6 },
  pickVideoLinks: () => ['bilibili'],
  buildVideoLinkNote: async () => ({ note: '标题：某某视频', info: { duration: 100, description: 'x' } }),
  rememberVideo: () => {},
  roomState: () => ({ msgs: [] }),
  describeVideo: async () => ({}),
  rmSync: () => {},
  textOut: (t) => t,
})
ok((await videoLink.execute({ source: 'https://b23.tv/x' })).includes('标题：某某视频'), '平台链接走 yt-dlp 分支')

// 空 source
ok((await video.execute({ source: '  ' })) === '给个视频路径或链接', '空 source 提示')

// 模拟器
const injected = []
const sim = simulateTools({
  config: { allowGroups: ['900001'], allowPrivate: [], adminQQ: ['1'] },
  assertGroupAllowed: (id) => {
    if (id !== '900001') throw new Error('不在白名单')
  },
  onEvent: async (ev) => injected.push(ev),
  textOut: (t) => t,
})[0]

const r = await sim.execute({ room: 'group:900001', text: '在吗' })
ok(r.includes('已注入'), '注入成功文案')
ok(injected.length === 1 && injected[0].roomId === '900001', 'group: 前缀处理并调用 onEvent')
ok(injected[0].text === '在吗', '普通文本不变')

await sim.execute({ room: '900001', text: '看看', imageUrl: 'http://x/a.png' })
ok(injected[1].images === 1 && injected[1].imageUrls.length === 1, '图片消息字段齐全')
ok(injected[1].text.startsWith('[图片]'), '图片消息带 [图片] 标记')

await sim.execute({ room: '900001', text: '文件', fileUrl: 'http://x/a.txt', fileName: 'a.txt' })
ok(injected[2].files.length === 1 && injected[2].files[0].name === 'a.txt', '文件字段')

ok((await sim.execute({ room: '900001', text: '' })) === '需要 room 和 text', '缺参数提示')

let threw = false
try {
  await sim.execute({ room: '9999999999', text: 'hi' })
} catch {
  threw = true
}
ok(threw, '非白名单群抛错')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-media.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-media.mjs 通过 ${pass} 项，失败 0 项`)
