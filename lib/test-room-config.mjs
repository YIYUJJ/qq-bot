/** room-config.mjs 回归测试：覆盖合并、版本缓存、安静时段、覆盖读写。 运行：node lib/test-room-config.mjs */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ROOM_CONFIG_DEPS, createRoomConfig } from './room-config.mjs'

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
  createRoomConfig({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(ROOM_CONFIG_DEPS.includes('mergeRoomConfig'), '依赖清单')

const dir = mkdtempSync(join(tmpdir(), 'qqbot-roomcfg-'))
const roomsFile = join(dir, 'rooms.json')
writeFileSync(roomsFile, JSON.stringify({ '900002': { replyProbability: 0 } }), 'utf8')

try {
  const cfg = createRoomConfig({
    config: { replyProbability: 0.5, alwaysReply: false },
    countOverrides: (o) => Object.keys(o || {}).length,
    filterRoomOverride: (patch) => {
      const applied = {}
      const rejected = {}
      for (const [k, v] of Object.entries(patch || {})) {
        if (k === 'unknownKey') rejected[k] = '未知配置项'
        else applied[k] = v
      }
      return { applied, rejected }
    },
    mergeRoomConfig: (base, ov) => ({ ...base, ...ov }),
    parseQuietWindows: (spec) => (String(spec || '').includes('23:00') ? ['quiet'] : []),
    readJson: (f, d) => {
      try {
        return JSON.parse(readFileSync(f, 'utf8'))
      } catch {
        return d
      }
    },
    roomsFile,
    writeJson: (f, v) => writeFileSync(f, JSON.stringify(v), 'utf8'),
  })

  // 覆盖合并
  ok(cfg.cfgFor('900002').replyProbability === 0, '有覆盖时用覆盖值')
  ok(cfg.cfgFor('900001').replyProbability === 0.5, '无覆盖时用全局值')
  ok(cfg.roomOverrideOf('900002').replyProbability === 0, 'roomOverrideOf 返回覆盖')

  // 版本缓存：改覆盖后 bump 生效
  cfg.setRoomOverride('900001', { replyProbability: 0.9 })
  ok(cfg.cfgFor('900001').replyProbability === 0.9, 'setRoomOverride 后生效')

  // 非法值
  const bad = cfg.setRoomOverride('900001', { unknownKey: 1 })
  ok(bad.rejected.unknownKey === '未知配置项', '未知键被拒绝')

  // 重置
  cfg.resetRoomOverride('900001')
  ok(cfg.cfgFor('900001').replyProbability === 0.5, 'reset 后回到全局')

  // 持久化 + 原地替换
  const persisted = JSON.parse(readFileSync(roomsFile, 'utf8'))
  ok(!persisted['900001'], 'reset 已从文件删除')
  const before = cfg.getRoomOverrides()
  cfg.replaceRoomOverrides({ '900003': { replyProbability: 0.1 } })
  ok(before === cfg.getRoomOverrides(), 'replace 原地生效（引用不变）')
  ok(before['900003'].replyProbability === 0.1, 'replace 内容正确')
  ok(cfg.cfgFor('900003').replyProbability === 0.1, '替换后 cfgFor 生效')

  // 安静时段缓存
  const a = cfg.quietWindowsFor('23:00-08:00')
  const b = cfg.quietWindowsFor('23:00-08:00')
  ok(a === b && Array.isArray(a), '安静时段解析有缓存')
  ok(cfg.quietWindowsFor('') !== undefined, '空 spec 也有结果')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-room-config.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-room-config.mjs 通过 ${pass} 项，失败 0 项`)
