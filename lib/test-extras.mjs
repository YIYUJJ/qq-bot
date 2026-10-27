/**
 * 纯函数单测：extras.mjs（骰子 / 提醒解析 / 链接挑选 / 文档扩展名）
 * 用法：node lib/test-extras.mjs
 */
import { rollDice, rps, drawLot, pickRiddle, parseReminder, pickWebLink, extractDocText } from './extras.mjs'

let pass = 0
let fail = 0
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else {
    fail++
    console.log(`❌ ${name}\n   got : ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`)
  }
}
function ok(name, cond, detail = '') {
  if (cond) pass++
  else {
    fail++
    console.log(`❌ ${name} ${detail}`)
  }
}

/* 骰子 */
const d1 = Number(rollDice('掷骰子'))
ok('骰子 1d6 范围', d1 >= 1 && d1 <= 6, String(d1))
const d2 = rollDice('2d6')
ok('2d6 格式', /^\d+ \+ \d+ = \d+$/.test(d2), d2)
const [a, b, sum] = d2.split(/ \+ | = /).map(Number)
eq('2d6 求和', a + b, sum)
ok('骰子面数上限', (() => {
  for (let i = 0; i < 50; i++) {
    const v = Number(rollDice('掷骰子'))
    if (v < 1 || v > 6) return false
  }
  return true
})())

/* 猜拳 */
for (const pick of ['石头', '剪刀', '布']) {
  const r = rps(pick)
  ok(`猜拳结果合法 ${pick}`, ['石头', '剪刀', '布'].includes(r.me) && ['赢', '输', '平'].some((k) => r.res.includes(k)) || r.res === '我赢' || r.res === '你赢', JSON.stringify(r))
}
ok('猜拳平局判定', (() => {
  for (let i = 0; i < 30; i++) {
    const r = rps('石头')
    if (r.me === r.you && r.res !== '平') return false
  }
  return true
})())

/* 抽签 / 谜语 */
ok('抽签在词表里', ['大吉', '中吉', '小吉', '吉', '末吉', '凶', '大凶'].includes(drawLot()))
const riddle = pickRiddle()
ok('谜语有题有答案', typeof riddle.q === 'string' && riddle.q.length > 4 && typeof riddle.a === 'string' && riddle.a.length > 0)

/* 提醒解析 */
const now = new Date('2026-10-27T22:00:00')
const r1 = parseReminder('10 分钟后提醒我喝水', now)
eq('10 分钟后：文本', r1 && r1.text, '喝水')
eq('10 分钟后：时间', r1 && Math.round((r1.at - now.getTime()) / 60000), 10)

const r2 = parseReminder('半小时后叫我关火', now)
eq('半小时后：时间', r2 && Math.round((r2.at - now.getTime()) / 60000), 30)

const r3 = parseReminder('明天 8:30 提醒我开会', now)
ok('明天 8:30：跨天', r3 && new Date(r3.at).getDate() === 28 && new Date(r3.at).getHours() === 8 && new Date(r3.at).getMinutes() === 30, r3 && new Date(r3.at).toString())
eq('明天 8:30：文本', r3 && r3.text, '开会')

const r4 = parseReminder('22点提醒我睡觉', now)
ok('22 点：时间', r4 && new Date(r4.at).getHours() === 22 && new Date(r4.at).getMinutes() === 0)
eq('22 点：文本', r4 && r4.text, '睡觉')

eq('没有意图词 → null', parseReminder('今天好热', now), null)
eq('只有意图没时间 → null', parseReminder('提醒我一下', now), null)

/* 链接挑选 */
eq('普通链接', pickWebLink('看这个 https://example.com/a?b=1 挺好'), ['https://example.com/a?b=1'])
eq('排除 B 站', pickWebLink('https://www.bilibili.com/video/BV1xx'), [])
eq('排除 b23', pickWebLink('https://b23.tv/abc'), [])
eq('排除图片直链', pickWebLink('https://a.com/x.jpg'), [])
ok('多个链接只取 1 个', pickWebLink('https://a.com/1 https://b.com/2', 1).length === 1)
eq('中文标点后截断', pickWebLink('看 https://a.com/x，然后呢'), ['https://a.com/x'])

/* 文档扩展名 */
const txt = await extractDocText(new URL('./extras.mjs', import.meta.url).pathname.replace(/^\//, ''), 'js')
ok('不支持的扩展名会报错', txt.ok === false && /不支持/.test(txt.error), JSON.stringify(txt).slice(0, 80))

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`)
if (fail) process.exit(1)
