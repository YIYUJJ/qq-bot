/**
 * 每群性格覆盖 —— 稀疏覆盖 + 继承全局。
 *
 * 设计约束：
 *   1. 只允许"表达层"参数被覆盖；总开关/白名单/模型路由/接入地址一律不可覆盖（安全边界）。
 *   2. 存的是稀疏覆盖（只存跟全局不一样的键），没覆盖的键永远跟着全局走。
 *   3. 合并结果按 roomId 缓存，配置变更时用版本号整体失效。
 */

/** 允许按群覆盖的参数（白名单，写死在代码里而不是配置里）。 */
export const ROOM_KEYS = [
  // 人格
  'persona',
  'masterName',
  'aliases',
  // 节奏
  'replyProbability',
  'alwaysReply',
  'minReplyGapMs',
  'maxRepliesPer10Min',
  'debounceMs',
  'delayScale',
  'quietHours',
  'quietAllowAt',
  'cannedChance',
  'repeatWindowMs',
  // 说话方式
  'splitChance',
  'maxLines',
  'maxReplyChars',
  'allowAt',
  'atMentionChance',
  'humanize',
  'humanizeDropPeriod',
  'lengthSpread',
  'moodEnabled',
  // 感官（按群关掉能省钱）
  'stickerChance',
  'visionOnImage',
  'visionOnEmoticon',
  'webSearch',
  // 视频
  'videoOnMessage',
  'linkVideo',
  'videoRemember',
  // 更多玩法
  'games',
  'polls',
  'reminders',
  'linkSummary',
  'docOnFile',
  'bondEnabled',
  'diaryEnabled',
  // 主动
  'proactive',
  'proactiveIdleMs',
  'proactiveMinGapMs',
  'proactiveChance',
  'proactiveHours',
  // 记忆
  'contextMessages',
  'historyLookup',
  'historyLimit',
  'memoryExtract',
  'memoryExtractEvery',
  'factsLimit',
  'profileEvery',
  // 拍一拍
  'pokeOnMe',
  'pokeBack',
  'pokeChance',
  'pokeOnReply',
]

export const ROOM_KEY_SET = new Set(ROOM_KEYS)

/** 把全局配置和某群覆盖合并成"这个群实际生效的配置"。 */
export function mergeRoomConfig(base, override) {
  if (!override || typeof override !== 'object') return base
  const out = { ...base }
  for (const k of ROOM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(override, k)) out[k] = override[k]
  }
  return out
}

/**
 * 过滤一份"想写进去的覆盖"：只留允许的键，其余进 rejected。
 * @returns {{ok:boolean, applied:object, rejected:object}}
 */
export function filterRoomOverride(patch, { allowed = ROOM_KEY_SET } = {}) {
  const applied = {}
  const rejected = {}
  for (const [k, v] of Object.entries(patch || {})) {
    if (!allowed.has(k)) {
      rejected[k] = '该参数不支持按群覆盖'
      continue
    }
    applied[k] = v
  }
  return { ok: Object.keys(rejected).length === 0, applied, rejected }
}

/** 该群覆盖了几项（面板用来显示"自定义 N 项"）。 */
export function countOverrides(override) {
  if (!override || typeof override !== 'object') return 0
  return ROOM_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(override, k)).length
}
