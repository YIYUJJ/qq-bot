/** 记忆淘汰 / BM25 / 相对时间 回归测试。 运行：node lib/test-memory-evict.mjs */
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeRoomFacts, readRoomMemory, bm25Scores, readJsonSafe } from './memory.mjs'
import { agoText } from './prompt.mjs'

let pass = 0
const fails = []
const ok = (c, n) => {
  if (c) { pass += 1; console.log('  PASS  ' + n) } else { fails.push(n); console.log('  FAIL  ' + n) }
}

const dir = mkdtempSync(join(tmpdir(), 'qqbot-evict-'))
try {
  // 最老的一条重要度 5，其余都是 2：超出上限时它应该留下
  const list = [{ text: '老但重要：生日', at: 1, importance: 5 }]
  for (let i = 0; i < 40; i++) list.push({ text: '闲聊' + i, at: 100 + i })
  const r = writeRoomFacts(dir, list, { keep: 30 })
  const kept = readRoomMemory(dir).facts
  ok(r.kept === 30 && r.archived === 11, '超出上限归档多余的')
  ok(kept.some((x) => x.text === '老但重要：生日'), '重要度高的老事实不被挤掉')
  ok(!kept.some((x) => x.text === '闲聊0'), '重要度低的最老事实先归档')
  const arch = readFileSync(join(dir, 'archive.jsonl'), 'utf8').trim().split('\n')
  ok(arch.length === 11, '归档文件条数正确')

  // 损坏的 JSON 留副本
  const bad = join(dir, 'bad.json')
  writeFileSync(bad, '{ broken', 'utf8')
  ok(readJsonSafe(bad, 'fb') === 'fb', '损坏 JSON 返回 fallback')
  const { readdirSync } = await import('node:fs')
  ok(readdirSync(dir).some((f) => f.startsWith('bad.json.corrupt-')), '损坏文件留了副本')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// BM25
const s = bm25Scores('小明的猫', ['小明养了一只猫', '今天天气不错', '小明喜欢猫和狗'])
ok(s[0] > 0 && s[2] > 0 && s[1] === 0, 'BM25：相关的有分、无关的 0 分')
ok(bm25Scores('', ['a']).every((x) => x === 0), 'BM25：空查询全 0')

// 相对时间
const now = Date.now()
ok(agoText(now - 60000, now) === '刚刚', '相对时间：刚刚')
ok(agoText(now - 3 * 3600000, now) === '3 小时前', '相对时间：小时')
ok(agoText(now - 30 * 3600000, now) === '昨天', '相对时间：昨天')
ok(agoText(now - 10 * 86400000, now) === '1 周前', '相对时间：周')

console.log('')
if (fails.length) {
  console.log(`❌ test-memory-evict.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-memory-evict.mjs 通过 ${pass} 项，失败 0 项`)
