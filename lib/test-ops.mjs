/** ops.mjs 回归测试：备份恢复、历史检索、日志尾巴、原子写、连接信息。 运行：node lib/test-ops.mjs */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OPS_DEPS, createOps } from './ops.mjs'

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
  createOps({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(OPS_DEPS.includes('BACKUP_DIR'), '依赖清单')

const dir = mkdtempSync(join(tmpdir(), 'qqbot-ops-'))
const dataDir = join(dir, 'data')
const backupDir = join(dataDir, 'backups')
mkdirSync(dataDir, { recursive: true })

try {
  const reloaded = []
  const ops = createOps({
    BACKUP_DIR: backupDir,
    DATA_DIR: dataDir,
    config: { allowGroups: ['900001'], adminQQ: ['1'], snowlumaHome: 'C:/SnowLuma' },
    getKeywords: () => (t) => String(t).split(/\s+/).filter(Boolean),
    log: () => {},
    getOb: () => ({ status: { connected: true, self: { user_id: 1 }, reconnects: 0 } }),
    getSoftReload: () => () => reloaded.push(1),
    version: 'test',
  })

  // writeJson 原子写
  const f = join(dataDir, 'a.json')
  ops.writeJson(f, { x: 1 })
  ok(JSON.parse(readFileSync(f, 'utf8')).x === 1, 'writeJson 写文件')

  // tailLines
  const logFile = join(dataDir, 'b.log')
  writeFileSync(logFile, ['a', 'b', 'c'].join('\n'), 'utf8')
  const tail = ops.tailLines(logFile, 2)
  ok(String(tail).includes('c'), 'tailLines 取尾部')

  // backupRestore：从备份目录恢复
  writeFileSync(join(dataDir, 'config.json'), '{"enabled":false}', 'utf8')
  mkdirSync(join(backupDir, 'bk1'), { recursive: true })
  writeFileSync(join(backupDir, 'bk1', 'config.json'), '{"enabled":true}', 'utf8')
  const r3 = ops.backupRestore('bk1')
  ok(r3.ok !== false && r3.restored >= 1, 'restore 恢复文件')
  ok(JSON.parse(readFileSync(join(dataDir, 'config.json'), 'utf8')).enabled === true, '恢复后的内容正确')

  // 不存在的备份：抛错
  let t2 = false
  try {
    ops.backupRestore('nope')
  } catch {
    t2 = true
  }
  ok(t2, '不存在的备份抛错')

  // searchHistory：无消息返回空
  const hits = await ops.searchHistory('900001', '白饭', 5)
  ok(Array.isArray(hits), 'searchHistory 返回数组')

  // connectInfo
  const info = ops.connectInfo()
  ok(typeof info === 'string' && info.includes('插件'), 'connectInfo 返回文本')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-ops.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-ops.mjs 通过 ${pass} 项，失败 0 项`)
