import { readFileSync, writeFileSync } from 'node:fs'

const factoryNames = ['statusTools', 'diagnosticTools', 'readTools', 'inspectTools', 'stickerTools', 'actionTools', 'configTools', 'contentTools', 'videoTools', 'simulateTools', 'opsTools', 'replyTools', 'miscTools', 'selftestTools', 'memoryTools', 'panelTools']

let idx = readFileSync('lib/index.js', 'utf8')
const removedImports = []
for (const n of factoryNames) {
  const re = new RegExp('^import \\{ ' + n + " \\} from '\\./tools-[a-z-]+\\.mjs'\\r?\\n", 'm')
  if (re.test(idx)) {
    idx = idx.replace(re, '')
    removedImports.push(n)
  }
}
// 从 registerAllTools 调用里删掉这些名字
const start = idx.indexOf('registerAllTools(ctx, safeRegister, {')
const end = idx.indexOf('})', start)
const objText = idx.slice(start, end)
const lines = objText.split(/\r?\n/).map((line) => {
  let l = line
  for (const n of factoryNames) {
    l = l.replace(new RegExp('\\b' + n + '\\b,?\\s*'), '')
  }
  return l.replace(/,\s*$/, ',').replace(/,\s*,/g, ',')
})
idx = idx.slice(0, start) + lines.join('\n') + idx.slice(end)
writeFileSync('lib/index.js', idx, 'utf8')

let mod = readFileSync('lib/register-tools.mjs', 'utf8')
for (const n of factoryNames) mod = mod.replace(new RegExp('\\b' + n + '\\b,?\\s*(?=[A-Za-z_$])', ''), '')
writeFileSync('lib/register-tools.mjs', mod, 'utf8')
console.log('已移除 index 里的工具工厂 import：', removedImports.length)
