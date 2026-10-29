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

  // 收藏：自动收受开关管；面板手动收（manual）不看开关，结果返回给面板
  {
    const calls = []
    let fail = false
    const cfg = { stickerFavorite: false, stickerFavoriteMax: 1 }
    const lib = { a: {}, b: {} }
    const fav = createStickerNet({
      config: cfg,
      log: () => {},
      ob: {
        call: async (action, params) => {
          calls.push([action, params])
          if (fail) throw new Error('add_custom_face 不支持')
          return { emoji_id: 'E' + calls.length }
        },
      },
      roomState: () => ({}),
      sendWithRetry: async () => ({}),
      sleep: async () => {},
      stats: { stickersSent: 0 },
      stickers: lib,
      STICKER_DIR: dir,
      hashStr: (x) => String(x).length,
      mediaKey: (u) => u,
      markStickersDirty: () => {},
    })
    const s1 = { url: 'http://x/1.png' }
    const auto = await fav.favoriteSticker(s1, s1.url, 's1')
    ok(auto && auto.skipped === 'off' && !calls.length && !s1.emojiId, '开关关着：自动收不调接口')

    const man = await fav.favoriteSticker(s1, s1.url, 's1', { manual: true })
    ok(man && man.ok && s1.emojiId === 'E1' && calls[0][0] === 'add_custom_face' && calls[0][1].file === s1.url, '手动收：开关关着、图库超过上限也收，记下 emojiId')

    const again = await fav.favoriteSticker(s1, s1.url, 's1', { manual: true })
    ok(again && again.ok && again.already && calls.length === 1, '已经收过：不再调接口，返回 already')

    fail = true
    const s2 = { url: '' }
    const bad = await fav.favoriteSticker(s2, '', 's2', { manual: true })
    ok(bad && bad.ok === false && bad.error && !s2.emojiId, '收不进去：返回 ok:false 和原因')
    ok(!calls.some(([, q]) => q && q.file === ''), '没有链接时不拿空链接去试')

    cfg.stickerFavorite = true
    fail = false
    const s3 = { url: 'http://x/3.png' }
    const over = await fav.favoriteSticker(s3, s3.url, 's3')
    ok(over && over.skipped === 'max' && !s3.emojiId, '自动收：图库超过上限就不收')
  }
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
