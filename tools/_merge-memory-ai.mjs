import { readFileSync, writeFileSync } from 'node:fs'

const L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)
const start = L.findIndex((l) => l.includes('function exportMemory(roomId)'))
if (start < 0) throw new Error('找不到 exportMemory')
// 结束：panelRoomCache 注释前
const end = L.findIndex((l, i) => i > start && l.includes('面板快照：房间没变化就复用'))
if (end < 0) throw new Error('找不到块结束')
const block = L.slice(start, end)
// 去掉尾部空行
while (block.length && block[block.length - 1].trim() === '') block.pop()

// 追加到 memory-ai 模块
let m = readFileSync('lib/memory-ai.mjs', 'utf8')
const returnIdx = m.lastIndexOf('\n  return {')
if (returnIdx < 0) throw new Error('找不到模块 return')
m = m.slice(0, returnIdx) + '\n' + block.map((l) => (l.startsWith('  ') ? l : '  ' + l)).join('\n') + m.slice(returnIdx)
// 更新导出列表
m = m.replace(/return \{ [^}]*\}/, 'return { extractFacts, searchMemory, updateRelations, exportMemory, updateSummary, updateProfile }')
writeFileSync('lib/memory-ai.mjs', m, 'utf8')

// 从 index 删除
L.splice(start, end - start)

// 解构补充
let out = L.join('\n')
out = out.replace('const { extractFacts, searchMemory, updateRelations } = memoryAi', 'const { extractFacts, searchMemory, updateRelations, exportMemory, updateSummary, updateProfile } = memoryAi')
writeFileSync('lib/index.js', out, 'utf8')
console.log('exportMemory/updateSummary/updateProfile 已并入 memory-ai')
