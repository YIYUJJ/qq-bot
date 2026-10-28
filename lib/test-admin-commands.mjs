/** admin-commands.mjs 回归测试：房间解析、意图识别、归一化白名单。 运行：node lib/test-admin-commands.mjs */
import { createAdminCommands } from './admin-commands.mjs'

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
  ['975427049', { roomId: '975427049', roomName: '大肥鱼' }],
  ['1057903376', { roomId: '1057903376', roomName: '测试群' }],
])
const groupNames = new Map([['975427049', '大肥鱼']])
const config = { adminMaxActions: 2 }
const ac = createAdminCommands({ rooms, groupNames, config })

// 房间解析
ok(ac.findRoomByText('在 975427049 说一句：你好')?.roomId === '975427049', '按群号解析')
ok(ac.findRoomByText('去大肥鱼群说一句：你好')?.roomId === '975427049', '按群名解析')
ok(ac.findRoomByText('随便说说') === null, '没有群时返回 null')

// 意图
ok(ac.detectIntents('必回').includes('alwaysReplyOn'), '识别必回开')
ok(ac.detectIntents('取消必回').includes('alwaysReplyOff'), '识别必回关')
ok(ac.detectIntents('安静一会').includes('mute'), '识别静音')
ok(ac.detectIntents('恢复说话').includes('unmute'), '识别解除静音')
ok(ac.detectIntents('必回而且安静').length === 2, '复合指令识别出两个意图')

// 解析
const p1 = ac.parseAdminCommand('在大肥鱼群说：今天吃什么')
ok(p1?.action === 'say' && p1.text === '今天吃什么', 'say 解析出文本')
const p2 = ac.parseAdminCommand('大肥鱼群静音 30 分钟')
ok(p2?.action === 'mute' && p2.minutes === 30, 'mute 解析出分钟')
const p3 = ac.parseAdminCommand('大肥鱼群人设改成 一只猫')
ok(p3?.action === 'persona' && /一只猫/.test(p3.value), 'persona 解析出人设')
ok(ac.parseAdminCommand('必回而且安静')?.action === 'multi', '复合指令返回 multi')
ok(ac.parseAdminCommand('今天天气不错') === null, '无指令返回 null')

// 描述
ok(/发送/.test(ac.describeAdminAction(p1)), 'say 描述可读')
ok(/静音 30 分钟/.test(ac.describeAdminAction(p2)), 'mute 描述带分钟')

// 归一化（白名单 / 截断 / 范围）
// 注意：先按 adminMaxActions 截断，再过滤非法动作（现有行为，测试锁定它）
const norm = ac.normalizePlannedActions([
  { action: 'delete', room: '975427049' },
  { action: 'say', room: 'group:975427049', text: 'hi' },
])
ok(norm.length === 1, '非法 action 被丢弃')
ok(norm[0].target.roomId === '975427049', 'group: 前缀被去掉')
const normMute = ac.normalizePlannedActions([{ action: 'mute', room: '975427049', minutes: 9999 }])
ok(normMute[0].minutes === 720, '静音分钟数被夹到 720')
const longText = 'x'.repeat(900)
const norm2 = ac.normalizePlannedActions([{ action: 'say', room: '975427049', text: longText }])
ok(norm2[0].text.length === 500, '文本被截断到 500')
ok(ac.normalizePlannedActions('not-an-array').length === 0, '非数组输入返回空')

console.log('')
if (fails.length) {
  console.log(`❌ test-admin-commands.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-admin-commands.mjs 通过 ${pass} 项，失败 0 项`)
