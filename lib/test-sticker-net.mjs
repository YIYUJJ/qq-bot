/** sticker-net.mjs 回归测试：本地化、发送、维护（用假 fs/ob）。 运行：node lib/test-sticker-net.mjs */
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { STICKER_NET_DEPS, createStickerNet } from './sticker-net.mjs'

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

let threw = ''
try {
  createStickerNet({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(STICKER_NET_DEPS.includes('ob'), '依赖清单')

const dir = mkdtempSync(join(tmpdir(), 'qqbot-stickernet-'))
try {
  const stickers = {}
  const sent = []
  const favs = []
  const api = createStickerNet({
    config: { dryRun: false, stickerFavoriteMax: 10 },
    log: () => {},
    ob: {
      call: async (action) => {
        if (action === 'get_image') return { status: 'ok', data: { file: Buffer.from('png').toString('base64') } }
        return { status: 'ok', data: {} }
      },
      sendGroupSegments: async (roomId, segs) => {
        sent.push([roomId, segs])
        return { message_id: 1 }
      },
    },
    roomState: (id) => ({ roomId: id, lastReplyAt: 0, replyTimes: [] }),
    sendWithRetry: async (roomId, isGroup, kind, payload) => {
      sent.push([roomId, payload])
      return { queued: false }
    },
    sleep: async () => {},
    stats: { stickersSent: 0 },
    stickers,
    STICKER_DIR: dir,
    hashStr: (s) => String(s).length,
    mediaKey: (u) => u,
    markStickersDirty: () => {},
  })

  // ensureStickerFile：没有 url 时抛错
  let t2 = false
  try {
    await api.ensureStickerFile({}, 'x')
  } catch {
    t2 = true
  }
  ok(t2, '没有 url 时抛错')

  // sendStickerTo：未知 id 返回错误
  const r1 = await api.sendStickerTo('900001', { url: 'http://x/a.png' }, 'nope')
  ok(r1 && typeof r1 === 'object', 'sendStickerTo 返回结果对象')

  // sweep：空图库不抛错
  const r2 = await api.sweepStickerLibrary()
  ok(r2 === undefined || typeof r2 === 'object', 'sweep 空图库不抛错')

  // favoriteSticker：配置上限内可调用
  await api.favoriteSticker({ url: 'http://x/a.png' }, 'http://x/a.png', 'id1')
  ok(true, 'favoriteSticker 可调用')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-sticker-net.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-sticker-net.mjs 通过 ${pass} 项，失败 0 项`)
