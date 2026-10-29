#!/usr/bin/env node
/**
 * 面板脚本"未定义变量 / 先用后定义"检查：把 panel/index.html 里的 <script> 抽出来，用 ESLint 跑一遍。
 *
 * 为什么要它：面板是单文件内联脚本，lib/ 的 lint 管不到；
 * 某个函数里的局部 helper（比如 busy）被别的页面直接调用，语法检查发现不了，
 * 只有点按钮时才在浏览器里报 "xxx is not defined"。
 * no-use-before-define 只查同一层里"const/let 还没定义就先用"（运行指标页曾因此显示"指标读取失败"）；
 * 写在函数里、等调用时才用到的不算。
 *
 * 用法：node tools/check-panel-undef.mjs   （有问题则非 0 退出）
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const html = readFileSync(join(ROOT, 'panel', 'index.html'), 'utf8')
const s = html.indexOf('<script>')
const e = html.lastIndexOf('</script>')
if (s < 0 || e < 0) throw new Error('panel/index.html 里找不到 <script>')

const dir = mkdtempSync(join(tmpdir(), 'qqbot-panel-'))
const file = join(dir, 'panel.js')
writeFileSync(file, html.slice(s + '<script>'.length, e), 'utf8')

const BROWSER = [
  'window', 'document', 'localStorage', 'sessionStorage', 'location', 'history', 'navigator', 'fetch', 'console',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
  'Blob', 'URL', 'URLSearchParams', 'FileReader', 'FormData', 'Event', 'CustomEvent', 'HTMLElement', 'Node',
  'MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'getComputedStyle', 'matchMedia', 'performance',
  'confirm', 'alert', 'prompt', 'structuredClone', 'AbortController', 'TextEncoder', 'TextDecoder',
]

try {
  const eslint = new ESLint({
    cwd: dir,
    overrideConfigFile: true,
    overrideConfig: {
      languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: Object.fromEntries(BROWSER.map((g) => [g, 'readonly'])) },
      rules: {
        'no-undef': 'error',
        'no-use-before-define': ['error', { functions: false, classes: false, variables: false }],
      },
    },
  })
  const [res] = await eslint.lintFiles([file])
  const bad = res.messages.filter((m) => m.ruleId === 'no-undef' || m.ruleId === 'no-use-before-define' || m.fatal)
  if (bad.length) {
    for (const m of bad) console.log(`❌ panel 脚本第 ${m.line} 行：${m.message}`)
    process.exitCode = 1
  } else {
    console.log('✅ 面板脚本没有未定义、先用后定义的变量')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
