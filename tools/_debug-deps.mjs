import { readFileSync } from 'node:fs'

const raw = readFileSync('lib/http-api.mjs', 'utf8')
const m = raw.match(/[A-Z_]+_DEPS = (\[[\s\S]*?\])/)
console.log('找到 DEPS:', !!m)
if (m) {
  const names = [...m[1].matchAll(/["']([A-Za-z_$][\w$]*)["']/g)].map((x) => x[1])
  console.log('数量:', names.length)
  for (const k of ['CONFIG_KEYS', 'ROOM_KEYS', 'rmSync', 'existsSync']) console.log(k, names.includes(k))
  console.log('前 100 字符:', m[1].slice(0, 100))
}
const raw2 = readFileSync('lib/sticker-net.mjs', 'utf8')
console.log('sticker-net 用 readFileSync:', raw2.includes('readFileSync'))
console.log('sticker-net import fs 行:', raw2.split('\n').find((l) => l.includes("from 'node:fs'")))
