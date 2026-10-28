import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-room-state.mjs', 'utf8')
s = s.replace("const replied = { '900001': [{ id: 'm1', at: Date.now() }] }", "const replied = { '123456789': [{ id: 'm1', at: Date.now() }] }")
s = s.replace("const savedNames = { '900001': { '42': '张三' } }", "const savedNames = { '123456789': { '42': '张三' } }")
s = s.replace("const groupNames = new Map([['900001', '测试群']])", "const groupNames = new Map([['123456789', '测试群']])")
s = s.replace("const r = api.roomState('900001')", "const r = api.roomState('123456789')")
s = s.replace("ok(r.roomId === '900001' && r.roomName === '测试群', '群号/群名正确')", "ok(r.roomId === '123456789' && r.roomName === '测试群', '群号/群名正确')")
s = s.replace("ok(r.isGroup === true, '9 位群号判定为群')", "ok(r.isGroup === true, '9 位 id 判定为群（长度规则）')")
s = s.replace("ok(api.roomState('900001') === r, '重复获取返回同一对象')", "ok(api.roomState('123456789') === r, '重复获取返回同一对象')")
s = s.replace(`// 私聊：短 id 判定
const p = api.roomState('2237116031')
ok(p.isGroup === false, '10 位 id 判定为私聊（按长度规则）')`, `// 短 id：按长度规则判定为非群
const p = api.roomState('12345678')
ok(p.isGroup === false, '8 位 id 判定为非群（长度规则）')`)
s = s.replace("const q = api.roomState('999999', '手动群名')", "const q = api.roomState('987654321', '手动群名')")
s = s.replace("ok(q.isGroup === true, '9 位 id 仍判为群')", "ok(q.isGroup === true, '9 位 id 仍判为群')")
writeFileSync('lib/test-room-state.mjs', s, 'utf8')
console.log('测试改用真实长度语义')
