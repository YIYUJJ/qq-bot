import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

function grabFn(name) {
  const s = L.findIndex((l) => new RegExp('^(  )(async )?function ' + name + '\\(').test(l))
  if (s < 0) return false
  let depth = 0
  let started = false
  let end = s
  for (let i = s; i < L.length; i++) {
    for (const ch of L[i]) {
      if (ch === '{') {
        depth++
        started = true
      } else if (ch === '}') depth--
    }
    if (started && depth === 0) {
      end = i
      break
    }
  }
  L.splice(s, end - s + 1)
  return true
}
console.log('roomState', grabFn('roomState'))

const anchor = L.findIndex((l) => l.includes('// 群名缓存（只读，来自 get_group_list）'))
if (anchor < 0) throw new Error('找不到群名缓存锚点')
L.splice(anchor, 0,
  '  // 会话状态交给 lib/room-state.mjs',
  '  const roomStateApi = createRoomState({ groupNames, replied, rooms, savedNames })',
  '  const { roomState } = roomStateApi',
  '',
)

let out = L.join('\n')
if (!out.includes("from './room-state.mjs'")) {
  const a = out.indexOf("import { createRoomConfig } from './room-config.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createRoomState } from './room-state.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('room-state 抽取完成')
