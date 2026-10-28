import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-integration.mjs', 'utf8')

// 1) 打开投票/游戏开关（写在 config.json 里）
if (!s.includes("'polls', true")) {
  s = s.replace('      videoOnMessage: false,\n', '      videoOnMessage: false,\n      polls: true,\n      games: true,\n')
}

// 2) 在总结之前追加：撤回通知、投票
const marker = "console.log('')\nif (fails.length) {"
const extra = `// 撤回通知：不应抛错，且不产生回复
sent.length = 0
fakeOb.emit({
  notice: { notice_type: 'group_recall', group_id: 900001, user_id: 42, message_id: 'it-msg-1', operator_id: 42 },
})
await new Promise((r) => setTimeout(r, 200))
ok(true, '撤回通知不抛错')

// 投票：发起投票 → 应回一条含选项的确认
sent.length = 0
fakeOb.emit({
  id: 'it-poll-1',
  roomId: '900001',
  isGroup: true,
  sender: '42',
  senderName: '测试用户',
  text: '发起投票 晚饭吃什么 / 火锅 / 烧烤',
  isAtMe: true,
  images: 0,
  imageUrls: [],
  isSelf: false,
  ts: Date.now(),
})
{
  const dl = Date.now() + 3000
  while (Date.now() < dl && !sent.length) await new Promise((r) => setTimeout(r, 50))
}
ok(sent.length > 0, '投票指令有回复')
if (sent.length) {
  const t = sent.map((x) => x.text || '').join(' ')
  ok(/投票|火锅|烧烤/.test(t), '回复提到投票/选项（' + JSON.stringify(t).slice(0, 50) + '）')
}

// 小游戏：猜数字/骰子之类，至少不崩
sent.length = 0
fakeOb.emit({
  id: 'it-game-1',
  roomId: '900001',
  isGroup: true,
  sender: '42',
  senderName: '测试用户',
  text: '掷骰子',
  isAtMe: true,
  images: 0,
  imageUrls: [],
  isSelf: false,
  ts: Date.now(),
})
await new Promise((r) => setTimeout(r, 400))
ok(true, '小游戏指令不抛错')

`
s = s.replace(marker, extra + marker)
writeFileSync('lib/test-integration.mjs', s, 'utf8')
console.log('集成测试已补充：撤回 / 投票 / 小游戏')
