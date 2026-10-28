/**
 * 打 Release 包：把插件运行需要的文件压成 dist/qq-bot-v<version>.zip
 *
 * 不含测试、开发脚本、node_modules；解压后即是一个可 link 的插件目录。
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version || '0.0.0'
const distDir = join(ROOT, 'dist')
const stageName = `qq-bot-v${version}`
const stageDir = join(distDir, stageName)
const zipPath = join(distDir, `${stageName}.zip`)

function readFileSync(p) {
  return execFileSync(process.execPath, ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(p)}))`], {
    encoding: 'utf8',
  })
}

// 1) 清理旧的暂存目录
if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true })
mkdirSync(stageDir, { recursive: true })

// 2) 收集文件：运行必需 + 安装文档
const topFiles = ['package.json', 'cordis.patch.yml', 'eslint.config.mjs', 'README.md', 'INSTALL.md', 'AGENTS.md', 'LICENSE', 'icon.svg']
const dirs = [
  { from: 'lib', filter: (f) => f.endsWith('.mjs') && !f.startsWith('test-') && f !== 'client.js.map' },
  { from: 'panel', filter: () => true },
  { from: 'locale', filter: () => true },
  { from: 'scripts', filter: (f) => ['doctor.mjs', 'setup.mjs', 'smoke.mjs'].includes(f) },
  { from: 'docs', filter: () => true },
]

let copied = 0
for (const f of topFiles) {
  if (existsSync(join(ROOT, f))) {
    cpSync(join(ROOT, f), join(stageDir, f))
    copied += 1
  }
}
for (const { from, filter } of dirs) {
  const srcDir = join(ROOT, from)
  if (!existsSync(srcDir)) continue
  const dstDir = join(stageDir, from)
  mkdirSync(dstDir, { recursive: true })
  for (const name of readdirSync(srcDir)) {
    if (!filter(name)) continue
    const s = join(srcDir, name)
    if (!statSync(s).isFile()) continue
    cpSync(s, join(dstDir, name))
    copied += 1
  }
}
// 面板构建产物：client.js 在 lib 下但不能被 test 过滤误伤（上面 filter 只排除 test- 前缀，client.js 会被复制）
console.log(`暂存 ${copied} 个文件 → ${relative(ROOT, stageDir)}`)

// 3) 压缩（Windows 自带 bsdtar：tar -a 会按扩展名生成 zip）
if (existsSync(zipPath)) rmSync(zipPath, { force: true })
execFileSync('tar', ['-a', '-c', '-f', zipPath, '-C', stageDir, '.'], { stdio: 'inherit' })
const size = (statSync(zipPath).size / 1024).toFixed(0)
console.log(`已生成 ${relative(ROOT, zipPath)}（${size} KB）`)

// 4) 清单（方便核对）
const manifest = {
  name: pkg.name,
  version,
  builtAt: new Date().toISOString(),
  zip: `${stageName}.zip`,
  sha256: execFileSync(process.execPath, [
    '-e',
    `const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(${JSON.stringify(zipPath)})).digest('hex'))`,
  ], { encoding: 'utf8' }),
}
writeFileSync(join(distDir, `${stageName}.manifest.json`), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log('manifest:', JSON.stringify(manifest.sha256).slice(0, 20) + '…')
