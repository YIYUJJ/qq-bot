/**
 * 静态扫描：找那些"语法能过、但运行时会踩"的问题。
 * 用法：node tools/static-scan.cjs
 */
const fs = require('fs')
const path = require('path')

const ROOT = 'D:/dpswork/packages/dsh-qq-bot'
const files = {}
for (const f of fs.readdirSync(path.join(ROOT, 'lib'))) {
  if (f.endsWith('.js') || f.endsWith('.mjs')) files[f] = fs.readFileSync(path.join(ROOT, 'lib', f), 'utf8')
}
const panel = fs.readFileSync(path.join(ROOT, 'panel', 'index.html'), 'utf8')
const index = files['index.js'] || ''

const findings = []
const add = (level, file, line, title, detail) => findings.push({ level, file, line, title, detail })

/* 1) config.xxx 拼写错误：出现的键必须在默认配置里 */
const defaultBlock = index.slice(index.indexOf('const DEFAULT_CONFIG'), index.indexOf('const BOOLEAN'))
const knownKeys = new Set([...defaultBlock.matchAll(/^  ([A-Za-z_][A-Za-z0-9_]*):/gm)].map((m) => m[1]))
const used = new Map()
for (const [f, txt] of Object.entries(files)) {
  txt.split('\n').forEach((ln, i) => {
    for (const m of ln.matchAll(/\bconfig\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (!knownKeys.has(m[1])) used.set(m[1], (used.get(m[1]) || []).concat(`${f}:${i + 1}`))
    }
  })
}
for (const [k, where] of used) add('high', where[0].split(':')[0], where[0].split(':')[1], 'config 键不存在: ' + k, where.slice(0, 3).join(', '))

/* 2) 重复的顶层函数声明（后面的会覆盖前面的） */
const fnDecl = [...index.matchAll(/^  (?:async )?function ([A-Za-z0-9_]+)\(/gm)].map((m) => m[1])
const dup = fnDecl.filter((n, i) => fnDecl.indexOf(n) !== i)
if (dup.length) add('high', 'index.js', '', '重复函数声明', [...new Set(dup)].join(', '))

/* 3) sendReply 调用但没 await（会丢消息/乱序） */
index.split('\n').forEach((ln, i) => {
  if (!/\bsendReply\(/.test(ln)) return
  if (/\b(await|return|void)\b/.test(ln)) return
  if (/function sendReply/.test(ln)) return
  if (/^\s*const .*=\s*await/.test(ln)) return
  add('high', 'index.js', String(i + 1), 'sendReply 未 await', ln.trim().slice(0, 100))
})
for (const [f, txt] of Object.entries(files)) {
  if (f === 'index.js') continue
  txt.split('\n').forEach((ln, i) => {
    if (/\bsendReply\(/.test(ln) && !/\b(await|return|void)\b/.test(ln) && !/function sendReply/.test(ln)) {
      add('high', f, String(i + 1), 'sendReply 未 await', ln.trim().slice(0, 100))
    }
  })
}

/* 4) JSON.parse 没包 try */
for (const [f, txt] of Object.entries(files)) {
  txt.split('\n').forEach((ln, i) => {
    if (!/JSON\.parse\(/.test(ln)) return
    const ctx = txt.split('\n').slice(Math.max(0, i - 3), i + 1).join('\n')
    if (!/try\s*\{/.test(ctx)) add('mid', f, String(i + 1), 'JSON.parse 未包 try', ln.trim().slice(0, 90))
  })
}

/* 5) 面板：重复 id */
const ids = [...panel.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1])
const dupIds = ids.filter((n, i) => ids.indexOf(n) !== i)
if (dupIds.length) add('high', 'panel/index.html', '', '重复 DOM id', [...new Set(dupIds)].join(', '))

/* 6) 面板调用的 action 必须在后端有 case */
const panelActions = new Set([...panel.matchAll(/action\('([a-z][a-z0-9.]*)'/g)].map((m) => m[1]))
const serverActions = new Set([...index.matchAll(/case '([a-z][a-z0-9.]*)':/g)].map((m) => m[1]))
for (const a of panelActions) if (!serverActions.has(a)) add('high', 'panel/index.html', '', '面板调用了不存在的 action: ' + a, '')
for (const a of serverActions) if (!panelActions.has(a) && !['state', 'action'].includes(a)) add('low', 'index.js', '', '后端 action 面板未使用: ' + a, '')

/* 7) 导航分组 vs GROUPS */
const metaSrc = files['meta.mjs'] || ''
const groupIds = [...metaSrc.matchAll(/\{ id: '([a-z-]+)', title:/g)].map((m) => m[1])
const navGroups = [...panel.matchAll(/groups: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]))
const missingNav = groupIds.filter((g) => !navGroups.includes(g))
if (missingNav.length) add('mid', 'panel/index.html', '', '这些分组没有导航页', missingNav.join(', '))

/* 8) 面板 onclick 指向的函数必须存在 */
const panelFns = new Set([...(panel.matchAll(/function ([A-Za-z0-9_]+)\(/g))].map((m) => m[1]))
const handlerFns = [...panel.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)\.(?:onclick|onchange)\s*=\s*([A-Za-z0-9_]+)/g)].map((m) => m[2])
for (const h of handlerFns) if (!panelFns.has(h) && !['load', 'render'].includes(h)) add('low', 'panel/index.html', '', 'onclick 指向未知函数: ' + h, '')

/* 9) features/extras 里引用了没 import 的常见工具 */
for (const [f, txt] of Object.entries(files)) {
  if (f === 'index.js') continue
  const imported = new Set()
  for (const m of txt.matchAll(/import \{([^}]+)\} from/g)) {
    for (const part of m[1].split(',')) imported.add(part.trim().split(/\s+as\s+/).pop())
  }
  for (const name of ['rollDice', 'rps', 'drawLot', 'pickRiddle', 'parseReminder', 'pickWebLink', 'fetchPageSummary', 'extractDocText', 'readDiary', 'appendDiary', 'writeSelf', 'readSelf', 'join', 'randomUUID']) {
    const usedRe = new RegExp('\\b' + name + '\\s*\\(')
    if (usedRe.test(txt) && !imported.has(name) && !new RegExp('function ' + name).test(txt)) {
      add('high', f, '', '用了但没 import: ' + name, '')
    }
  }
}

/* 输出 */
const order = { high: 0, mid: 1, low: 2 }
findings.sort((a, b) => order[a.level] - order[b.level])
console.log(`静态扫描：${findings.length} 条\n` + '─'.repeat(78))
for (const f of findings) {
  const tag = f.level === 'high' ? '❌' : f.level === 'mid' ? '⚠️ ' : '·'
  console.log(`${tag} ${f.file}${f.line ? ':' + f.line : ''}  ${f.title}${f.detail ? '  ← ' + f.detail : ''}`)
}
if (!findings.length) console.log('没发现问题')
process.exit(findings.some((f) => f.level === 'high') ? 1 : 0)
