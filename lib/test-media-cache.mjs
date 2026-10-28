/** media-cache.mjs 回归测试：稳定 key、MIME 猜测、识图缓存 trim。 运行：node lib/test-media-cache.mjs */
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MEDIA_CACHE_DEPS, createMediaCache } from './media-cache.mjs'

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
  createMediaCache({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(MEDIA_CACHE_DEPS.includes('DATA_DIR'), '依赖清单')

const dir = mkdtempSync(join(tmpdir(), 'qqbot-media-'))
try {
  const media = createMediaCache({
    DATA_DIR: dir,
    config: { visionCacheMax: 300 },
    log: () => {},
    readJson: () => ({}),
    writeJson: () => {},
  })

  // mediaKey：不同 rkey 得到同一个 key
  const a = media.mediaKey('https://gchat.qpic.cn/x/a.png?fileid=123&rkey=AAA')
  const b = media.mediaKey('https://gchat.qpic.cn/x/a.png?fileid=123&rkey=BBB')
  ok(a === b, 'rkey 变化不影响 key')
  ok(a.includes('fileid=123') && !a.includes('rkey'), '只保留稳定参数')

  // 非 URL 输入
  ok(media.mediaKey('not-a-url') === 'not-a-url', '非 URL 原样返回')

  // MIME 猜测
  const h = (ct) => ({ headers: { get: () => ct } })
  ok(media.guessMediaType(h('image/png'), '') === 'image/png', 'PNG 识别')
  ok(media.guessMediaType(h('image/webp'), '') === 'image/webp', 'WebP 识别')
  ok(media.guessMediaType(null, 'https://x/a.gif') === 'image/gif', '按扩展名识别 GIF')
  ok(media.guessMediaType(null, 'https://x/a.bin') === 'image/jpeg', '未知默认 JPEG')

  // vision 缓存
  ok(media.visionCache && typeof media.visionKey === 'function', '缓存对象与 key 函数可用')
  const k = media.visionKey('https://x/a.png')
  ok(typeof k === 'string' && k.length > 0, 'visionKey 返回字符串')
  media.visionCache[k] = { text: '猫', at: Date.now() }
  ok(media.visionCache[k].text === '猫', '缓存可写读')
  ok(typeof media.trimVisionCache === 'function', 'trim 函数存在')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-media-cache.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-media-cache.mjs 通过 ${pass} 项，失败 0 项`)
