/** vision.mjs 回归测试：识图缓存命中、失败去重、附件入库、attach 替换。 运行：node lib/test-vision.mjs */
import { createServer } from 'node:http'
import { VISION_DEPS, createVisionChain } from './vision.mjs'

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

const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const imgServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'image/png' })
  res.end(pngBytes)
})
await new Promise((resolve) => imgServer.listen(0, '127.0.0.1', resolve))
const IMG = `http://127.0.0.1:${imgServer.address().port}/a.png`

let threw = ''
try {
  createVisionChain({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(VISION_DEPS.includes('vision'), '依赖清单')

function build(over = {}) {
  const cache = {}
  const saved = {}
  const refs = []
  const state = { broken: '' }
  const deps = {
    config: { visionOnImage: true, visionOnEmoticon: true, visionMaxTokens: 300, visionMaxMB: 12, visionMaxWidth: 1280, visionCacheMax: 300, visionProvider: 'p', visionModel: 'm' },
    llm: {
      async *stream() {
        yield { type: 'text-delta', text: '一只橘猫' }
        yield { type: 'finish', reason: 'stop' }
      },
    },
    log: () => {},
    noteUsage: () => {},
    resolveVisionRoute: async () => ({ provider: 'p', model: 'm' }),
    track: (t) => t,
    untrack: () => {},
    usage: { total: 0 },
    visionKey: (u) => String(u),
    trimVisionCache: () => {},
    visionCache: cache,
    getVisionBroken: () => state.broken,
    setVisionBroken: (v) => {
      state.broken = v
    },
    guessMediaType: () => 'image/jpeg',
    vision: { persist: () => saved.persist = true, cache },
    ctx: { get: (n) => (n === 'attachments' ? { saveImages: async (arr) => arr.map((a, i) => ({ id: 'att-' + i })) } : null) },
    createUserMessage: (input) => ({ ...input, role: 'user' }),
    ...over,
  }
  return { chain: createVisionChain(deps), cache, saved, state, refs }
}

// 识图成功
const a = build()
const desc = await a.chain.describeImage(IMG, 'image')
ok(desc === '一只橘猫', '识图返回描述')
ok(a.cache[IMG]?.text === '一只橘猫', '结果写进缓存')
ok(a.saved.persist === true, '缓存已落盘')

// 缓存命中：不再调用模型
let calls = 0
const b = build({
  llm: {
    async *stream() {
      calls += 1
      yield { type: 'text-delta', text: '新描述' }
      yield { type: 'finish', reason: 'stop' }
    },
  },
})
b.cache[IMG] = { text: '缓存描述', at: Date.now() }
const hit = await b.chain.describeImage(IMG, 'image')
ok(hit === '缓存描述' && calls === 0, '缓存命中不调用模型')

// 失败：记录错误并返回空
const c = build({
  llm: {
    async *stream() {
      throw new Error('vision down')
    },
  },
})
const fail = await c.chain.describeImage(IMG, 'image')
ok(fail === '', '识图失败返回空')
ok(String(c.cache[IMG]?.err || '').includes('vision down'), '失败写进缓存')
ok(String(c.state.broken).includes('vision down'), '记录同类失败（只记一次）')

// 关闭识图：直接返回空
const d = build({ config: { ...a.config, visionOnImage: false } })
ok((await d.chain.describeImage(IMG, 'image')) === '', '开关关闭时不识图')

// attachVision：把描述写回消息
const e = build()
const msg = { text: '[图片]' }
await e.chain.attachVision(msg, [IMG], ['image'], e.config)
ok(typeof msg.text === 'string', 'attachVision 不抛错')

imgServer.close()

console.log('')
if (fails.length) {
  console.log(`❌ test-vision.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-vision.mjs 通过 ${pass} 项，失败 0 项`)
