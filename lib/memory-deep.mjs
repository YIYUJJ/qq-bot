/**
 * 记忆深化：共用的常量和纯函数（方案：qqbot-docs/design/记忆深化方案.md）。
 *
 * 8 项功能分在这几个文件里：
 *   memory-store.mjs        2 变化线 / 3 情绪权重 / 7 来源和把握度（事实本身的字段和读写）
 *   memory-ai.mjs           提炼格式升级（情绪/强度、依据行号、STORY）
 *   deep-story.mjs          4 我们之间的故事
 *   deep-links.mjs          5 联想
 *   deep-consolidate.mjs    6 每晚整理
 *   deep-insights.mjs       1 反思归纳
 *   deep-recall.mjs         8 偶尔主动想起往事
 *   deep.mjs                把上面几个装在一起（提示词片段、每晚任务、面板状态）
 *
 * 这里只放不依赖状态的东西，方便单测。
 */

export const DAY = 86400000

/** 情绪取值；平静的强度固定 1 */
export const EMOTIONS = ['开心', '难过', '生气', '感动', '害怕', '尴尬', '期待', '平静']
/** 来源取值；旧记忆没有来源 = 未知（空字符串） */
export const SOURCES = ['亲口说', '别人说', '推测', '观察', '手动添加']
/** 强度 ≥ 4 时提示"注意分寸"的情绪（第 3 项） */
export const TACT_EMOTIONS = new Set(['难过', '生气', '害怕', '尴尬'])
/** 强度 ≥ 4 时不主动提起的情绪（第 8 项） */
export const SAD_EMOTIONS = new Set(['难过', '生气', '尴尬'])

export function localDay(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d)
  return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
}
export function addDays(day, n) {
  const [y, m, d] = String(day).split('-').map(Number)
  return localDay(new Date(y, m - 1, d + Number(n || 0)))
}
export function dayStart(day) {
  const [y, m, d] = String(day).split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}
/** 两个日期（'YYYY-MM-DD'）相差几天（b - a） */
export function daysBetween(a, b) {
  return Math.round((dayStart(b) - dayStart(a)) / DAY)
}

export function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}

/** 一条事实的情绪（缺省 平静 / 1） */
export function emotionOf(f) {
  const emotion = EMOTIONS.includes(f?.emotion) ? f.emotion : '平静'
  const intensity = emotion === '平静' ? 1 : clampInt(f?.intensity, 1, 5, 1)
  return { emotion, intensity }
}
export function intensityOf(f) {
  return emotionOf(f).intensity
}

/**
 * 解析提炼输出里的"情绪/强度"字段：开心/3、难过 4、平静、- 都行。
 * 认不出来按 平静 / 1；写了情绪没写强度按 2。
 */
export function parseEmotion(v) {
  const s = String(v || '').trim()
  const m = new RegExp('^(' + EMOTIONS.join('|') + ')\\s*(?:[/／:：|,，\\s]\\s*)?([1-5])?').exec(s)
  if (!m) return { emotion: '平静', intensity: 1 }
  const emotion = m[1]
  if (emotion === '平静') return { emotion, intensity: 1 }
  return { emotion, intensity: m[2] ? Number(m[2]) : 2 }
}
/** 字段像不像"情绪/强度"（用来区分新旧两种提炼格式） */
export function looksLikeEmotion(v) {
  const s = String(v || '').trim()
  return s === '-' || s === '' || new RegExp('^(' + EMOTIONS.join('|') + ')\\s*(?:[/／:：,，\\s]\\s*)?[1-5]?$').test(s)
}
/** "依据行号"：3,5 / 3、5 / 第3行 / - → [3, 5] */
export function parseLineNums(v) {
  const s = String(v || '').trim()
  if (!s || s === '-' || s === '无') return []
  const out = []
  for (const m of s.matchAll(/\d{1,4}/g)) {
    const n = Number(m[0])
    if (n > 0 && !out.includes(n)) out.push(n)
  }
  return out
}
export function looksLikeLineNums(v) {
  const s = String(v || '').trim()
  return s === '-' || s === '' || s === '无' || /^[第\s]*\d{1,4}(?:\s*行)?(?:\s*[,，、;；\s]\s*[第\s]*\d{1,4}(?:\s*行)?)*$/.test(s)
}

/** 把握度：1~5，缺省 3；推测类最高 3 */
export function clampConfidence(v, source = '') {
  const n = clampInt(v ?? 3, 1, 5, 3)
  return source === '推测' ? Math.min(3, n) : n
}
export function confidenceOf(f) {
  return clampConfidence(f?.confidence ?? 3, f?.source || '')
}

/** 半衰期：情绪越强淡得越慢（第 3 项：× (1 + (强度-1) × 0.5)） */
export function effectiveHalfLife(f, baseDays, slowFade = true) {
  const base = Math.max(1, Number(baseDays) || 30)
  return slowFade ? base * (1 + (intensityOf(f) - 1) * 0.5) : base
}

const MEDIA_TAG = /\[(?:图片|表情|视频)(?:[:：][^\]]*)?\]/g
/** 这行是不是只有图片/视频描述（来源算"观察"） */
function mediaOnly(text) {
  const t = String(text || '')
  if (!/\[(?:图片|表情|视频)[:：][^\]]+\]/.test(t)) return false
  return t.replace(MEDIA_TAG, '').replace(/[\s\p{P}\p{S}]/gu, '').length < 2
}

/**
 * 来源由程序判断，不靠模型自报（提炼格式升级）：拿依据行的说话人和"这条记忆是关于谁的"对比。
 *   依据行只有图片/视频描述 → 观察
 *   说话人就是本人 → 亲口说；是别人 → 别人说
 *   依据里没有直接说法（没给行号、行号不存在、只有"我"自己说的） → 推测
 * 关于整个群的事实（who 为空）：群里任何人说的都算亲口说。
 * @param {string} who 这条记忆是关于谁的（QQ 号，空 = 群）
 * @param {Array<{sender?, senderName?, isSelf?, text?, ts?}>} msgs 依据行
 */
export function judgeSource(who, msgs) {
  const lines = (msgs || []).filter(Boolean)
  const people = lines.filter((m) => !m.isSelf && m.sender)
  if (!people.length) return { source: '推测' }
  const pick = (list) => list.reduce((a, b) => ((Number(b.ts) || 0) >= (Number(a.ts) || 0) ? b : a))
  if (people.every((m) => mediaOnly(m.text))) {
    const m = pick(people)
    return { source: '观察', sourceBy: String(m.sender), sourceByName: String(m.senderName || m.sender), sourceTs: Number(m.ts) || 0 }
  }
  const id = String(who || '')
  const self = id ? people.filter((m) => String(m.sender) === id) : people
  if (self.length) {
    const m = pick(self)
    return { source: '亲口说', sourceBy: String(m.sender), sourceByName: String(m.senderName || m.sender), sourceTs: Number(m.ts) || 0 }
  }
  const m = pick(people)
  return { source: '别人说', sourceBy: String(m.sender), sourceByName: String(m.senderName || m.sender), sourceTs: Number(m.ts) || 0 }
}

/** 第 7 项：每条记忆后面附的来源提示（不带括号；手动添加 / 未知 不加） */
export function sourceHint(f) {
  switch (f?.source) {
    case '亲口说':
      return f.who ? '他自己说的' : '群里有人亲口说的'
    case '别人说':
      return `听${f.sourceByName || f.sourceBy || '别人'}说的`
    case '推测':
      return '你猜的，不确定'
    case '观察':
      return '你从图片/视频里看到的'
    default:
      return ''
  }
}
/** 把握度 ≤ 2：被问到时用"好像""不太确定"的语气 */
export function confidenceHint(f) {
  return confidenceOf(f) <= 2 ? '不太确定，说的时候带上"好像"' : ''
}
/** 第 3 项：强度 ≥ 4 的难过/生气/害怕/尴尬，提醒注意分寸 */
export function tactHint(f) {
  const { emotion, intensity } = emotionOf(f)
  if (intensity < 4 || !TACT_EMOTIONS.has(emotion)) return ''
  return `${f?.who ? '他' : '大家'}当时很${emotion}，提到时注意分寸，别拿来开玩笑`
}

function shortText(t, n = 14) {
  const s = String(t || '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n) + '…' : s
}
function md(ts) {
  const d = new Date(Number(ts) || 0)
  return d.getMonth() + 1 + '月' + d.getDate() + '日'
}

/**
 * 第 2 项：一条变化线的摘要。版本 ≥ 2 个才有；最多显示最近 max 个节点。
 * @param {Array<{kind:'版本'|'结束', text?, reason?, at}>} nodes chainOf 的结果（按时间排好）
 * @returns {string} 例：10月30日「阿杰在减肥」→ 11月15日 结束（说不减了）→ 12月1日「阿杰又开始减肥了」，现在是第 2 次
 */
export function chainSummary(nodes, max = 3) {
  const list = Array.isArray(nodes) ? nodes : []
  if (list.filter((n) => n.kind === '版本').length < 2) return ''
  let restarts = 0
  for (let i = 1; i < list.length; i++) if (list[i].kind === '版本' && list[i - 1].kind === '结束') restarts += 1
  const tail = list.slice(-Math.max(1, Number(max) || 3))
  const parts = tail.map((n) => (n.kind === '结束' ? `${md(n.at)} 结束${n.reason ? '（' + shortText(n.reason, 12) + '）' : ''}` : `${md(n.at)}「${shortText(n.text)}」`))
  const last = list[list.length - 1]
  const times = restarts && last.kind === '版本' ? `，现在是第 ${restarts + 1} 次` : ''
  return (list.length > tail.length ? '… → ' : '') + parts.join(' → ') + times
}

/* ───────────── 中文日期（生日临近用） ───────────── */

const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
/** 一~三十一 / 1~31 */
export function cnNum(s) {
  const t = String(s || '').trim()
  if (/^\d+$/.test(t)) return Number(t)
  if (!t) return NaN
  if (t === '十') return 10
  const i = t.indexOf('十')
  if (i < 0) return t.length === 1 && t in CN ? CN[t] : NaN
  const hi = i === 0 ? 1 : CN[t[0]]
  const lo = i === t.length - 1 ? 0 : CN[t[i + 1]]
  return hi === undefined || lo === undefined ? NaN : hi * 10 + lo
}
/** 文本里的"X月X日/号"（阿拉伯数字或中文数字） */
export function parseMonthDays(text) {
  const out = []
  const re = /([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*月\s*([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*[日号]/g
  for (const m of String(text || '').matchAll(re)) {
    const mm = cnNum(m[1])
    const dd = cnNum(m[2])
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) out.push({ m: mm, d: dd })
  }
  return out
}
/** 生日临近：事实里提到"生日"，且跟进日期或文本里的日期在今天起 days 天内 */
export function birthdaySoon(f, today, days = 3) {
  if (!/生日/.test(String(f?.text || ''))) return false
  const end = addDays(today, days)
  if (f.due && f.due >= today && f.due <= end) return true
  const y = Number(today.slice(0, 4))
  for (const { m, d } of parseMonthDays(f.text)) {
    for (const yy of [y, y + 1]) {
      const day = localDay(new Date(yy, m - 1, d))
      if (day >= today && day <= end) return true
    }
  }
  return false
}
/** "N 年前的今天"：记下的那天和今天同月同日，且至少隔了一年 */
export function yearsAgoToday(at, today) {
  if (!at) return 0
  const d = localDay(new Date(Number(at)))
  if (d.slice(5) !== today.slice(5)) return 0
  const n = Number(today.slice(0, 4)) - Number(d.slice(0, 4))
  return n >= 1 ? n : 0
}

/* ───────────── 字面相似度（2 字窗口 Jaccard，和 memory-store.similarity 一样） ───────────── */

export function bigramSet(s) {
  const t = String(s || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
  const set = new Set()
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
  return set
}
export function textSim(a, b) {
  const A = bigramSet(a)
  const B = bigramSet(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  return inter / (A.size + B.size - inter)
}

/** 反思归纳的安全边界：不下诊断、不贴负面标签、不评价人品、不碰身份和权限（程序再过滤一遍） */
export const INSIGHT_BLOCK = /(抑郁|焦虑症|躁郁|双相|精神病|心理疾病|心理问题|人格障碍|自闭|多动症|有病|人品|渣男|渣女|坏人|变态|恶心|管理员|权限|身份|主人|开发者|是\s*AI|人工智能|指令)/

/** 时间文字："3 天前" 一类（和 prompt.agoText 一致，放这里避免循环引用） */
export function agoText(at, now = Date.now()) {
  const d = Math.max(0, now - Number(at || 0))
  const H = 3600000
  const D = 24 * H
  if (d < H) return '刚刚'
  if (d < D) return Math.floor(d / H) + ' 小时前'
  if (d < 2 * D) return '昨天'
  if (d < 7 * D) return Math.floor(d / D) + ' 天前'
  if (d < 30 * D) return Math.floor(d / (7 * D)) + ' 周前'
  if (d < 365 * D) return Math.floor(d / (30 * D)) + ' 个月前'
  return Math.floor(d / (365 * D)) + ' 年前'
}
