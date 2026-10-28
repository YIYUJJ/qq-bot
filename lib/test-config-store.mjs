/** config-store.mjs 回归测试：加载/校验/补丁/持久化/热重读。 运行：node lib/test-config-store.mjs */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createConfigStore } from './config-store.mjs'
import { DEFAULT_CONFIG, BOOLEAN, NUMERIC, LIST, CONFIG_META, validateConfig } from './schema.mjs'

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

const dir = mkdtempSync(join(tmpdir(), 'qqbot-cfg-'))
const file = join(dir, 'config.json')
const keys = Object.keys(DEFAULT_CONFIG)

function make(hooks = {}, rawConfig = null) {
  const store = createConfigStore({
    file,
    defaults: DEFAULT_CONFIG,
    validateConfig,
    keys,
    booleanSet: BOOLEAN,
    numericSet: NUMERIC,
    listSet: LIST,
    meta: CONFIG_META,
    log: () => {},
    hooks,
  })
  if (rawConfig) store.load(rawConfig)
  else store.load(null)
  return store
}

try {
  // 1) 默认值
  const a = make()
  ok(a.config.enabled === DEFAULT_CONFIG.enabled, '默认值加载')
  ok(Array.isArray(a.config.allowGroups), '列表已归一')

  // 2) 布尔/数字/列表补丁
  const applied = a.applyConfigPatch({ enabled: 'true', replyProbability: '0.7', allowGroups: 'group:111,222' })
  ok(applied.ok === true, '补丁成功')
  ok(a.config.enabled === true, '布尔字符串转 true')
  ok(Math.abs(a.config.replyProbability - 0.7) < 1e-9, '数字字符串转数字')
  ok(JSON.stringify(a.config.allowGroups) === JSON.stringify(['111', '222']), '列表拆分 + group: 前缀清理')

  // 3) 未知键拒绝
  const bad = a.applyConfigPatch({ notAKey: 1 })
  ok(bad.rejected.notAKey === '未知配置项', '未知键被拒绝')

  // 4) 非数字拒绝
  const badNum = a.applyConfigPatch({ replyProbability: 'abc' })
  ok(badNum.rejected.replyProbability === '需要数字', '非数字被拒绝')

  // 5) 越界夹取（按 meta min/max）
  const clamped = a.applyConfigPatch({ replyProbability: 99 })
  ok(a.config.replyProbability <= 1, '越界值被夹到上限')

  // 6) 写盘
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  ok(saved.enabled === true, '配置已写入文件')

  // 7) 热重读：外部改文件
  const disk = JSON.parse(readFileSync(file, 'utf8'))
  disk.replyProbability = 0.42
  writeFileSync(file, JSON.stringify(disk, null, 2), 'utf8')
  const r = a.rereadConfigFromDisk()
  ok(r.ok === true && r.changed.includes('replyProbability'), '热重读检测到变化')
  ok(Math.abs(a.config.replyProbability - 0.42) < 1e-9, '热重读应用新值')

  // 8) hooks 调用
  const calls = []
  const b = make({
    onVisionRouteDirty: () => calls.push('vision'),
    onPushRestart: () => calls.push('push'),
    onPollRestart: () => calls.push('poll'),
    onQuietChanged: () => calls.push('quiet'),
    bumpCfg: () => calls.push('bump'),
  })
  b.applyConfigPatch({ visionModel: 'x' })
  ok(calls.includes('vision') && calls.includes('quiet') && calls.includes('bump'), 'hooks：视觉/安静/缓存')
  calls.length = 0
  b.applyConfigPatch({ pollMs: 1234 })
  ok(calls.includes('poll'), 'hooks：轮询重启')
  calls.length = 0
  b.applyConfigPatch({ pushPort: 3102 })
  ok(calls.includes('push'), 'hooks：推送重启')

  // 9) 空补丁
  const empty = b.applyConfigPatch({})
  ok(empty.ok === true && Object.keys(empty.applied).length === 0, '空补丁返回 ok')

  // 10) 文件损坏：不影响启动
  writeFileSync(file, '{broken', 'utf8')
  const c = make()
  ok(c.config.enabled === DEFAULT_CONFIG.enabled, '文件损坏时回退默认值')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-config-store.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-config-store.mjs 通过 ${pass} 项，失败 0 项`)
