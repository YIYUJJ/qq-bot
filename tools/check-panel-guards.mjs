#!/usr/bin/env node
/**
 * 面板防回归检查：修过的 bug 别再犯。smoke 会调用；也能单独跑：
 *   node tools/check-panel-guards.mjs [index.html] [panel.css]   （不传就查 panel/ 下的）
 *
 *  1. $('…') 只取一个元素，后面不能接 .forEach / .map 这类（表情包「发送 / 删除」点了没反应就是这个）
 *  2. 每个开关 class="sw" 里都要有 <i></i>（开机自启的开关曾经少了圆点）
 *  3. 脚本里写了 id 的按钮，脚本别处一定要用到这个 id（表情包「删失效」「删普通图」曾经没绑事件）
 *  4. 页面以 <!doctype html> 开头，<body> 和 #qq-panel 之间不能夹杂文字（单独打开 /qq-bot 时顶上曾有一段代码）
 *  5. panel.css 的每条规则都限定在 #qq-panel 里（CSS 会注入整个 DSH，不能影响宿主界面）
 *  6. 有带 hidden 属性的元素时，panel.css 要有强制的 [hidden] 规则（按钮自带 display，"放弃修改"曾经一直显示）
 * 运行指标"先用后定义"那类问题由 tools/check-panel-undef.mjs 的 no-use-before-define 管。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 不限定在 #qq-panel 里也可以的选择器（外壳本身，或只在单独打开 /qq-bot 时生效） */
const CSS_ALLOW = new Set(['html', 'body:not(.qq-embed-host)', '.qq-panel-embed'])

/** 按最外层逗号拆选择器（:not(a, b) 里的逗号不拆） */
function splitTop(s) {
  const parts = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean)
}

/** 找出没限定在 #qq-panel 里的选择器；@media / @supports 里面照样查，@keyframes 里的 from / to 不算 */
export function unscopedSelectors(css) {
  const src = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  const stack = []
  let buf = ''
  for (const ch of src) {
    if (ch === '{') {
      const prelude = buf.trim()
      buf = ''
      if (/^@(media|supports|container|layer)\b/i.test(prelude)) stack.push('group')
      else if (prelude.startsWith('@')) stack.push('skip')
      else {
        if (!stack.includes('skip') && !stack.includes('decl')) {
          for (const sel of splitTop(prelude)) if (!sel.startsWith('#qq-panel') && !CSS_ALLOW.has(sel)) out.push(sel)
        }
        stack.push('decl')
      }
    } else if (ch === '}') {
      stack.pop()
      buf = ''
    } else if (ch === ';' && !stack.length) buf = ''
    else buf += ch
  }
  return out
}

/** 返回发现的问题（空数组 = 没问题） */
export function panelGuards(html, css) {
  const bad = []
  const s = html.indexOf('<script>')
  const e = html.lastIndexOf('</script>')
  const js = s >= 0 && e > s ? html.slice(s + '<script>'.length, e) : ''

  const one = js.match(/(^|[^\w$])\$\(\s*(['"`])[^'"`]*\2\s*(,\s*[\w.]+\s*)?\)\s*\.\s*(forEach|map|filter|some|every)\s*\(/m)
  if (one) bad.push(`$(…) 只返回一个元素，后面却接了 .${one[4]}()，应该用 $$(…)：${one[0].trim().slice(0, 60)}`)

  for (const m of html.matchAll(/<(label|span)\b[^>]*class="sw"[^>]*>([\s\S]*?)<\/\1>/g)) {
    if (!/<i\b[^>]*>\s*<\/i>/.test(m[2])) {
      bad.push('开关少了圆点 <i></i>：' + m[0].replace(/\s+/g, ' ').slice(0, 80))
      break
    }
  }

  const ids = [...new Set([...js.matchAll(/<button\b[^>]*\sid="([\w-]+)"/g)].map((m) => m[1]))]
  const unbound = ids.filter((id) => !new RegExp(`['"\`]#${id}['"\`]`).test(js) && !js.includes(`getElementById('${id}')`))
  if (unbound.length) bad.push('按钮写了 id 却没绑事件：' + unbound.join('、'))

  if (!/^\s*<!doctype html>\s*<html\b/i.test(html)) bad.push('index.html 开头不干净：应该是 <!doctype html> 紧跟 <html>，中间不能夹别的')
  if ((html.match(/<!doctype/gi) || []).length !== 1) bad.push('index.html 里有不止一个 <!doctype>（文件被拼坏了）')
  const body = html.match(/<body[^>]*>([\s\S]*?)<div id="qq-panel"/i)
  if (!body) bad.push('找不到 <body> 后面的 <div id="qq-panel">')
  else if (body[1].replace(/<!--[\s\S]*?-->/g, '').trim()) bad.push('<body> 和 #qq-panel 之间有多余内容：' + body[1].trim().slice(0, 40))

  const loose = unscopedSelectors(css)
  if (loose.length) bad.push(`有 ${loose.length} 条 CSS 没限定在 #qq-panel 里：` + loose.slice(0, 3).join(' ｜ '))

  // 按钮自己设了 display，会盖掉 hidden 属性（"放弃修改"曾经一直显示），所以要有一条强制的 [hidden] 规则
  if (/\shidden[\s>]/.test(js) && !/#qq-panel\s+\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/.test(String(css))) {
    bad.push('panel.css 少了 #qq-panel [hidden]{display:none!important}，带 hidden 的按钮会照样显示')
  }
  return bad
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
  const htmlFile = process.argv[2] || join(ROOT, 'panel', 'index.html')
  const cssFile = process.argv[3] || join(ROOT, 'panel', 'panel.css')
  const bad = panelGuards(readFileSync(htmlFile, 'utf8'), readFileSync(cssFile, 'utf8'))
  if (bad.length) {
    for (const b of bad) console.log('❌ ' + b)
    process.exitCode = 1
  } else console.log('✅ 面板防回归检查通过')
}
