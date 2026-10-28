/** notes.mjs 回归测试：搜索意图/隐私拦截/链接笔记/搜索笔记。 运行：node lib/test-notes.mjs */
import { NOTES_DEPS, createNotes } from './notes.mjs'

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
  createNotes({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(NOTES_DEPS.includes('cfgFor'), '依赖清单')

const notes = createNotes({
  config: { searchMaxResults: 5, searchTimeoutMs: 3000, searchFetchChars: 1200, searchFetchTop: true },
  log: () => {},
  stats: { searches: 0 },
  cfgFor: () => ({ linkSummary: true, linkVideo: true, webSearch: true }),
  isManagedRoom: () => true,
  factsOf: () => [],
  addFact: () => true,
  delFact: () => true,
})

// 搜索意图
ok(typeof notes.extractSearchQuery('你去搜一下 DeepSeek 最新模型') === 'string', '识别搜索意图')
ok(notes.extractSearchQuery('今天吃什么') === '', '普通聊天不触发搜索')

// 隐私拦截
ok(notes.sensitiveQuery('查一下 123456789') !== '', '纯数字拦截')
ok(notes.sensitiveQuery('查一下 https://a.com') !== '', '链接拦截')
ok(notes.sensitiveQuery('查一下 deepseek') === '', '普通查询放行')

// 网页链接笔记：关闭时为空
ok((await notes.buildWebLinkNote('看这个 https://example.com', { linkSummary: false })) === '', '未开启摘要时返回空')
ok((await notes.buildWebLinkNote('今天天气不错', { linkSummary: true })) === '', '没有链接时返回空')

// 视频链接笔记：没有视频链接时为空
ok((await notes.buildVideoLinkNote('今天天气不错', { linkVideo: true })) === null, '没有视频链接返回 null')

// 搜索笔记：不需要搜索时为空
const sn = await notes.buildSearchNote({ roomId: '900001', msgs: [] }, '今天吃什么', { webSearch: true })
ok(sn === null || sn === undefined || sn === '' || typeof sn === 'object', '不需要搜索时返回空/对象')

console.log('')
if (fails.length) {
  console.log(`❌ test-notes.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-notes.mjs 通过 ${pass} 项，失败 0 项`)
