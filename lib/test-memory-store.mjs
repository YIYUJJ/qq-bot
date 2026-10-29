/** memory-store.mjs 回归测试：托管校验、事实去重/相似取代/删除、按相关性挑记忆。 运行：node lib/test-memory-store.mjs */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MEMORY_STORE_DEPS, createMemoryStore } from './memory-store.mjs'

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
  createMemoryStore({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(MEMORY_STORE_DEPS.includes('facts'), '依赖清单')

const dir = mkdtempSync(join(tmpdir(), 'qqbot-mem-'))
const facts = {}
const rooms = new Map([['900001', { roomId: '900001', roomName: '测试群', isGroup: true, msgs: [] }]])
const store = createMemoryStore({
  config: { memoryRooms: ['900001'], allowGroups: ['900001'] },
  rooms,
  groupNames: new Map([['900001', '测试群']]),
  facts,
  memoryDir: dir,
  log: () => {},
  keywordsOf: (text) => String(text).split(/\s+/).filter(Boolean),
})

try {
  ok(store.isManagedRoom('900001') === true, '托管会话判定')
  ok(store.isManagedRoom('999999') === false, '未托管判定')
  ok(store.isGroupRoom('900001') === true, '群判定')

  const memDir = store.memDirOf('900001')
  ok(typeof memDir === 'string' && memDir.length > 0, '记忆目录已创建')
  ok(store.memDirOf('999999') === '', '未托管没有目录')

  ok(store.loadFacts('900001').length === 0, '初始没有事实')
ok(!!store.addFact('900001', '主人喜欢吃白饭'), '新增事实')
ok(store.addFact('900001', '主人喜欢吃白饭') === false, '重复事实被拒')
  ok(store.factsOf('900001').length === 1, 'factsOf 返回事实')

  // 相似事实取代旧版本
ok(!!store.addFact('900001', '主人喜欢吃白米饭'), '相似事实也算新增（取代旧的）')
  const visible = store.factsOf('900001')
  ok(visible.length === 1 && /白米饭/.test(visible[0].text), '旧事实被取代、只留新版本')

  // 删除
  ok(store.delFact('900001', '主人喜欢吃白米饭') === true, '删除事实')
  ok(store.delFact('900001', '不存在') === false, '删除不存在返回 false')

  // 空文本
  ok(store.addFact('900001', '   ') === false, '空文本不记')

  // 未托管不记
  ok(store.addFact('999999', 'x') === false, '未托管不记事实')

  // 归一化
  ok(store.factNorm('  你好，世界！ ') === '你好世界', 'factNorm 去标点空白小写')

  // similarity
  ok(store.similarity('主人喜欢吃白饭', '主人喜欢吃白米饭') >= 0.6, '相似度能识别同一件事')
  ok(store.similarity('完全无关的句子', '另一件不相关的事情') < 0.3, '相似度对无关句子低')

  // pickFacts
  store.addFact('900001', '喜欢下雨天')
  const picked = store.pickFacts({ roomId: '900001', msgs: [{ text: '下雨天' }] }, 1)
  ok(Array.isArray(picked) && picked.length <= 1, 'pickFacts 限制条数')

  // 重要度 + who 字段
  store.addFact('900001', '张三的生日是三月五号', Date.now(), { importance: 5, who: '10001', whoName: '张三' })
  const bday = store.factsOf('900001').find((x) => /生日/.test(x.text))
  ok(bday && bday.importance === 5 && bday.who === '10001', '事实带重要度和 who')
  ok(store.factsOf('900001').find((x) => /下雨天/.test(x.text))?.importance === 2, '默认重要度 2')

  // 更新同一件事：重要度不降级、who 继承
  store.addFact('900001', '张三的生日是三月六号', Date.now(), { importance: 2 })
  const bday2 = store.factsOf('900001').find((x) => /生日/.test(x.text))
  ok(bday2 && /六号/.test(bday2.text) && bday2.importance === 5 && bday2.who === '10001', '更新时重要度不降、who 继承')

  // pickFacts：说话人的事实优先
  for (let i = 0; i < 6; i++) store.addFact('900001', `无关的闲聊话题编号${i}关于天气和外卖${'甲乙丙丁戊己'[i]}`)
  const forZhang = store.pickFacts({ roomId: '900001', msgs: [{ sender: '10001', text: '在吗' }] }, 2)
  ok(forZhang.some((x) => x.who === '10001'), 'pickFacts 优先带说话人的事实')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-memory-store.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-memory-store.mjs 通过 ${pass} 项，失败 0 项`)
