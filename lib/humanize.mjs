/**
 * 中文去 AI 味后处理（聊天用，不是文章改写）。
 *
 * 词表与规则参考 `humanize-zh-pro` 技能（MIT）的 style-guide 与 detect 脚本，
 * 以及 dsh-deai-audit 的 connectors / templateWords 配置，做了聊天场景的裁剪：
 * 只做"低风险"的替换与删除，不改语义、不增删事实。
 */

// 句首的 AI 连接词 → 口语替代（'' 表示直接删掉这个连接词）
const CONNECTIVE_MAP = [
  ['首先', ''],
  ['其次', ''],
  ['再次', ''],
  ['再者', ''],
  ['此外', '还有'],
  ['另外', '还有'],
  ['与此同时', '同时'],
  ['然而', '不过'],
  ['因此', '所以'],
  ['从而', ''],
  ['进而', '然后'],
  ['综上所述', '说白了'],
  ['总而言之', '说白了'],
  ['总的来说', '大体上'],
  ['总的来看', '大体上'],
  ['值得注意的是', ''],
  ['需要注意的是', ''],
  ['换句话说', '就是说'],
  ['简而言之', '简单说'],
  ['由此可见', '所以'],
  ['不难看出', '看得出'],
  ['毋庸置疑', ''],
  ['众所周知', '大家都知道'],
  ['在当今社会', '现在'],
  ['在当今', '现在'],
]

// 模板化结尾（整句删掉）
const TEMPLATE_ENDINGS = [
  /希望(?:本文|这些|以上内容|这)?(?:对你|对您|能对你|能对您)?有(?:所)?帮助[。！!]?$/,
  /如有(?:任何)?(?:问题|疑问|需要)[^。！？]{0,24}[。！？]?$/,
  /(?:欢迎|期待)(?:您|你)的?(?:反馈|回复|留言)[。！]?$/,
  /(?:以上|希望对你有用)[。！]?$/,
]

/** 句首（串首 / 句号、感叹号、问号、换行之后）替换连接词 */
// 正则预先编译一次：每条回复都要跑，别反复 new RegExp
const CONNECTIVE_RES = CONNECTIVE_MAP.map(([word, replace]) => [
  new RegExp(`(^|[\\n。！？!?])(${word})([，,、]?)`, 'g'),
  replace,
])

function fixConnectives(text) {
  let out = String(text)
  for (const [re, replace] of CONNECTIVE_RES) {
    out = out.replace(re, (m, head) => head + (replace ? replace + '，' : ''))
  }
  // 替换后可能出现 "，还有，..." 这种叠标点
  out = out.replace(/，{2,}/g, '，').replace(/^[，,、\s]+/, '')
  return out
}

/** 删掉模板化结尾句 */
function dropTemplateEnding(text) {
  let out = String(text).trim()
  for (const re of TEMPLATE_ENDINGS) out = out.replace(re, '').trim()
  // 删完整句后可能留下一个孤零零的逗号
  out = out.replace(/[，,、\s]+$/, '')
  return out
}

/** 标点真人化：分号、破折号、重复标点 */
function fixPunctuation(text) {
  return String(text)
    .replace(/；/g, '，')
    .replace(/——/g, '…')
    .replace(/！{2,}/g, '！')
    .replace(/。{2,}/g, '…')
    .replace(/，{2,}/g, '，')
    .replace(/\s+([，。！？!?])/g, '$1')
    .trim()
}

/**
 * @param {string} text
 * @param {{dropPeriod?: number}} opts dropPeriod: 句末句号被吃掉的概率（0~1），模拟真人打字常不打句号
 */
export function humanizeText(text, { dropPeriod = 0 } = {}) {
  let out = String(text ?? '').trim()
  if (!out) return ''
  out = dropTemplateEnding(out)
  out = fixConnectives(out)
  out = fixPunctuation(out)
  // 删句/换标点后可能留下结尾的逗号分号
  out = out.replace(/[，,、；;\s]+$/, '')
  if (dropPeriod > 0 && Math.random() < dropPeriod) out = out.replace(/。$/, '')
  return out
}

export const _lists = { CONNECTIVE_MAP, TEMPLATE_ENDINGS }
