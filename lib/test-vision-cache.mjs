/** vision-cache.mjs 回归测试：key 归一化、命中/过期、上限裁剪、落盘。 运行：node lib/test-vision-cache.mjs */
import { createVisionCache } from './vision-cache.mjs'

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

const writes = []
const vc = createVisionCache({
  file: 'vision.json',
  config: { visionCacheMax: 25 },
  readJson: () => ({}),
  writeJson: (f, v) => writes.push(Object.keys(v).length),
  log: () => {},
})

// key 归一化：易变参数丢掉、fileid 保留
const a = vc.key('https://img.qq.com/a?fileid=123&rkey=deadbeef')
const b = vc.key('https://img.qq.com/a?rkey=other&fileid=123')
ok(a === b, '同一张图不同 rkey 归一化成同一个 key')
ok(a.includes('fileid=123'), 'key 保留 fileid')
ok(!a.includes('rkey'), 'key 丢掉 rkey')
ok(vc.key('not-a-url') === 'not-a-url', '非法 url 原样返回')

// 命中 / 过期
vc.set('https://img.qq.com/1?fileid=1', { text: '一只猫' })
ok(vc.get('https://img.qq.com/1?fileid=1')?.text === '一只猫', '刚写入的能命中')
vc.cache[Object.keys(vc.cache)[0]].at = Date.now() - 8 * 86400000
ok(vc.get('https://img.qq.com/1?fileid=1') === null, '7 天前的成功结果过期')

// 错误结果只缓存 10 分钟
vc.set('https://img.qq.com/2?fileid=2', { err: 'fetch failed' })
const errKey = Object.keys(vc.cache).find((k) => vc.cache[k].err)
ok(!!errKey, '错误结果写进缓存')
vc.cache[errKey].at = Date.now() - 11 * 60000
ok(vc.get('https://img.qq.com/2?fileid=2') === null, '10 分钟前的错误不再命中')

// 上限裁剪
for (let i = 0; i < 30; i++) vc.set(`https://img.qq.com/x${i}?fileid=x${i}`, { text: 't' + i })
ok(Object.keys(vc.cache).length <= 25, '缓存被裁到上限（25）')

// 落盘
ok(vc.dirty === true, '写过后是脏的')
ok(vc.persist() === true, 'persist 成功')
ok(vc.dirty === false, 'persist 后不脏')
ok(writes.length >= 1, '确实调用了写盘')

console.log('')
if (fails.length) {
  console.log(`❌ test-vision-cache.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-vision-cache.mjs 通过 ${pass} 项，失败 0 项`)
