import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-video-chain.mjs', 'utf8')
s = s.replace("a.chain.videoCacheSet('k1', { desc: '猫' })", "a.chain.videoCacheSet('k1', '猫', 12)")
s = s.replace("ok(a.chain.videoCacheGet('k1')?.desc === '猫', '写入后能读出')", "ok(a.chain.videoCacheGet('k1')?.text === '猫', '写入后能读出')")
s = s.replace("a.chain.videoCacheSet('k2', { desc: '旧' })", "a.chain.videoCacheSet('k2', '旧', 5)")
s = s.replace("a.videoCache.k2.at = Date.now() - 25 * 3600000", "a.videoCache.k2.at = Date.now() - 15 * 86400000")
s = s.replace("ok(stale === undefined || stale === null, '过期缓存不返回')", "ok(stale === null, '过期缓存不返回')")
writeFileSync('lib/test-video-chain.mjs', s, 'utf8')
console.log('测试按真实签名/14 天过期修正')
