/** backup.mjs 回归测试：备份/保留/软重载/重启脚本生成。 运行：node lib/test-backup.mjs */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BACKUP_DEPS, createBackup } from './ops.mjs'

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
  createBackup({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(BACKUP_DEPS.includes('BACKUP_DIR'), '依赖清单')

const dir = mkdtempSync(join(tmpdir(), 'qqbot-bak-'))
const dataDir = join(dir, 'data')
const backupDir = join(dataDir, 'backups')
mkdirSync(dataDir, { recursive: true })
writeFileSync(join(dataDir, 'config.json'), '{"enabled":true}', 'utf8')
writeFileSync(join(dataDir, 'replied.json'), '{"x":1}', 'utf8')

try {
  const logs = []
  const reloads = []
  const overrides = []
  const facts = { a: [1] }
  const deps = {
    BACKUP_DIR: backupDir,
    BACKUP_STATE_FILE: join(dataDir, 'backup-state.json'),
    CONFIG_FILE: join(dataDir, 'config.json'),
    CONFIG_KEYS: ['enabled'],
    DATA_DIR: dataDir,
    POLLS_FILE: join(dataDir, 'polls.json'),
    REMINDERS_FILE: join(dataDir, 'reminders.json'),
    ROOMS_FILE: join(dataDir, 'rooms.json'),
    bumpCfg: () => reloads.push('bump'),
    config: { backupKeep: 2, enabled: true },
    facts,
    log: (m) => logs.push(m),
    polls: {},
    readJson: (f, d) => {
      try {
        return JSON.parse(readFileSync(f, 'utf8'))
      } catch {
        return d
      }
    },
    reminders: [],
    roomTextCache: { clear: () => reloads.push('cache') },
    setRoomOverrides: (o) => overrides.push(o),
    getSleep: () => async () => {},
    writeJson: (f, v) => writeFileSync(f, JSON.stringify(v), 'utf8'),
  }
  const api = createBackup(deps)

  // backupNow
  const r1 = api.backupNow()
  ok(r1.items >= 2, '备份复制了文件')
  ok(existsSync(join(backupDir, r1.name, 'config.json')), '备份目录里有配置文件')

  // backupList
  const list = api.backupList()
  ok(Array.isArray(list) && list.length >= 1, 'backupList 列出备份')

  // pruneBackups 保留 2 份
  api.backupNow()
  api.backupNow()
  const kept = api.pruneBackups()
  ok(kept.length <= 2, '保留 N 份')

  // softReload：清缓存 + 重读配置
  const okReload = api.softReload()
  ok(okReload === true, 'softReload 返回 true')
  ok(reloads.includes('bump') && reloads.includes('cache'), 'softReload 触发缓存清理')
  ok(Object.keys(facts).length === 0, 'softReload 清空事实缓存')

  // restartDsh：生成脚本
  api.restartDsh()
  const script = join(dataDir, 'restart-dsh.ps1')
  ok(existsSync(script), '重启脚本已生成')
  ok(readFileSync(script, 'utf8').includes('taskkill'), '脚本内容包含 taskkill')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-backup.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-backup.mjs 通过 ${pass} 项，失败 0 项`)
