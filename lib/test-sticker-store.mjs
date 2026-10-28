/** sticker-store.mjs 回归测试：收图、上限裁剪、脏标记合并写。 运行：node lib/test-sticker-store.mjs */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStickerStore } from './sticker-store.mjs'

let pass = 0
const fails = []
const ok = (c, n) => {
  if (c) {
    pass += 1
    console.log('  PASS  ' + n)
  } else {
    fails.push(n)
    console.log('  FAIL  ' + n)
  }
}

const dir = mkdtempSync(join(tmpdir(), 'qqbot-sticker-'))
const file = join(dir, 'stickers.json')
const written = []
const stickers = {}
const store = createStickerStore({
  stickers,
  file,
  config: { stickerLibraryMax: 2 },
  writeJson: (f, v) => {
    written.push(JSON.stringify(v))
  },
  hashStr: (s) => s.split('').reduce((a, c) => a + c.charCodeAt(0), 0),
  mediaKey: (u) => u,
  log: () => {},
})

try {
  ok(store.rememberSticker('', 'x', 0) === '', '空 url 返回空 id')
  ok(store.rememberSticker('ftp://x', 'x', 0) === '', '非 http url 被拒')
  const id1 = store.rememberSticker('http://a/1.jpg', '甲', 0)
  ok(!!id1, '正常 url 返回 id')
  ok(stickers[id1].subType === 0, 'sub_type=0 被记录')
  const id2 = store.rememberSticker('http://a/2.jpg', '乙', 1)
  ok(stickers[id2].subType === 1, 'sub_type=1 被记录')

  const id3 = store.rememberSticker('http://a/3.jpg', '丙', 1)
  ok(Object.keys(stickers).length === 2, '超过上限（2）自动裁到 2 张')
  ok(!(id1 in stickers), '最早的一张被裁掉')

  ok(store.dirty === true, '收图后标记为脏')
  ok(store.flushStickersNow() === true, 'flush 返回成功')
  ok(store.dirty === false, 'flush 后脏标记清除')
  ok(written.length >= 1, 'flush 调用了写盘')

  // 重复收同一张：更新而不是新增
  const before = Object.keys(stickers).length
  store.rememberSticker('http://a/3.jpg', '丁', 1)
  ok(Object.keys(stickers).length === before, '同一张图重复收不会新增')

  // dispose 清掉 pending 定时器
  store.markStickersDirty()
  store.dispose()
  ok(store.dirty === false, 'dispose 会立即落盘并清脏')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-sticker-store.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-sticker-store.mjs 通过 ${pass} 项，失败 0 项`)
