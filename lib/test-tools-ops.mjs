/** tools-ops.mjs 回归测试：配置读写、重载、自启、重启。 运行：node lib/test-tools-ops.mjs */
import { opsTools } from './tools-ops.mjs'

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

const config = { enabled: false, replyProbability: 0.2, allowGroups: ['900001'] }
const logs = []
let reloaded = 0
let relaunched = 0
const [cfgTool, reloadTool, autoTool, restartTool] = opsTools({
  config,
  applyConfigPatch: (patch) => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in config)) return { ok: false, applied: {}, rejected: { [k]: '未知配置项' } }
      config[k] = k === 'replyProbability' ? Number(v) : v === 'true' ? true : v
    }
    return { ok: true, applied: patch, rejected: {} }
  },
  log: (m) => logs.push(m),
  rereadConfigFromDisk: () => ({ changed: ['enabled'] }),
  reloadSelf: () => {
    reloaded += 1
    return { ok: true, inMs: 900 }
  },
  setAutostart: (on) => ({ enabled: on, file: 'startup/qqbot.cmd' }),
  isAutostartEnabled: () => true,
  autostartFile: () => 'startup/qqbot.cmd',
  restartDsh: () => {
    relaunched += 1
    return { etaMs: 5000, script: 'restart.ps1' }
  },
  textOut: (t) => t,
})

// 读全部
const all = await cfgTool.execute({})
ok(all.includes('enabled = false') && all.includes('allowGroups = 900001'), '不带 key 返回全部配置')

// 读单个
ok((await cfgTool.execute({ key: 'enabled' })) === 'enabled = false', '按 key 读值')

// 写
const w = await cfgTool.execute({ key: 'replyProbability', value: '0.6' })
ok(w.includes('已生效') && config.replyProbability === 0.6, '写配置生效并返回文案')
ok(logs.some((l) => l.includes('配置变更')), '写配置记日志')

// 写未知键
let threw = false
try {
  await cfgTool.execute({ key: 'nope', value: '1' })
} catch {
  threw = true
}
ok(threw, '未知键抛错')

// 重载
ok((await reloadTool.execute({ configOnly: true })).includes('变化 enabled'), 'configOnly 重读配置')
const r = await reloadTool.execute({})
ok(r.includes('900ms') && reloaded === 1, '完整重载触发')

// 自启
ok((await autoTool.execute({ action: 'get' })).includes('已开启'), '自启状态查询')
ok((await autoTool.execute({ action: 'set', enabled: false })).includes('已关闭'), '自启开关')

// 重启
const rs = await restartTool.execute({})
ok(rs.includes('5 秒') && relaunched === 1, '重启请求文案')

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-ops.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-ops.mjs 通过 ${pass} 项，失败 0 项`)
