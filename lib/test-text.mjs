/**
 * 纯函数单测：分句 / 截断 / 去 AI 味
 * 这三块直接决定"回复像不像人"，改动最频繁，之前没有独立测试。
 */
import { splitMessage, cleanReply } from './policy.mjs'
import { humanizeText } from './humanize.mjs'

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

/* ── splitMessage ── */
eq('空字符串 → 空数组', splitMessage(''), [])
eq('短句不拆（概率 0）', splitMessage('好呀', { chance: 0 }), ['好呀'])
eq('短句不拆逗号', splitMessage('行吧，那我先睡了', { chance: 0 }), ['行吧，那我先睡了'])

const long = '今天真的是太累了，我从早上八点一直忙到现在，中间连口水都没顾上喝。'
const parts = splitMessage(long, { chance: 1 })
ok('长句会拆', parts.length >= 2, JSON.stringify(parts))
ok('拆出来的每条都不超上限', parts.every((p) => [...p].length <= 40), JSON.stringify(parts.map((p) => [...p].length)))
ok('拼回去内容不丢', parts.join('').replace(/\s/g, '').length >= long.replace(/\s/g, '').length - 2)
ok('不会拆出空串', parts.every((p) => p.trim().length > 0), JSON.stringify(parts))

const noPunct = '啊啊啊'.repeat(30)
const hard = splitMessage(noPunct, { chance: 1 })
ok('没有标点也能拆', hard.length >= 1 && hard.every((p) => [...p].length <= 40), JSON.stringify(hard.length))

/* ── cleanReply ── */
const short = '嗯嗯'
eq('短回复原样', cleanReply(short, { maxLen: 40 }), '嗯嗯')

const longReply = '第一句话说完了。第二句也结束了。第三句话稍微长一点点。'
const cut = cleanReply(longReply, { maxLen: 12 })
ok('超长会被截断', [...cut].length <= 12, cut)
ok('截断不砍在半截标点前', !/[，、]$/.test(cut), cut)

const multi = '第一句。第二句。第三句。第四句。'
const limited = cleanReply(multi, { maxLen: 100, maxLines: 2 })
ok('maxLines 生效', limited.split('\n').length <= 2, JSON.stringify(limited))

/* ── humanizeText ── */
eq('开头连接词去掉', humanizeText('首先，这个方案可行。', { dropPeriod: 0 }), '这个方案可行。')
eq('句首此外→还有', humanizeText('此外，还没说完。', { dropPeriod: 0 }), '还有，还没说完。')
eq('综上→说白了', humanizeText('综上所述，可行。', { dropPeriod: 0 }), '说白了，可行。')

const dropped = humanizeText('我先睡了。', { dropPeriod: 1 })
eq('句末句号可去', dropped, '我先睡了')

const kept = humanizeText('我先睡了。', { dropPeriod: 0 })
eq('dropPeriod=0 保留句号', kept, '我先睡了。')

ok('连续标点会合并', !humanizeText('还有就是，，，这样。', { dropPeriod: 0 }).includes('，，'))
ok('空字符串安全', humanizeText('', { dropPeriod: 0 }) === '')

/* ── 组合：超长 + 去味 ── */
const combo = humanizeText(cleanReply('首先，' + '很长的内容，'.repeat(20), { maxLen: 60 }), { dropPeriod: 1 })
ok('组合链路不崩且不为空', combo.length > 0 && !combo.startsWith('首先'), combo.slice(0, 40))

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`)
if (fail) process.exit(1)
