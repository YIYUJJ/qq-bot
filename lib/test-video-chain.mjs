/** video-chain.mjs 回归测试：缓存 key、缓存读写、视频描述分支。 运行：node lib/test-video-chain.mjs */
import { VIDEO_CHAIN_DEPS, createVideoChain } from './video-chain.mjs'

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
  createVideoChain({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(VIDEO_CHAIN_DEPS.includes('videoCache'), '依赖清单')

function build(over = {}) {
  const videoCache = {}
  const writes = []
  const deps = {
    config: { videoFrames: 4, videoSheetWidth: 480, videoMaxBytes: 50 },
    log: () => {},
    describeBuffer: async () => '视频里是一只猫在跑',
    ffmpegBin: 'ffmpeg',
    ffprobeBin: 'ffprobe',
    VIDEO_DIR: 'C:/tmp/video',
    hashStr: () => 12345,
    videoCache,
    VIDEO_CACHE_FILE: 'video-cache.json',
    writeJson: (f, v) => writes.push([f, JSON.parse(JSON.stringify(v))]),
    ...over,
  }
  return { chain: createVideoChain(deps), videoCache, writes }
}

// videoKey：同一条视频不同 token 归一
const a = build()
const k1 = a.chain.videoKey('https://v.qq.com/x?token=abc')
const k2 = a.chain.videoKey('https://v.qq.com/x?token=xyz')
ok(k1 === k2, '同一视频不同 token 得到相同 key')
ok(typeof k1 === 'string' && k1.length > 0, 'key 非空')

// 缓存读写
a.chain.videoCacheSet('k1', '猫', 12)
ok(a.chain.videoCacheGet('k1')?.text === '猫', '写入后能读出')
ok(a.writes.length >= 1, '写入会落盘')
ok(a.chain.videoCacheGet('none') === undefined || a.chain.videoCacheGet('none') === null, '不存在的 key 返回空')

// 过期缓存（超过 24h）
a.chain.videoCacheSet('k2', '旧', 5)
a.videoCache.k2.at = Date.now() - 15 * 86400000
const stale = a.chain.videoCacheGet('k2')
ok(stale === null, '过期缓存不返回')

// describeVideo：本地文件不存在 → 返回空描述
const b = build()
const r = await b.chain.describeVideo('C:/not-exist/none.mp4', { videoFrames: 4 })
ok(r && typeof r === 'object', 'describeVideo 返回对象')
ok(r.desc === '', '拿不到视频时 desc 为空')

console.log('')
if (fails.length) {
  console.log(`❌ test-video-chain.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-video-chain.mjs 通过 ${pass} 项，失败 0 项`)
