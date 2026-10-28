import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/roomcfg.mjs'
let s = readFileSync(p, 'utf8')

if (!s.includes("from './schema.mjs'")) {
  // 1) 去掉写死的 ROOM_KEYS 列表，改成从 schema 派生（单一真相）
  const start = s.indexOf('/** 允许按群覆盖的参数')
  const end = s.indexOf('export const ROOM_KEY_SET')
  if (start < 0 || end < 0) throw new Error('找不到 ROOM_KEYS 定义')
  s = s.slice(0, start) + `/**
 * 允许按群覆盖的键 —— 由 schema 从 meta.room 派生（单一真相）。
 * 只允许"表达层"参数：总开关/白名单/模型路由/接入地址永远不可按群覆盖。
 */
export { ROOM_KEYS, ROOM_KEY_SET } from './schema.mjs'
import { ROOM_KEYS, ROOM_KEY_SET } from './schema.mjs'

` + s.slice(end)

  // 2) 删掉后面重复的 ROOM_KEY_SET 定义
  s = s.replace("export const ROOM_KEY_SET = new Set(ROOM_KEYS)\n\n", '')
  writeFileSync(p, s, 'utf8')
  console.log('roomcfg.mjs: ROOM_KEYS 改为 schema 派生')
}
