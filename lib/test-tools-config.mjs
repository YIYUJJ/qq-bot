/** tools-config.mjs 回归测试：每群覆盖 + 管理员指令预览。 运行：node lib/test-tools-config.mjs */
import { configTools } from './tools-config.mjs'

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

const overrides = { 900001: { replyProbability: 0.6, persona: '一只猫' } }
let resets = []
const tools = configTools({
  resetRoomOverride: (id) => resets.push(id),
  setRoomOverride: (id, patch) => {
    overrides[id] = { ...(overrides[id] || {}), ...patch }
    return { ok: true, applied: patch, rejected: {}, count: Object.keys(overrides[id]).length }
  },
  roomOverrideOf: (id) => overrides[id] || {},
  cfgFor: (id) => ({ replyProbability: 0.6, delayScale: 0.8, persona: '一只猫', ...(overrides[id] || {}) }),
  parseAdminCommand: (t) => (/说/.test(t) ? { action: 'say', target: { roomId: '900001', name: '测试群' }, text: t.split('说')[1].trim() } : /必回/.test(t) ? { action: 'alwaysReplyOn', target: { roomId: '900001', name: '测试群' } } : null),
  describeAdminAction: (a) => `会执行 ${a.action}`,
  planAdminCommand: async () => [{ action: 'say', room: '900001', text: '模型给的' }],
  normalizePlannedActions: (list) => list.map((x) => ({ action: x.action, target: { roomId: x.room, name: '测试群' } })),
  config: { adminNL: true },
  textOut: (t) => t,
})

const [roomCfg, adminCmd] = tools

// 查看
const view = await roomCfg.execute({ room: '900001' })
ok(view.includes('自定义 2 项'), '查看：显示覆盖项数')
ok(view.includes('replyProbability = 0.6'), '查看：列出覆盖键值')

// 未覆盖的群
ok((await roomCfg.execute({ room: '900002' })).includes('跟随全局'), '未覆盖时显示跟随全局')

// 设置
const set = await roomCfg.execute({ room: '900002', patch: { replyProbability: 0.2 } })
ok(set.includes('已覆盖 1 项') && set.includes('replyProbability = 0.2'), '设置：返回已覆盖项')

// 重置
const reset = await roomCfg.execute({ room: '900001', reset: true })
ok(reset.includes('恢复跟随全局') && resets.includes('900001'), '重置：调用 resetRoomOverride')

// 空 room
let threw = false
try {
  await roomCfg.execute({ room: '  ' })
} catch {
  threw = true
}
ok(threw, '空 room 抛错')

// 管理员指令：规则命中
const hit = await adminCmd.execute({ text: '在大肥鱼群说 你好' })
ok(hit.includes('规则命中') && hit.includes('测试群'), '规则命中：显示动作与目标群')

const multi = await adminCmd.execute({ text: '必回而且安静' })
ok(multi.includes('多动作') || multi.includes('规则命中'), '复合/多动作有明确提示')

// 自然语言关闭
const [_, cmdNL] = configTools({
  ...{
    resetRoomOverride: () => {},
    setRoomOverride: () => ({ ok: true, applied: {}, rejected: {}, count: 0 }),
    roomOverrideOf: () => ({}),
    cfgFor: () => ({ replyProbability: 0.2, delayScale: 1, persona: '' }),
    parseAdminCommand: () => null,
    describeAdminAction: () => '',
    planAdminCommand: async () => [],
    normalizePlannedActions: () => [],
    config: { adminNL: false },
    textOut: (t) => t,
  },
})
ok((await cmdNL.execute({ text: '随便说说' })).includes('adminNL=false'), '自然语言关闭时提示')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-config.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-config.mjs 通过 ${pass} 项，失败 0 项`)
