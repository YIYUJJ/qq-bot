/** state-db.mjs 回归测试：SQLite/JSON 回落、存取、空库判定。 运行：node lib/test-state-db.mjs */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openStateDb } from './state-store.mjs'
import { sqliteAvailable } from './store.mjs'

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

const sqlite = await sqliteAvailable()
console.log('  INFO  node:sqlite 可用：' + sqlite)

const dir = mkdtempSync(join(tmpdir(), 'qqbot-statedb-'))
try {
  const file = join(dir, sqlite ? 'state.db' : 'state.json')
  const db = await openStateDb(file)
  ok(db.backend === (sqlite ? 'sqlite' : 'json'), '后端符合预期（' + db.backend + '）')
  ok(db.isEmpty() === true, '新库为空')

  db.save({ '900001': [{ id: 'm1', at: Date.now() }] }, { total: 12, prompt: 5, completion: 7, calls: 2, byDay: {} })
  ok(db.isEmpty() === false, '写入后非空')

  const snap = db.load()
  ok(snap.replied['900001'][0].id === 'm1', 'replied 能读回')
  ok(snap.usage.total === 12, 'usage 能读回')

  db.close()

  // 重新打开：数据还在
  const db2 = await openStateDb(file)
  ok(db2.isEmpty() === false, '重启后数据仍在')
  const snap2 = db2.load()
  ok(snap2.usage.total === 12 && snap2.replied['900001'][0].id === 'm1', '重启后内容一致')
  db2.close()
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-state-db.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-state-db.mjs 通过 ${pass} 项，失败 0 项`)
