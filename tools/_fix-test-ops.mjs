import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-ops.mjs', 'utf8')

const oldBlock = s.slice(s.indexOf('  // backupRestore：备份'), s.indexOf('  // searchHistory'))
const newBlock = `  // backupRestore：从备份目录恢复
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

`
s = s.replace(oldBlock, newBlock)
s = s.replace("const hits = ops.searchHistory('900001', '白饭', 5)", "const hits = await ops.searchHistory('900001', '白饭', 5)")
writeFileSync('lib/test-ops.mjs', s, 'utf8')
console.log('ops 测试按真实签名修正')
