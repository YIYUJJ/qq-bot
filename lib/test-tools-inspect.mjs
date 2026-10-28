/** tools-inspect.mjs 回归测试：系统提示词渲染 + 提醒列表。 运行：node lib/test-tools-inspect.mjs */
import { inspectTools } from './tools-inspect.mjs'

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

const rooms = new Map([['900001', { roomId: '900001', roomName: '测试群', mood: { name: '开心', at: Date.now() - 120000 } }]])
const mkRoomState = (id) => rooms.get(id) || { roomId: id, roomName: '', msgs: [] }
const cfg = { factsLimit: 30, lengthSpread: true, moodEnabled: true }
const reminders = [{ at: Date.now() + 60000, roomId: '900001', text: '喝水' }]
const writes = []

const [promptTool, remindersTool] = inspectTools({
  roomState: mkRoomState,
  systemPrompt: () => '你是小鲸鱼',
  factsOf: () => [{ text: '主人喜欢白饭' }],
  isManagedRoom: () => true,
  cfgFor: () => cfg,
  moodName: (r) => r.mood?.name || '',
  pickLineTarget: () => 2,
  textOut: (t) => t,
  reminders,
  getFeatures: () => ({ checkReminders: async () => {} }),
  writeJson: (f, v) => writes.push([f, JSON.parse(JSON.stringify(v))]),
  remindersFile: 'reminders.json',
})

const p = await promptTool.execute({ room: 'group:900001' })
ok(p.includes('测试群') && p.includes('你是小鲸鱼'), '提示词带群名和人设')
ok(p.includes('托管会话：是'), '诊断：托管会话')
ok(p.includes('记忆事实：1 条（factsLimit=30）'), '诊断：记忆条数')
ok(p.includes('心情状态：开心'), '诊断：心情')
ok(p.includes('主人喜欢白饭'), '列出记忆内容')

const list = await remindersTool.execute({ action: 'list' })
ok(list.includes('喝水') && list.includes('900001'), '提醒列表内容')

const empty = [...reminders]
reminders.length = 0
ok((await remindersTool.execute({ action: 'list' })) === '没有排队的提醒', '空提醒提示')
reminders.push(...empty)

const cleared = await remindersTool.execute({ action: 'clear' })
ok(cleared === '已清空提醒' && reminders.length === 0, 'clear 清空内存')
ok(writes.length >= 1, 'clear 写盘')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-inspect.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-inspect.mjs 通过 ${pass} 项，失败 0 项`)
