/** embed.mjs 预设 / 下载源 / 打分 + memory-store 混合检索回归测试（不下载模型）。 运行：node lib/test-embed.mjs */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EMBED_PRESETS, EMBED_SOURCES, presetOf, sourceOf, normalizeSim, cosine, DEFAULT_EMBED_MODEL, createEmbedder } from './embed.mjs'
import { createMemoryStore, fuseRelevance } from './memory-store.mjs'
import { CONFIG_META } from './meta.mjs'

let pass = 0
const fails = []
const ok = (c, n) => {
  if (c) { pass += 1; console.log('  PASS  ' + n) } else { fails.push(n); console.log('  FAIL  ' + n) }
}

// ── 预设：每个模型的用法 ──
const qwen = presetOf('onnx-community/Qwen3-Embedding-0.6B-ONNX')
ok(qwen.pooling === 'last_token' && qwen.paddingSide === 'left' && qwen.queryPrefix.startsWith('Instruct:'), '千问3：取最后一个 token、左侧补齐、查询加指令')
ok(presetOf('Xenova/bge-base-zh-v1.5').pooling === 'cls' && presetOf('Xenova/bge-base-zh-v1.5').queryPrefix.includes('检索'), 'bge-base：CLS + 官方检索前缀')
ok(presetOf('Xenova/bge-small-zh-v1.5').queryPrefix === '', 'bge-small：不加前缀（实测加了更差）')
ok(presetOf('某个/没见过的模型').pooling === 'cls', '未知模型按 bge 用法兜底')
ok(EMBED_PRESETS[DEFAULT_EMBED_MODEL] && CONFIG_META.semanticModel.default === DEFAULT_EMBED_MODEL, '默认模型在预设表里，且和面板默认一致')
ok(CONFIG_META.semanticModel.options.every((m) => EMBED_PRESETS[m]), '面板下拉里的每个模型都有预设')

// ── 下载源 ──
ok(sourceOf({}).host === EMBED_SOURCES.modelscope.host && sourceOf({}).template.includes('master'), '默认 ModelScope（master 分支）')
ok(sourceOf({ semanticSource: 'custom', semanticMirror: 'https://example.com' }).host === 'https://example.com/', '自定义地址补斜杠')
ok(sourceOf({ semanticSource: 'custom', semanticMirror: '' }).host === EMBED_SOURCES.modelscope.host, '自定义地址为空时回落 ModelScope')
ok(sourceOf({ semanticSource: 'hf-mirror' }).host === 'https://hf-mirror.com/', '可选 hf-mirror')

// ── 打分工具 ──
ok(normalizeSim(0.34, 0.34) === 0 && normalizeSim(1, 0.34) === 1, 'normalizeSim：基线 = 0，余弦 1 = 1')
ok(normalizeSim(0.2, 0.34) < 0 && normalizeSim(0.25, 0.34) > normalizeSim(0.2, 0.34), 'normalizeSim 不截断：低于基线的仍保留先后顺序')
ok(fuseRelevance(0.5, 9, 9) === 0.5, 'fuseRelevance 默认不加关键词分')
ok(Math.abs(fuseRelevance(0.5, 3, 9, 0.1) - 0.55) < 1e-9, 'fuseRelevance 可选饱和加分 b/(b+3)')
ok(fuseRelevance(null, 3, 6) === 0.5, '没有语义分时按 BM25 / 最大值')
ok(CONFIG_META.keywordBonus.default === 0 && !CONFIG_META.semanticWeight, '配置：关键词加分默认 0，旧的 semanticWeight 已移除')
ok(Math.abs(cosine([0.6, 0.8], [0.6, 0.8]) - 1) < 1e-9, 'cosine')

// ── 没装 / 没开时不炸 ──
const emb = createEmbedder({ config: { semanticSearch: true, semanticModel: 'Xenova/bge-base-zh-v1.5' }, memDirOf: () => '', dataDir: tmpdir(), importer: async () => { throw new Error('nope') } })
let err = ''
try { await emb.ensure() } catch (e) { err = String(e.message) }
ok(err.includes('没装'), '没装 transformers 时给出明确提示')
ok((await emb.queryVec('hi')) === null, '模型没好时 queryVec 返回 null（不拖慢回复）')
ok(emb.status().label.includes('bge-base') && emb.status().source.includes('modelscope'), 'status 带模型名和下载源')

// ── 混合检索：弱 BM25 匹配不能盖过语义 ──
const dir = mkdtempSync(join(tmpdir(), 'qqbot-embed-'))
try {
  const config = { memoryRooms: ['9'], allowGroups: ['9'], semanticSearch: true, keywordBonus: 0, memoryReinforce: false, factsKeep: 150 }
  const store = createMemoryStore({ config, rooms: new Map(), groupNames: new Map(), facts: {}, memoryDir: dir, log: () => {}, keywordsOf: () => [] })
  store.addFact('9', '小王养了一只橘猫，名字叫橘子')
  store.addFact('9', '阿杰最近在减肥，晚上不吃饭')
  store.addFact('9', '小美最近在学吉他')
  // 语义：只有第一条和"猫咪"相关；BM25：只有"最近"能撞上后两条
  store.setSemanticScorer((rid, texts) => texts.map((t) => (t.includes('橘猫') ? 0.6 : 0.05)))
  const r = { roomId: '9', msgs: [] }
  const scored = store.scoreFacts(r, store.factsOf('9'), '他家那只黄色的猫咪最近咋样', '')
  const top = scored.sort((a, b) => b.s - a.s)[0].f.text
  ok(top.includes('橘猫'), '语义相关的排第一，不会被"最近"这种弱匹配带偏')
  // 语义分一样时：默认（加分 0）不靠关键词；打开加分后关键词能把对的那条顶上去
  store.setSemanticScorer((rid, texts) => texts.map(() => 0.3))
  config.keywordBonus = 0.1
  const s2 = store.scoreFacts(r, store.factsOf('9'), '阿杰减肥', '').sort((a, b) => b.s - a.s)[0].f.text
  ok(s2.includes('阿杰'), '打开关键词加分后，语义分一样时关键词起作用')
  config.keywordBonus = 0
  // 没有语义分：退回纯 BM25
  store.setSemanticScorer(null)
  const s3 = store.scoreFacts(r, store.factsOf('9'), '吉他', '').sort((a, b) => b.s - a.s)[0].f.text
  ok(s3.includes('吉他'), '没有语义时纯 BM25 照常工作')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log('')
if (fails.length) {
  console.log(`❌ test-embed.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-embed.mjs 通过 ${pass} 项，失败 0 项`)
