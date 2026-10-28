/** access.mjs 回归测试：白名单闸、私聊允许、必回判定。 运行：node lib/test-access.mjs */
import { ACCESS_DEPS, createAccess } from './rooms.mjs'

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
  createAccess({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('config'), '缺 config 抛错')
ok(ACCESS_DEPS.includes('getCfgFor'), '依赖清单')

const cfgFor = (id) => ({ alwaysReply: String(id) === '900002' })
const access = createAccess({
  config: { allowGroups: ['900001'], allowPrivate: ['42'], adminQQ: ['1'] },
  getCfgFor: () => cfgFor,
})

// 群
ok(access.isAllowedGroup('900001') === true, '白名单群通过')
ok(access.isAllowedGroup('999999') === false, '非白名单群拒绝')
ok(access.isAllowedGroup(900001) === true, '数字群号也能通过')

// assert
let t2 = false
try {
  access.assertGroupAllowed('999999')
} catch (e) {
  t2 = /不在白名单/.test(String(e.message))
}
ok(t2, 'assertGroupAllowed 抛错并说明白名单')

// 私聊
ok(access.allowedHere({ isGroup: true, roomId: '900001' }) === true, '群 allowedHere')
ok(access.allowedHere({ isGroup: true, roomId: '999999' }) === false, '非白名单群 allowedHere=false')
ok(access.allowedHere({ isGroup: false, roomId: '42' }) === true, '私聊白名单通过')
ok(access.allowedHere({ isGroup: false, roomId: '1' }) === true, '管理员私聊通过')
ok(access.allowedHere({ isGroup: false, roomId: '777' }) === false, '陌生私聊拒绝')

// 必回
ok(access.mustReply({ isGroup: false, roomId: '1' }, '1') === true, '管理员私聊必回')
ok(access.mustReply({ isGroup: false, roomId: '42' }, '42') === false, '普通私聊不必回')
ok(access.mustReply({ isGroup: true, roomId: '900002' }) === true, '群开了必回就必回')
ok(access.mustReply({ isGroup: true, roomId: '900001' }) === false, '群没开必回就按概率')

console.log('')
if (fails.length) {
  console.log(`❌ test-access.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-access.mjs 通过 ${pass} 项，失败 0 项`)
