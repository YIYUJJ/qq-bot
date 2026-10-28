/** tools-diagnostics.mjs 回归测试：模型路由渲染 + 图库统计。 运行：node lib/test-tools-diagnostics.mjs */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { diagnosticTools } from './tools-diagnostics.mjs'

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

const dir = mkdtempSync(join(tmpdir(), 'qqbot-diag-'))
const imgFile = join(dir, 'a.png')
writeFileSync(imgFile, 'x')

const stickers = {
  aaa: { url: 'http://x/a', subType: 1, emojiId: 'e1', at: Date.now(), uses: 3, file: imgFile },
  bbb: { url: 'http://x/b', subType: 0, at: Date.now() - 1000, uses: 0 },
  ccc: { url: 'http://x/c', subType: 1, at: Date.now() - 2000, bad: true },
}

const fakeLlm = {
  listProviders: () => [{ id: 'p1' }, { id: 'p2' }],
  listModels: async (p) => (p === 'p1' ? [{ id: 'm1', inputModalities: ['text', 'image'] }, { id: 'm2' }] : []),
}

const list = diagnosticTools({
  getLlm: () => fakeLlm,
  stickers,
  existsSync: (f) => f === imgFile,
  textOut: (t) => t,
  ob: { health: async () => ({ http: true, ws: true, self: { nickname: 'bot', user_id: 1 } }) },
  discover: async () => ({ ok: true, http: { url: 'http://x' }, self: { user_id: 1 }, tried: [] }),
  config: { snowlumaHome: '.', httpUrl: '', wsUrl: '', accessToken: '' },
})
const models = list.find((t) => t.name === 'qqbot_llm_models')
const stickerTool = list.find((t) => t.name === 'qqbot_stickers')
const healthTool = list.find((t) => t.name === 'qqbot_health')

const h = await healthTool.execute({})
ok(h.includes('HTTP：通') && h.includes('账号：bot（1）'), 'health 探测结果可读')

const out = await models.execute({})
ok(out.includes('provider（2）'), '列出 provider 数量')
ok(out.includes('p1（2）'), '列出 p1 的模型数量')
ok(out.includes('支持图片：m1'), '标出支持图片的模型')
ok(out.includes('p2（0）'), '列出空 provider')

const only = await models.execute({ provider: 'p1' })
ok(!only.includes('p2（'), 'provider 参数只显示指定 provider')

const noLlm = diagnosticTools({ getLlm: () => null, stickers, existsSync: () => false, textOut: (t) => t, ob: {}, discover: async () => ({}), config: {} }).find((t) => t.name === 'qqbot_llm_models')
let threw = false
try {
  await noLlm.execute({})
} catch {
  threw = true
}
ok(threw, '没有 llm 服务时抛错（由 wrapTool 兜底）')

const s = await stickerTool.execute()
ok(s.includes('图库 3 张'), '图库总数')
ok(s.includes('已收进收藏 1'), '收藏数')
ok(s.includes('有本地文件 1'), '本地文件数')
ok(s.includes('失效 1'), '失效数')
ok(s.includes('★收藏') && s.includes('📁本地') && s.includes('❌失效'), '行内标记齐全')

const empty = diagnosticTools({ getLlm: () => fakeLlm, stickers: {}, existsSync: () => false, textOut: (t) => t, ob: {}, discover: async () => ({}), config: {} }).find((t) => t.name === 'qqbot_stickers')
ok((await empty.execute()).includes('图库是空的'), '空图库提示')

rmSync(dir, { recursive: true, force: true })

console.log('')
if (fails.length) {
  console.log(`❌ test-tools-diagnostics.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-tools-diagnostics.mjs 通过 ${pass} 项，失败 0 项`)
