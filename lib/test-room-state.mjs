/** room-state.mjs 回归测试：房间对象创建、去重/昵称恢复、重复获取。 运行：node lib/test-room-state.mjs */
import { ROOM_STATE_DEPS, createRoomState } from './rooms.mjs'

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

let threw = ''
try {
  createRoomState({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(ROOM_STATE_DEPS.includes('rooms'), '依赖清单')

const rooms = new Map()
const replied = { '123456789': [{ id: 'm1', at: Date.now() }] }
const savedNames = { '123456789': { '42': '张三' } }
const groupNames = new Map([['123456789', '测试群']])
const api = createRoomState({ groupNames, replied, rooms, savedNames })

// 新建房间：字段齐全
const r = api.roomState('123456789')
ok(r.roomId === '123456789' && r.roomName === '测试群', '群号/群名正确')
ok(r.isGroup === true, '9 位 id 判定为群（长度规则）')
ok(r.msgs.length === 0 && r.pending.length === 0, '初始消息为空')
ok(r.seen.has('m1'), '已回复 id 被恢复')
ok(r.nameCache.get('42') === '张三', '成员显示名被恢复')
ok(typeof r.mood === 'object' && r.mood.name === '', '带情绪字段')

// 重复获取：同一个对象
ok(api.roomState('123456789') === r, '重复获取返回同一对象')

// 短 id：按长度规则判定为非群
const p = api.roomState('12345678')
ok(p.isGroup === false, '8 位 id 判定为非群（长度规则）')

// 显式传群名：优先于缓存
const q = api.roomState('987654321', '手动群名')
ok(q.roomName === '手动群名', '显式群名优先')
ok(q.isGroup === true, '9 位 id 仍判为群')

// 已存在的房间补群名
const noName = api.roomState('888888')
ok(noName.roomName === '', '没有群名时为空')
api.roomState('888888', '后来补的群名')
ok(noName.roomName === '后来补的群名', '后续补群名生效')

console.log('')
if (fails.length) {
  console.log(`❌ test-room-state.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-room-state.mjs 通过 ${pass} 项，失败 0 项`)
