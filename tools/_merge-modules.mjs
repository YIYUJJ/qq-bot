/**
 * 把多个模块合并成一个文件（只做文件级合并，不改任何工厂逻辑）。
 *
 * 为什么：拆到后期出现一批 30~60 行的小模块，跨文件跳转的成本超过了拆分收益。
 * 合并后导出名不变，index 与测试只改 import 路径。
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const [outFile, ...files] = process.argv.slice(2)
if (!outFile || files.length < 2) throw new Error('用法: node tools/_merge-modules.mjs <输出> <输入1> <输入2> ...')

const importsByMod = new Map() // mod -> Set(names) / default flag
const defaultImports = []
const bodies = []

for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const lines = src.split(/\r?\n/)
  const body = []
  for (const line of lines) {
    const m = line.match(/^import\s+(.+?)\s+from\s+['"](.+?)['"]\s*$/)
    if (m) {
      const what = m[1].trim()
      const mod = m[2]
      if (what.startsWith('{')) {
        const names = what
          .replace(/[{}]/g, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (!importsByMod.has(mod)) importsByMod.set(mod, new Set())
        for (const n of names) importsByMod.get(mod).add(n)
      } else {
        defaultImports.push({ mod, what })
      }
      continue
    }
    body.push(line)
  }
  bodies.push(body.join('\n').replace(/^\s+|\s+$/g, ''))
}

const header = []
for (const { mod, what } of defaultImports) header.push(`import ${what} from '${mod}'`)
for (const [mod, names] of importsByMod) header.push(`import { ${[...names].sort().join(', ')} } from '${mod}'`)

const out = `${header.join('\n')}\n\n${bodies.join('\n\n')}\n`
writeFileSync(outFile, out, 'utf8')
for (const f of files) {
  try {
    unlinkSync(f)
  } catch {
    /* ignore */
  }
}
console.log('合并 →', outFile, '｜来源', files.length, '个｜import 模块', header.length, '行')
