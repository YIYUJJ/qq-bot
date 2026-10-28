import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-state-store.mjs', 'utf8')
if (!s.includes('attachDb 空库')) {
  const block = `
// ── SQLite 状态库（可选后端）──
const fakeDb = {
  backend: 'sqlite',
  empty: true,
  saved: [],
  loaded: null,
  isEmpty() {
    return this.empty
  },
  save(replied, usage) {
    this.saved.push({ replied: JSON.parse(JSON.stringify(replied)), usage: JSON.parse(JSON.stringify(usage)) })
    this.empty = false
  },
  load() {
    return this.loaded || { replied: {}, usage: null }
  },
}
{
  const dir2 = mkdtempSync(join(tmpdir(), 'qqbot-state-db-'))
  const replied2 = { '900001': [{ id: 'm1', at: Date.now() }] }
  const usage2 = { total: 10, prompt: 4, completion: 6, calls: 1, byDay: {} }
  const st2 = createStateStore({
    replied: replied2,
    usage: usage2,
    repliedFile: join(dir2, 'replied.json'),
    usageFile: join(dir2, 'usage.json'),
    writeJson: (f, v) => writeFileSync(f, JSON.stringify(v), 'utf8'),
    log: () => {},
    flushMs: 1e9,
  })
  const r = st2.attachDb(fakeDb)
  ok(r.ok === true && r.imported === true, 'attachDb 空库 → 导入 JSON')
  ok(fakeDb.saved.length === 1 && fakeDb.saved[0].replied['900001'], '导入内容正确')
  ok(st2.backend === 'sqlite', 'backend 反映 sqlite')

  // 写入：flush 同时写库
  st2.recordReplied('900001', 'm2')
  st2.flushStateNow()
  ok(fakeDb.saved.length === 2, 'flush 会写状态库')
  ok(fakeDb.saved[1].replied['900001'].some((x) => x.id === 'm2'), '库里有新记录')

  // 非空库：以库为准
  const replied3 = {}
  const usage3 = { total: 0, prompt: 0, completion: 0, calls: 0, byDay: {} }
  const st3 = createStateStore({
    replied: replied3,
    usage: usage3,
    repliedFile: join(dir2, 'r3.json'),
    usageFile: join(dir2, 'u3.json'),
    writeJson: () => {},
    log: () => {},
    flushMs: 1e9,
  })
  const db3 = {
    backend: 'sqlite',
    isEmpty: () => false,
    load: () => ({ replied: { '800001': [{ id: 'x1', at: Date.now() }] }, usage: { total: 77, prompt: 1, completion: 2, calls: 3, byDay: { '2026-01-01': { total: 77 } } } }),
    save: () => {},
  }
  const r3 = st3.attachDb(db3)
  ok(r3.ok === true && r3.imported === false, 'attachDb 非空库 → 以库为准')
  ok(replied3['800001'] && replied3['800001'].length === 1, 'replied 被库覆盖')
  ok(st3.usageView().total === 77, 'usage 被库覆盖')

  rmSync(dir2, { recursive: true, force: true })
}

console.log('')`
  s = s.replace("\nconsole.log('')", block)
  writeFileSync('lib/test-state-store.mjs', s, 'utf8')
  console.log('已补状态库测试')
} else {
  console.log('已存在')
}
