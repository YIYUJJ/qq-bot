/** 每群性格覆盖的回归测试：合并、白名单边界、计数。 运行：node lib/test-roomcfg.mjs */
import { ROOM_KEYS, mergeRoomConfig, filterRoomOverride, countOverrides, ROOM_KEY_SET } from './roomcfg.mjs'

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

const base = {
  enabled: true,
  allowGroups: ['1'],
  provider: 'deepseek-account',
  replyProbability: 0.35,
  persona: '全局人设',
  delayScale: 0.35,
  quietHours: '',
  visionOnImage: true,
}

console.log('== 每群覆盖 ==')

const merged = mergeRoomConfig(base, { persona: '本群人设', replyProbability: 0.8 })
ok(merged.persona === '本群人设', '覆盖项生效（人设）')
ok(merged.replyProbability === 0.8, '覆盖项生效（概率）')
ok(merged.delayScale === 0.35, '未覆盖项继承全局')
ok(merged.enabled === true && merged.allowGroups[0] === '1', '全局配置没有被破坏')

ok(mergeRoomConfig(base, null) === base, '没有覆盖时直接复用全局对象（不拷贝）')
ok(mergeRoomConfig(base, {}) .persona === '全局人设', '空覆盖等于全继承')

// 安全边界：危险键不能被覆盖
const bad = filterRoomOverride({ enabled: false, allowGroups: ['9'], provider: 'x', replyProbability: 0.9 })
ok(bad.ok === false, '含危险键时 ok=false')
ok(bad.applied.replyProbability === 0.9, '合法键仍然通过')
ok('enabled' in bad.rejected && 'allowGroups' in bad.rejected && 'provider' in bad.rejected, '总开关/白名单/模型被拒绝')
ok(!('snowlumaHome' in mergeRoomConfig(base, { snowlumaHome: '/tmp' })), '危险键不会被合并进去')
ok(mergeRoomConfig(base, { enabled: false }).enabled === true, '危险键合并后被忽略')

// 计数
ok(countOverrides({}) === 0, '空覆盖计 0')
ok(countOverrides({ persona: 'x', delayScale: 0 }) === 2, '计数按允许键算（0 也算已覆盖）')
ok(countOverrides({ nope: 1 }) === 0, '非法键不计数')

// 白名单本身
ok(ROOM_KEYS.includes('persona') && ROOM_KEYS.includes('replyProbability'), '核心键在白名单里')
ok(!ROOM_KEY_SET.has('enabled') && !ROOM_KEY_SET.has('allowGroups') && !ROOM_KEY_SET.has('snowlumaHome'), '危险键不在白名单')

console.log('')
console.log(`通过 ${pass} 项，失败 ${fails.length} 项`)
if (fails.length) {
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log('每群覆盖回归全部通过 ✅')
