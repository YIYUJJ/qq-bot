/** store.mjs 回归测试：原子写、串行队列、单实例锁、SQLite 回落。 运行：node lib/test-store.mjs */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { atomicWriteJson, readJsonSafe, createJsonStore, acquireInstanceLock, enqueueWrite, createKvStore, sqliteAvailable } from './store.mjs'

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

const dir = mkdtempSync(join(tmpdir(), 'qqbot-store-'))
try {
  // 1) 原子写：内容正确、无残留 tmp
  const f1 = join(dir, 'a.json')
  ok(atomicWriteJson(f1, { x: 1 }) === true, 'atomicWriteJson 返回成功')
  ok(readJsonSafe(f1, null)?.x === 1, '写进去的内容可读')
  ok(!existsSync(f1 + '.' + process.pid + '.tmp'), '没有残留临时文件')

  // 2) 坏文件不抛错，返回 fallback
  const f2 = join(dir, 'bad.json')
  writeFileSync(f2, '{not json', 'utf8')
  ok(readJsonSafe(f2, { ok: true })?.ok === true, '坏 JSON 返回 fallback 而不是抛错')

  // 3) 串行写队列：后写覆盖先写，最终值正确
  const f3 = join(dir, 'q.json')
  await Promise.all([
    enqueueWrite(f3, () => atomicWriteJson(f3, { v: 1 })),
    enqueueWrite(f3, () => atomicWriteJson(f3, { v: 2 })),
    enqueueWrite(f3, () => atomicWriteJson(f3, { v: 3 })),
  ])
  ok(readJsonSafe(f3, null)?.v === 3, '串行队列保持写入顺序')

  // 4) createJsonStore：replace 后能读到新值，flushSync 立即落盘
  const f4 = join(dir, 'store.json')
  const store = createJsonStore(f4, { defaultValue: { a: 1 } })
  ok(store.read().a === 1, 'store 初始化读默认值')
  await store.replace({ a: 2 })
  ok(store.read().a === 2, 'replace 后内存值更新')
  ok(JSON.parse(readFileSync(f4, 'utf8')).a === 2, 'replace 后已落盘')

  // 5) 单实例锁：第二次抢锁失败，释放后可再抢
  const lockFile = join(dir, 'inst.lock')
  const l1 = acquireInstanceLock(lockFile, { label: 'test' })
  ok(l1.ok === true, '第一次抢锁成功')
  const l2 = acquireInstanceLock(lockFile)
  ok(l2.ok === false, '同进程第二次抢锁被拒（文件存在视为占用）')
  l1.release()
  const l3 = acquireInstanceLock(lockFile)
  ok(l3.ok === true, '释放后可以再次抢到')
  l3.release()

  // 6) 死锁接管：写一个不存在的 pid，应该能接管
  writeFileSync(lockFile, JSON.stringify({ pid: 999999, at: Date.now() }), 'utf8')
  const l4 = acquireInstanceLock(lockFile)
  ok(l4.ok === true, '死进程留下的锁被接管')
  l4.release()

  // 7) KV store：接口一致（sqlite 或 json 回落都行）
  const kv = await createKvStore(join(dir, 'kv.db'))
  kv.set('a', { v: 1 })
  ok(kv.get('a')?.v === 1, 'KV set/get')
  kv.set('a', { v: 2 })
  ok(kv.get('a')?.v === 2, 'KV 覆盖写')
  ok(kv.keys().includes('a'), 'KV keys')
  kv.del('a')
  ok(kv.get('a') === undefined, 'KV del')
  kv.close()
  console.log('  (kv backend: ' + (await sqliteAvailable() ? 'sqlite' : 'json 回落') + ')')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-store.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-store.mjs 通过 ${pass} 项，失败 0 项`)
