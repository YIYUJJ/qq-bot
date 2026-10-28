import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('lib/test-vision.mjs', 'utf8')
// 顶部加本地图床
s = s.replace(
  "import { VISION_DEPS, createVisionChain } from './vision.mjs'",
  "import { createServer } from 'node:http'\nimport { VISION_DEPS, createVisionChain } from './vision.mjs'",
)
s = s.replace(
  "let threw = ''",
  `const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const imgServer = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'image/png' })
  res.end(pngBytes)
})
await new Promise((resolve) => imgServer.listen(0, '127.0.0.1', resolve))
const IMG = \`http://127.0.0.1:\${imgServer.address().port}/a.png\`

let threw = ''`,
)
// 所有 http://x/... 换成 IMG
s = s.replace(/'http:\/\/x\/a\.png'/g, 'IMG')
s = s.replace(/'http:\/\/x\/hit\.png'/g, 'IMG')
s = s.replace(/'http:\/\/x\/fail\.png'/g, 'IMG')
s = s.replace(/'http:\/\/x\/off\.png'/g, 'IMG')
s = s.replace(/\['http:\/\/x\/a\.png'\]/g, '[IMG]')
// 结尾关服务器
s = s.replace("console.log('')\nif (fails.length) {", "imgServer.close()\n\nconsole.log('')\nif (fails.length) {")
writeFileSync('lib/test-vision.mjs', s, 'utf8')
console.log('vision 测试改用本地图床')
