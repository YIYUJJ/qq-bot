import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('docs/ARCHITECTURE.md', 'utf8')

// 领域模块：合并后的清单
s = s.replace(
  /│ {3}room-config[^\n]*\n│ {3}room-state[^\n]*\n│ {3}access[^\n]*\n/,
  '│   rooms          每群覆盖 + cfgFor 缓存 + 会话状态 + 白名单闸\n',
)
s = s.replace(/│ {3}model {10}模型调用[^\n]*\n│ {3}model-route[^\n]*\n/, '│   model          模型调用（generate/analyze/关键词）+ 模型路由（对话/视觉）\n')
// 基础设施：state-db 已并入 state-store
s = s.replace(/ {7}state-db[^\n]*\n/, '')
s = s.replace(/ {7}state-store {2}replied\/usage[^\n]*/, '       state-store  replied/usage 持久化（脏标记 + SQLite 状态库 + JSON 回落）')

writeFileSync('docs/ARCHITECTURE.md', s, 'utf8')
console.log('文档已按合并后的模块更新')
