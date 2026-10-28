#!/usr/bin/env node
/**
 * 冒烟测试：一条命令确认「改完还能跑」。
 *
 * 覆盖：语法 → 面板产物 → 单测 → 配置/元数据一致性 → 插件存活 → SnowLuma/推送端口
 * 用法：node scripts/smoke.mjs         （全部检查）
 *      node scripts/smoke.mjs --quick  （跳过单测，只做静态+存活）
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import net from 'node:net'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DATA = join(process.env.USERPROFILE || '', '.dsh', 'qq-bot')
const LOG = join(DATA, 'bot.log')
const QUICK = process.argv.includes('--quick')
const CI = process.argv.includes('--ci') // CI 里没有 SnowLuma / 本地配置，跳过运行时检查
const modUrl = (p) => pathToFileURL(p).href

const results = []
function check(name, fn, { soft = false } = {}) {
  const started = Date.now()
  try {
    const detail = fn()
    results.push({ name, ok: true, detail: detail || '', ms: Date.now() - started, soft })
  } catch (e) {
    results.push({ name, ok: false, detail: String(e?.message || e), ms: Date.now() - started, soft })
  }
}
async function checkAsync(name, fn, { soft = false } = {}) {
  const started = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail: detail || '', ms: Date.now() - started, soft })
  } catch (e) {
    results.push({ name, ok: false, detail: String(e?.message || e), ms: Date.now() - started, soft })
  }
}

/* ── 1. 语法 ── */
check('源码语法', () => {
  const files = readdirSync(join(ROOT, 'lib'))
    .filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
    .map((f) => join(ROOT, 'lib', f))
  files.push(join(ROOT, 'build-client.mjs'))
  let bad = []
  for (const f of files) {
    try {
      execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
    } catch {
      bad.push(f.split(/[\\/]/).pop())
    }
  }
  if (bad.length) throw new Error('语法失败: ' + bad.join(', '))
  return `${files.length} 个文件`
})

check('面板脚本语法', () => {
  const html = readFileSync(join(ROOT, 'panel', 'index.html'), 'utf8')
  const s = html.indexOf('<script>') + 8
  const e = html.lastIndexOf('</script>')
  new Function(html.slice(s, e))
  return '内联脚本可解析'
})

if (!CI) check('面板产物不是旧的', () => {
  const a = join(ROOT, 'panel', 'index.html')
  const b = join(ROOT, 'lib', 'client.js')
  if (!existsSync(b)) throw new Error('lib/client.js 不存在，先跑 node build-client.mjs')
  if (statSync(b).mtimeMs + 1000 < statSync(a).mtimeMs) {
    throw new Error('panel/index.html 比 lib/client.js 新，需要重新 build-client')
  }
  return 'build 时间正常'
})

/* ── 2. 单测 ── */
if (!QUICK && !CI) {
  check('单测', () => {
    const suites = readdirSync(join(ROOT, 'lib'))
      .filter((f) => f.startsWith('test-') && f.endsWith('.mjs'))
      .sort()
    const out = []
    for (const s of suites) {
      const r = execFileSync(process.execPath, [join(ROOT, 'lib', s)], { encoding: 'utf8' })
      const m = /通过 (\d+) 项，失败 (\d+) 项/.exec(r)
      if (!m) throw new Error(s + ' 输出异常: ' + r.slice(0, 80))
      if (Number(m[2]) !== 0) throw new Error(`${s} 有 ${m[2]} 项失败`)
      out.push(`${s.replace('.mjs', '')} ${m[1]}`)
    }
    return out.join('｜')
  })
}

/* ── 3. 配置 / 元数据 ── */
const haveCfg = existsSync(join(DATA, 'config.json'))
if (!CI) check('配置文件可读', () => {
  if (!haveCfg) throw new Error('找不到 ' + join(DATA, 'config.json'))
  const cfg = JSON.parse(readFileSync(join(DATA, 'config.json'), 'utf8'))
  if (!Array.isArray(cfg.allowGroups) || !cfg.allowGroups.length) throw new Error('allowGroups 为空')
  return `${Object.keys(cfg).length} 个键｜白名单 ${cfg.allowGroups.join(',')}`
})

await checkAsync('元数据 / 房间键一致', async () => {
  const meta = await import(modUrl(join(ROOT, 'lib', 'meta.mjs')))
  const room = await import(modUrl(join(ROOT, 'lib', 'roomcfg.mjs')))
  const keys = Object.keys(meta.CONFIG_META)
  const missing = room.ROOM_KEYS.filter((k) => !keys.includes(k))
  if (missing.length) throw new Error('ROOM_KEYS 里有配置不存在的键: ' + missing.join(', '))
  const groups = new Set(meta.GROUPS.map((g) => g.id))
  const badGroup = keys.filter((k) => !meta.CONFIG_META[k].hidden && !groups.has(meta.CONFIG_META[k].group))
  if (badGroup.length) throw new Error('字段指向不存在的分组: ' + badGroup.slice(0, 5).join(', '))
  return `${keys.length} 项 / ${meta.GROUPS.length} 组 / 覆盖 ${room.ROOM_KEYS.length} 项`
})

check('配置类型一致（面板字段都能存）', () => {
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools', 'audit-config-types.mjs')], { encoding: 'utf8' })
    return '面板字段与后端类型一致'
  } catch (e) {
    const out = String(e?.stdout || '')
    const bad = out.split('\n').filter((l) => l.includes('❌')).map((l) => l.trim().replace('❌', '')).slice(0, 4)
    throw new Error(bad.join('；') || '配置类型不一致（跑 node tools/audit-config-types.mjs 看详情）')
  }
})


await checkAsync('模块导出齐全', async () => {
  const f = await import(modUrl(join(ROOT, 'lib', 'features.mjs')))
  const e = await import(modUrl(join(ROOT, 'lib', 'extras.mjs')))
  const need = ['createFeatures']
  for (const k of need) if (typeof f[k] !== 'function') throw new Error('features 缺 ' + k)
  for (const k of ['rollDice', 'parseReminder', 'pickWebLink', 'fetchPageSummary', 'extractDocText']) {
    if (typeof e[k] !== 'function') throw new Error('extras 缺 ' + k)
  }
  return 'features / extras OK'
})

/* ── 4. 插件存活 ── */
if (!CI) check('插件启动过且无致命错误', () => {
  if (!existsSync(LOG)) throw new Error('日志不存在')
  const lines = readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean)
  let last = -1
  for (let i = 0; i < lines.length; i++) if (lines[i].includes('插件已启动')) last = i
  if (last < 0) throw new Error('日志里没有"插件已启动"')
  const after = lines.slice(last)
  const fatal = after.filter((l) => /未捕获|fiber|Cannot find module|SyntaxError|ReferenceError/.test(l))
  if (fatal.length) throw new Error('启动后有致命行: ' + fatal[0].slice(0, 90))
  const ageMin = Math.round((Date.now() - statSync(LOG).mtimeMs) / 60000)
  return `启动于 ${lines[last].slice(1, 20)}｜最近日志 ${ageMin} 分钟前`
})

if (!CI) await checkAsync('SnowLuma 网关可达', async () => {
  const ob = await import(modUrl(join(ROOT, 'lib', 'onebot.mjs')))
  const acc = ob.readAccounts('C:/SnowLuma').find((x) => x.http)
  if (!acc) throw new Error('读不到 SnowLuma 账号配置')
  const res = await fetch('http://127.0.0.1:3000/get_login_info', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + acc.http.token },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(5000),
  })
  const j = await res.json()
  if (j?.status !== 'ok') throw new Error('get_login_info: ' + JSON.stringify(j).slice(0, 80))
  return '账号 ' + (j.data?.user_id || '?')
}, { soft: true })

if (!CI) await checkAsync('推送端口在监听', () => new Promise((resolve, reject) => {
  const s = net.connect(3101, '127.0.0.1')
  s.setTimeout(3000)
  s.on('connect', () => { s.destroy(); resolve('127.0.0.1:3101 可连') })
  s.on('timeout', () => { s.destroy(); reject(new Error('连接超时')) })
  s.on('error', (e) => reject(new Error(e.message)))
}), { soft: true })

/* ── 输出 ── */
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n)
console.log('\n冒烟测试' + (QUICK ? '（quick）' : '') + '\n' + '─'.repeat(72))
let bad = 0
for (const r of results) {
  const mark = r.ok ? '✅' : r.soft ? '⚠️ ' : '❌'
  if (!r.ok && !r.soft) bad++
  console.log(`${mark} ${pad(r.name, 24)} ${r.detail}`)
}
console.log('─'.repeat(72))
console.log(bad ? `失败 ${bad} 项` : '全部通过')
process.exit(bad ? 1 : 0)
