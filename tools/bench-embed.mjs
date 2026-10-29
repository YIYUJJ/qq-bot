#!/usr/bin/env node
/**
 * 向量模型严格测试（速度 + 准确度），输出中文报告。
 *
 * 用法：
 *   node tools/bench-embed.mjs
 *   环境变量：
 *     BENCH_MODELS   要测的模型，逗号分隔（默认插件下拉框里的三个）
 *     BENCH_ROUNDS   测速轮数（默认 3；每轮每个模型一个新进程，模型顺序每轮轮换）
 *     BENCH_REPORT   中文报告路径（默认 ./向量模型实测.md）
 *     BENCH_JSON     原始数据路径（默认 ./向量模型实测.json）
 *
 * 只用 ~/.dsh/qq-bot/models 里已下载的模型（子进程禁止联网），开始前逐个校验 sha256。
 */
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { cpus, freemem, homedir, release, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMBED_PRESETS, presetOf } from '../lib/embed.mjs'
import { bm25Scores } from '../lib/memory.mjs'
import { MEMORIES, QUESTIONS, TYPES, validateTestset } from './embed-testset.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const WORKER = join(ROOT, 'tools', 'bench-embed-worker.mjs')
const CACHE = join(homedir(), '.dsh', 'qq-bot', 'models')
const MODELS = (process.env.BENCH_MODELS || Object.keys(EMBED_PRESETS).join(',')).split(',').map((s) => s.trim()).filter(Boolean)
const ROUNDS = Math.max(1, Number(process.env.BENCH_ROUNDS) || 3)
const REPORT = process.env.BENCH_REPORT || '向量模型实测.md'
const JSON_OUT = process.env.BENCH_JSON || '向量模型实测.json'
const say = (s = '') => console.log(s)

/* ───────────── 统计工具 ───────────── */
const sorted = (a) => [...a].sort((x, y) => x - y)
const quant = (a, p) => {
  const s = sorted(a)
  if (!s.length) return NaN
  const i = (s.length - 1) * p
  const lo = Math.floor(i)
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo)
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1)
const std = (a) => {
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}
/** Wilson 95% 置信区间 */
function wilson(k, n) {
  if (!n) return [0, 0]
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}
/** McNemar 精确检验（双侧）：b = A 对 B 错，c = A 错 B 对 */
function mcnemar(b, c) {
  const n = b + c
  if (!n) return 1
  const k = Math.min(b, c)
  let logC = 0
  let sum = 0
  for (let i = 0; i <= k; i++) {
    if (i > 0) logC += Math.log(n - i + 1) - Math.log(i)
    sum += Math.exp(logC - n * Math.log(2))
  }
  return Math.min(1, 2 * sum)
}
/** 固定种子的随机数（结果可复现） */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** 配对自助法：两组 MRR 差值的 95% 区间 */
function bootDiff(rrA, rrB, times = 2000) {
  const r = rng(20261029)
  const n = rrA.length
  const ds = []
  for (let t = 0; t < times; t++) {
    let s = 0
    for (let i = 0; i < n; i++) {
      const j = Math.floor(r() * n)
      s += rrA[j] - rrB[j]
    }
    ds.push(s / n)
  }
  return [quant(ds, 0.025), quant(ds, 0.975)]
}
function metrics(ranks, idx = null) {
  const rs = idx ? idx.map((i) => ranks[i]) : ranks
  const n = rs.length
  const top = (k) => rs.filter((r) => r <= k).length
  return { n, top1: top(1), top3: top(3), top5: top(5), mrr: mean(rs.map((r) => 1 / r)), ci1: wilson(top(1), n), ci3: wilson(top(3), n) }
}
const pctS = (x) => (x * 100).toFixed(1) + '%'
const ms = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—')

/* ───────────── 子进程 ───────────── */
function runWorker(payload) {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--expose-gc', WORKER, JSON.stringify(payload)], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024, timeout: 15 * 60000 }, (err, stdout, stderr) => {
      if (stderr) process.stderr.write(stderr)
      const line = String(stdout || '').trim().split('\n').pop() || ''
      try {
        resolve(JSON.parse(line))
      } catch {
        resolve({ ok: false, model: payload.model, error: String(err?.message || '子进程没有输出结果') })
      }
    })
  })
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

function pkgVersion(name) {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version
  } catch {
    return '未安装'
  }
}

/* ───────────── 主流程 ───────────── */
const problems = validateTestset()
if (problems.length) {
  say('❌ 测试集自检没通过：' + problems.join('；'))
  process.exit(1)
}

const env = {
  时间: new Date().toLocaleString('zh-CN', { hour12: false }),
  CPU: cpus()[0]?.model?.trim(),
  逻辑核心数: cpus().length,
  内存: `共 ${(totalmem() / 1073741824).toFixed(1)} GB，开始时空闲 ${(freemem() / 1073741824).toFixed(1)} GB`,
  系统: `Windows ${release()}`,
  Node: process.version,
  推理库: `@huggingface/transformers ${pkgVersion('@huggingface/transformers')} + onnxruntime-node ${pkgVersion('onnxruntime-node')}（CPU）`,
  后台进程: (() => {
    try {
      const n = (execFileSync('tasklist', { encoding: 'utf8' }).match(/DeepSeek Harness\.exe/g) || []).length
      return n ? `测试时 DSH（DeepSeek Harness）正在运行，${n} 个进程` : '没有检测到 DSH 进程'
    } catch {
      return '未知'
    }
  })(),
}
say('══════ 向量模型严格测试 ══════')
for (const [k, v] of Object.entries(env)) say(`${k}：${v}`)
say(`测试集：记忆池 ${MEMORIES.length} 条，题目 ${QUESTIONS.length} 道（${TYPES.map((t) => t + ' ' + QUESTIONS.filter((q) => q.type === t).length).join('、')}）`)

// 1) 文件完整性
say('\n── 1. 模型文件校验（sha256，与 ModelScope 公布值比对）──')
const integrity = []
for (const model of MODELS) {
  const p = presetOf(model)
  const file = join(CACHE, model, p.file || 'onnx/model_quantized.onnx')
  if (!existsSync(file)) {
    integrity.push({ model, ok: false, note: '本地没有这个文件' })
    say(`  ❌ ${p.short}：本地没有 ${file}`)
    continue
  }
  const size = statSync(file).size
  const sha = await sha256File(file)
  const ok = sha === p.sha256 && size === p.bytes
  integrity.push({ model, ok, size, sha })
  say(`  ${ok ? '✅' : '❌'} ${p.short}：${size} 字节，sha256 ${ok ? '一致' : '不一致！实际 ' + sha}`)
}
const usable = MODELS.filter((m) => integrity.find((x) => x.model === m)?.ok)

// 2) 准确度
say('\n── 2. 准确度（每个模型一个独立进程）──')
const acc = {}
for (const model of usable) {
  say(`▶ ${presetOf(model).short}`)
  const r = await runWorker({ mode: 'accuracy', model })
  if (!r.ok) say('  ❌ ' + r.error)
  else acc[model] = r
}
const bmRanks = QUESTIONS.map((q) => {
  const t = MEMORIES.findIndex((x) => x.id === q.target)
  const s = bm25Scores(q.q, MEMORIES.map((x) => x.text))
  return 1 + s.filter((v, i) => i !== t && v >= s[t]).length
})
const byType = Object.fromEntries(TYPES.map((t) => [t, QUESTIONS.map((q, i) => (q.type === t ? i : -1)).filter((i) => i >= 0)]))

// 3) 速度（BENCH_SKIP_SPEED=1 时跳过，只调准确度参数时用）
const SKIP_SPEED = process.env.BENCH_SKIP_SPEED === '1'
const speed = Object.fromEntries(usable.map((m) => [m, []]))
const threadRuns = {}
if (!SKIP_SPEED) {
say(`\n── 3. 速度（${ROUNDS} 轮 × 每个模型一个新进程，4 线程，顺序每轮轮换）──`)
for (let round = 0; round < ROUNDS; round++) {
  const order = usable.map((_, i) => usable[(i + round) % usable.length])
  say(`第 ${round + 1} 轮：${order.map((m) => presetOf(m).short.split('（')[0]).join(' → ')}`)
  for (const model of order) {
    const r = await runWorker({ mode: 'speed', model, threads: 4 })
    if (r.ok) speed[model].push(r)
    else say('  ❌ ' + r.error)
  }
}
say('线程数影响（长查询，各 1 轮）')
for (const th of [1, 8]) {
  for (const model of usable) {
    const r = await runWorker({ mode: 'speed', model, threads: th })
    if (r.ok) (threadRuns[model] ??= {})[th] = r
  }
}
}

/* ───────────── 汇总 ───────────── */
const lines = []
const out = (s = '') => {
  lines.push(s)
  say(s)
}
out('\n══════ 结果汇总 ══════')

out('\n## 测试的模型（全名）\n')
out('| 简称 | 实际使用的仓库 | 原始模型 | 发布方 | 结构 | 文件 | 大小 | sha256 校验 |')
out('|---|---|---|---|---|---|---|---|')
for (const model of MODELS) {
  const p = presetOf(model)
  const ig = integrity.find((x) => x.model === model)
  out(`| ${p.short.split('（')[0]} | \`${model}\` | \`${p.origin}\` | ${p.vendor || '—'} | ${p.arch || '—'} | \`${p.file}\`（ONNX int8 动态量化） | ${(p.bytes / 1048576).toFixed(0)} MB | ${ig?.ok ? '✅ 一致' : '❌ ' + (ig?.note || '不一致')} |`)
}

out('\n## 速度（单位：毫秒；所有轮次的样本合并统计）\n')
out('| 模型 | 冷启动加载 | 模型占内存 | 短查询 中位数 | 短查询 p95 | 短查询 p99 | 长查询 中位数 | 长查询 p95 | 长查询 p99 | 建索引每条 | 各轮长查询中位数 |')
out('|---|---|---|---|---|---|---|---|---|---|---|')
const spd = {}
for (const model of usable) {
  const runs = speed[model]
  if (!runs.length) continue
  const short = runs.flatMap((r) => r.short)
  const long = runs.flatMap((r) => r.long)
  spd[model] = {
    load: mean(runs.map((r) => r.loadMs)),
    mem: mean(runs.map((r) => r.modelMB)),
    s50: quant(short, 0.5), s95: quant(short, 0.95), s99: quant(short, 0.99), sMean: mean(short), sStd: std(short),
    l50: quant(long, 0.5), l95: quant(long, 0.95), l99: quant(long, 0.99), lMean: mean(long), lStd: std(long),
    idx: mean(runs.map((r) => r.indexPerItem)),
    roundsL50: runs.map((r) => quant(r.long, 0.5)),
    roundsS50: runs.map((r) => quant(r.short, 0.5)),
  }
  const s = spd[model]
  out(`| ${presetOf(model).short} | ${(s.load / 1000).toFixed(1)} 秒 | ${s.mem.toFixed(0)} MB | ${ms(s.s50)} | ${ms(s.s95)} | ${ms(s.s99)} | ${ms(s.l50)} | ${ms(s.l95)} | ${ms(s.l99)} | ${ms(s.idx)} | ${s.roundsL50.map(ms).join(' / ')} |`)
}
const ref = 'Xenova/bge-base-zh-v1.5'
if (spd[ref]) {
  out(`\n以 bge-base-zh-v1.5（\`${ref}\`）为 1 倍：`)
  for (const model of usable) {
    if (!spd[model] || model === ref) continue
    const s = spd[model]
    const r = spd[ref]
    const perRound = s.roundsL50.map((v, i) => v / r.roundsL50[i]).filter(Number.isFinite)
    out(`- ${presetOf(model).short}：短查询 ${(s.s50 / r.s50).toFixed(1)} 倍，长查询 ${(s.l50 / r.l50).toFixed(1)} 倍（各轮 ${perRound.map((x) => x.toFixed(1)).join(' / ')}），建索引 ${(s.idx / r.idx).toFixed(1)} 倍，内存 ${(s.mem / r.mem).toFixed(1)} 倍`)
  }
}
out('\n线程数对长查询中位数的影响（毫秒）：\n')
out('| 模型 | 1 线程 | 4 线程 | 8 线程 |')
out('|---|---|---|---|')
for (const model of usable) {
  const t = threadRuns[model] || {}
  out(`| ${presetOf(model).short} | ${ms(quant(t[1]?.long || [], 0.5))} | ${ms(spd[model]?.l50)} | ${ms(quant(t[8]?.long || [], 0.5))} |`)
}

const rowOf = (label, ranks) => {
  const m = metrics(ranks)
  return `| ${label} | ${m.top1}/${m.n}（${pctS(m.top1 / m.n)}） | ${pctS(m.ci1[0])}～${pctS(m.ci1[1])} | ${m.top3} | ${m.top5} | ${m.mrr.toFixed(3)} |`
}
const shortName = (model) => presetOf(model).short.split('（')[0]
function pairTable(title, cfgs) {
  out(`\n### ${title}\n`)
  out('| 比较 | 只有前者答对 | 只有后者答对 | Top1 差异 p 值 | MRR 差（前减后）95% 区间 | 结论 |')
  out('|---|---|---|---|---|---|')
  for (let i = 0; i < cfgs.length; i++) {
    for (let j = i + 1; j < cfgs.length; j++) {
      const A = cfgs[i]
      const B = cfgs[j]
      let b = 0
      let c = 0
      A.ranks.forEach((r, k) => {
        if (r === 1 && B.ranks[k] !== 1) b += 1
        if (r !== 1 && B.ranks[k] === 1) c += 1
      })
      const p = mcnemar(b, c)
      const [lo, hi] = bootDiff(A.ranks.map((r) => 1 / r), B.ranks.map((r) => 1 / r))
      const sig = p < 0.05 ? (b > c ? '前者显著更好' : '后者显著更好') : '差异不显著'
      out(`| ${A.label} vs ${B.label} | ${b} | ${c} | ${p.toFixed(3)} | ${lo.toFixed(3)}～${hi.toFixed(3)} | ${sig} |`)
    }
  }
}

out(`\n## 准确度（${QUESTIONS.length} 道题，记忆池 ${MEMORIES.length} 条；Top1 = 第一名就对，Top3 = 前三名里有，MRR = 平均倒数排名，越接近 1 越好）\n`)
out('所有句子都一条一条算（和插件一样），不批量。\n')

// 1) 模型本身（纯语义）：各前缀方案
out('### 一、模型本身的能力（纯语义，不混关键词）\n')
out('| 方案 | Top1 | Top1 的 95% 区间 | Top3 | Top5 | MRR |')
out('|---|---|---|---|---|---|')
out(rowOf('只用关键词（BM25），参照', bmRanks))
for (const model of usable) {
  for (const v of acc[model]?.variants || []) out(rowOf(`${shortName(model)}｜${v.name}${v.isPreset ? '（插件预设）' : '（对照）'}`, v.semRanks))
}
pairTable(
  '模型之间两两比较（各用插件预设前缀，纯语义）',
  usable.filter((m) => acc[m]).map((m) => ({ label: shortName(m), ranks: acc[m].variants.find((v) => v.isPreset).semRanks })),
)

// 2) 融合方式：关键词加分权重网格
const bonuses = Object.keys(acc[usable.find((m) => acc[m])]?.variants[0]?.fusedByBonus || {}).map(Number).sort((a, b) => a - b)
out('\n### 二、关键词加分权重（语义线性归一化 + BM25 饱和加分 × 权重；各模型用插件预设前缀）\n')
out(`| 加分权重 | ${usable.filter((m) => acc[m]).map((m) => `${shortName(m)} Top1 / MRR`).join(' | ')} | 合计 Top1 |`)
out(`|---|${usable.filter((m) => acc[m]).map(() => '---').join('|')}|---|`)
let bestB = 0
let bestSum = -1
for (const B of bonuses) {
  let sum = 0
  const cells = usable.filter((m) => acc[m]).map((m) => {
    const r = acc[m].variants.find((v) => v.isPreset).fusedByBonus[B]
    const mm = metrics(r)
    sum += mm.top1
    return `${mm.top1} / ${mm.mrr.toFixed(3)}`
  })
  if (sum > bestSum) {
    bestSum = sum
    bestB = B
  }
  out(`| ${B} | ${cells.join(' | ')} | ${sum} |`)
}
out(`\n合计 Top1 最高的加分权重：**${bestB}**（并列时取更小的）。`)

// 3) 修复前 vs 修复后（插件实际打分）
out('\n### 三、插件实际打分：修复前 vs 现在的插件代码\n')
out('修复前 = 按固定基线截断到 0 + 关键词加分上限 0.3；现在 = 直接调用插件里的 normalizeSim + fuseRelevance（实测基线线性归一化、不截断、关键词加分取面板默认值）。\n')
out('| 方案 | Top1 | Top1 的 95% 区间 | Top3 | Top5 | MRR |')
out('|---|---|---|---|---|---|')
const afterCfgs = []
for (const model of usable) {
  const v = acc[model]?.variants.find((x) => x.isPreset)
  if (!v) continue
  out(rowOf(`${shortName(model)}｜修复前`, v.oldRanks))
  out(rowOf(`${shortName(model)}｜现在的插件代码`, v.pluginRanks))
  afterCfgs.push({ label: shortName(model), ranks: v.pluginRanks })
}
pairTable('现在的插件代码：模型之间两两比较', afterCfgs)

out('\n### 四、按题型拆开（现在的插件代码，Top1 / 题数）\n')
out(`| 方案 | ${TYPES.join(' | ')} |`)
out(`|---|${TYPES.map(() => '---').join('|')}|`)
out(`| 只用关键词（BM25） | ${TYPES.map((t) => { const m = metrics(bmRanks, byType[t]); return `${m.top1}/${m.n}` }).join(' | ')} |`)
for (const c of afterCfgs) out(`| ${c.label} | ${TYPES.map((t) => { const m = metrics(c.ranks, byType[t]); return `${m.top1}/${m.n}` }).join(' | ')} |`)

out('\n### 五、正确性检查\n')
out('| 模型 | 同一句算两次的一致度 | 批量 vs 单条的一致度（最低） | 相关句平均余弦 | 无关句余弦 中位 / 75 分位 / 95 分位 | 实测基线（插件预设前缀） |')
out('|---|---|---|---|---|---|')
for (const model of usable) {
  const a = acc[model]
  if (!a) continue
  const v = a.variants.find((x) => x.isPreset)
  out(`| ${presetOf(model).short} | ${a.determinism.toFixed(4)} | ${a.consistency.toFixed(4)} | ${v.relatedMean.toFixed(3)} | ${v.unrelatedQ.p50.toFixed(3)} / ${v.unrelatedQ.p75.toFixed(3)} / ${v.unrelatedQ.p95.toFixed(3)} | ${v.base.toFixed(3)} |`)
}
out('\n说明：一致度 = 两个向量的余弦，1.0000 表示完全一样。批量 vs 单条不一致，是 int8 动态量化时补齐位置参与了量化范围计算造成的，所以插件和本测试都改成一条一条算。')

const report = [
  '# 向量模型严格测试报告',
  '',
  '由 `tools/bench-embed.mjs` 自动生成。',
  '',
  '## 测试环境',
  '',
  ...Object.entries(env).map(([k, v]) => `- ${k}：${v}`),
  `- 测试集：记忆池 ${MEMORIES.length} 条（60 条目标 + 30 条"同话题不同人"的干扰项），题目 ${QUESTIONS.length} 道（${TYPES.map((t) => t + ' ' + QUESTIONS.filter((q) => q.type === t).length).join('、')}），见 \`tools/embed-testset.mjs\``,
  `- 测速方法：每个模型每轮一个全新进程，共 ${ROUNDS} 轮，模型顺序每轮轮换；预热 20 次后测 200 次短查询（单句）+ 100 次长查询（最近几句聊天拼接，平均约 56 字）+ 3 遍建索引；另测 1 线程和 8 线程各 1 轮`,
  '- 测试时禁止联网，只用本地已下载的模型文件，开始前全部校验 sha256',
  ...lines.slice(1),
  '',
]
writeFileSync(REPORT, report.join('\n'), 'utf8')
writeFileSync(JSON_OUT, JSON.stringify({ env, integrity, accuracy: acc, speed, threadRuns, bm25Ranks: bmRanks }, null, 1), 'utf8')
say(`\n中文报告：${REPORT}\n原始数据：${JSON_OUT}`)
