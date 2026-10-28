import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/index.js', 'utf8')
if (!s.includes('openStateDb')) {
  // import
  const a = s.indexOf("import { createStateStore } from './state-store.mjs'")
  if (a < 0) throw new Error('找不到 state-store import')
  const i = s.indexOf('\n', a) + 1
  s = s.slice(0, i) + "import { openStateDb } from './state-db.mjs'\n" + s.slice(i)

  // attach 调用
  const anchor = 'const { flushStateNow, markStateDirty, recordReplied, alreadyReplied, noteUsage, usageView } = stateStore'
  const idx = s.indexOf(anchor)
  if (idx < 0) throw new Error('找不到 stateStore 解构')
  const insertAt = s.indexOf('\n', idx) + 1
  const block = `
  // 状态库（SQLite）：可用就接管 replied/usage，不可用继续用 JSON
  void (async () => {
    try {
      const db = await openStateDb(join(DATA_DIR, 'state.db'))
      stateStore.attachDb(db)
    } catch (e) {
      log('状态库初始化失败（继续用 JSON）：' + String(e?.message || e))
    }
  })()
`
  s = s.slice(0, insertAt) + block + s.slice(insertAt)
  writeFileSync('lib/index.js', s, 'utf8')
  console.log('index 已接线状态库')
} else {
  console.log('已接线')
}
