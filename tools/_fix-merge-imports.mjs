import { readFileSync, writeFileSync, readdirSync } from 'node:fs'

const map = [
  { from: "'./room-config.mjs'", to: "'./rooms.mjs'" },
  { from: "'./room-state.mjs'", to: "'./rooms.mjs'" },
  { from: "'./access.mjs'", to: "'./rooms.mjs'" },
  { from: "'./media-cache.mjs'", to: "'./media.mjs'" },
  { from: "'./video-files.mjs'", to: "'./media.mjs'" },
]

function rewrite(file) {
  let s = readFileSync(file, 'utf8')
  const before = s
  for (const { from, to } of map) s = s.split(from).join(to)
  if (s !== before) {
    writeFileSync(file, s, 'utf8')
    return true
  }
  return false
}

const files = ['lib/index.js', ...readdirSync('lib').filter((f) => f.startsWith('test-')).map((f) => 'lib/' + f)]
let n = 0
for (const f of files) if (rewrite(f)) n += 1
console.log('更新 import 的文件数:', n)
