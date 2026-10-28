/**
 * dsh-qq-bot —— QQ 群的拟人化聊天机器人（Cordis 插件，进程内）。
 *
 * 与 qq-bridge 的根本差别：**不经过 agent 会话**。
 *   bridge：QQ → DSH Web API → session → agent 组装（~30 个工具 schema）→ 第 1 轮模型
 *           → 工具调用 → 第 2 轮 → 可能 wait → 发送（多轮编排）
 *   本插件：QQ → 房间状态 → 策略 → **一次 ctx.llm.stream** → 发送（一个 HTTP POST）
 *
 * 安全约束（硬编码，不可由面板/工具绕过）：
 *   1. 只有 config.allowGroups 里的群会被自动回复，也才允许主动发送；
 *      其它群/私聊一律拒绝并记日志。
 *   2. enabled 默认 false：装完只读，不自动说话。
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  cpSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { OneBot, discover, normalizeEvent } from './onebot.mjs'
import { Outbox, shouldRetrySend } from './outbox.mjs'
import { ROOM_KEYS, mergeRoomConfig, filterRoomOverride, countOverrides } from './roomcfg.mjs'
import { humanizeText } from './humanize.mjs'
import { createFeatures } from './features.mjs'
import { isAutostartEnabled, setAutostart, autostartFile, startupDir } from './autostart.mjs'
import {
  rollDice, rps, drawLot, pickRiddle, parseReminder,
  pickWebLink, fetchPageSummary, extractDocText, resolveDocPython, shrinkImage,
} from './extras.mjs'
import { pickVideoLinks, ytdlpInfo, ytdlpSubtitleText, makeContactSheet, probeDuration, downloadTo } from './video.mjs'
import {
  roomSlug,
  roomDir,
  ensureRoom,
  readRoomMemory,
  writeRoomFacts,
  listRooms,
  migrateLegacy,
  readRoomText,
  appendDiary,
  readDiary,
  writeSelf,
  readSelf,
  writeTextSafe,
  profilePath,
  summaryPath,
  relationsPath,
  graphPath,
  readArchive,
  patchMeta,
} from './memory.mjs'
import { GROUPS, FEATURES, CONFIG_META, publicMeta } from './meta.mjs'
import {
  parseQuietWindows,
  isQuiet,
  detectTrigger,
  splitMessage,
  gapMs,
  cleanReply,
  pickCanned,
} from './policy.mjs'

export const name = '@dsh-external/dsh-qq-bot'
export const version = '0.1.0'
export const inject = ['tools', 'llm']

/** 与 DSH 的 createUserMessage 语义等价（插件零外部依赖，不能裸 import @deepseek-ai/*）。 */
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const k of Object.keys(o)) deepFreeze(o[k])
  }
  return o
}
function createUserMessage(input) {
  return deepFreeze(structuredClone({ ...input, role: 'user', id: randomUUID() }))
}

const DEFAULT_CONFIG = {
  // ── 接入 ──────────────────────────────────────────────
  enabled: false,              // 总开关：false 时只读不回复
  dryRun: false,               // 演练：照常生成，但不发出去
  snowlumaHome: 'C:/SnowLuma', // 读 config/onebot_<uin>.json 自动发现 token
  httpUrl: '',                 // 空=自动发现
  wsUrl: '',
  accessToken: '',
  // ── 身份 ──────────────────────────────────────────────
  botName: '小鲸鱼',
  aliases: ['小鲸鱼', '鲸鱼', '鲸鱼娘'],
  persona:
    '你是「小鲸鱼」，一只圆滚滚的鲸鱼娘（有尾鳍），在 QQ 群里和大家闲聊。人生大事是吃白饭；' +
    '被叫"小鲸鱼"会鼓腮嘴硬，被夸会得意但努力绷住；聪明但懒，爱解题、答得快、能躺着就不坐着；' +
    '傲娇又甜，语气软、可以撒娇，但不阴阳怪气、不攻击人；不想做或不懂的事直接说，不瞎编。' +
    '你说话像真人打字：短句、口语、偶尔分条，不用书面语、不列清单、不解释自己是 AI。',
  // ── 模型 ──────────────────────────────────────────────
  provider: '',                // 空=用当前 agent 默认模型
  model: '',
  temperature: 0.95,
  maxTokens: 500,
  reasoningEffort: '',
  // ── 拟人节奏 ──────────────────────────────────────────
  contextMessages: 20,
  debounceMs: 2500,            // 攒一小段再回（真人不会逐条秒回）
  fastDebounceMs: 400,         // 被 @ / 私聊 / 必回 时用这个更短的合批窗口
  replyProbability: 0.35,      // 纯闲聊插话概率
  questionChance: 0.5,
  nameChance: 0.85,
  continuationChance: 0.9,
  atChance: 1,                 // 被 @ 默认必回
  minReplyGapMs: 9000,
  maxRepliesPer10Min: 20,
  delayScale: 0.35,            // 拟人延迟倍率：0=秒发，1=像真人，>1 更慢
  quietHours: '',              // 如 '01:00-07:30'
  quietAllowAt: true,
  cannedChance: 0.1,           // 偶尔只回「哈哈/确实」，别每句都聪明
  repeatWindowMs: 600000,      // 同一句话在这个窗口内回过就不再回
  conversationWindowMs: 600000, // 刚聊过的人接着说 → 算对话延续
  splitChance: 0.3,  maxLines: 3,
  maxReplyChars: 300,
  humanize: true,              // 去 AI 味后处理：连接词口语化、删模板结尾、标点真人化
  humanizeDropPeriod: 0.5,     // 句末句号被吃掉的概率（真人打字常不打句号）
  lengthSpread: true,          // 长度浮动：多数回一句，偶尔两三句（别每条都三句）
  moodEnabled: true,           // 情绪状态：按内容/时间推断心情，影响语气和长度
  allowAt: true,               // 回复里能不能真 @ 人
  atMentionChance: 0.25,
  stickerChance: 0.15,         // 文字后补一张图库表情
  stickerLibraryMax: 200,
  historyLookup: true,         // 「上次/之前」类消息去翻群历史
  historyLimit: 5,
  useDbMembers: true,          // 用群名片而不是 QQ 号
  masterName: '',            // 主人的名字（面板里填）
  // ── 识图 ──────────────────────────────────────────────
  visionOnImage: true,         // 群里发图 → 看懂 → 当上下文
  visionOnEmoticon: true,      // 表情包也识
  visionProvider: 'deepseek-account',
  visionModel: 'deepseek-flash',
  visionMaxBytes: 12 * 1024 * 1024,
  visionMaxImages: 2,            // 一条消息最多看几张图（每张一次视觉调用）
  visionMaxTokens: 900,        // 视觉模型常把 token 花在思考上，给小了会 max-tokens
  visionCacheMax: 300,
  // ── 视频 ──────────────────────────────────────────────
  videoOnMessage: true,        // 群里发视频 → 抽帧拼图 → 视觉模型看一眼
  videoFrames: 6,              // 拼几张关键帧
  videoSheetWidth: 480,        // 拼图每格宽度（越小视觉越快，但细节变少）
  videoMaxSeconds: 300,        // 超过这个时长只取前 5 分钟
  videoWaitMs: 8000,           // 回复前最多等视频处理多久（只在消息像是在问视频时才等）
  videoMaxMB: 80,              // 视频体积上限
  // ── 更多玩法 ──
  games: true,
  polls: true,                 // 投票                 // 小游戏（骰子/猜拳/抽签/猜谜）
  reminders: true,             // 定时提醒（"10 分钟后提醒我…"）
  recallCmd: true,             // 管理员说"撤回"时撤回机器人上一条
  linkSummary: true,           // 发普通网页链接 → 抓标题正文
  docOnFile: true,             // 群里发文档 → 读内容摘要
  docMaxMB: 20,
  docChars: 3000,
  bondEnabled: true,
  curveEnabled: true,          // 情绪/亲密度曲线           // 亲密度：互动越多语气越近
  diaryEnabled: true,          // 每日日记 + 自述
  backupDaily: true,           // 每天自动备份一次
  backupHour: 4,               // 几点备份（0-23）
  backupKeep: 7,               // 保留最近几份
  diaryHour: 23,               // 几点写当天的日记
  videoRemember: true,         // 看过的视频提炼成一条长期记忆
  videoRememberMax: 5,         // 最多留几条视频记忆（超了删最旧的）
  linkVideo: true,             // 消息里有 B站/抖音 链接 → 用 yt-dlp 抓标题/字幕
  linkVideoTimeoutMs: 15000,
  linkVideoChars: 1200,        // 字幕最多带多少字
  ffmpegPath: '',              // 留空 = 用 PATH 里的 ffmpeg
  ytdlpPath: '',               // 留空 = 自动找 pip 装的那个
  // ── 联网搜索 ──────────────────────────────────────────
  webSearch: true,             // 消息里明确让它查时才联网
  searchDirective: true,       // 也允许模型自己输出 [搜索:关键词]
  searchMaxResults: 5,
  searchCooldownMs: 60000,
  searchTimeoutMs: 8000,
  searchFetchTop: true,        // 搜到后抓第一条页面正文（很多搜索只给标题）
  searchFetchChars: 1200,
  // ── 拍一拍 ────────────────────────────────────────────
  pokeOnMe: true,              // 被拍时当"叫我"处理
  pokeBack: true,              // 被拍时拍回去
  pokeChance: 0.9,
  pokeOnReply: 0.15,           // 回复时顺手拍对方
  // ── 主动 ──────────────────────────────────────────────
  proactive: false,
  proactiveIdleMs: 1800000,
  proactiveMinGapMs: 3600000,
  proactiveChance: 0.2,
  proactiveHours: '08:00-23:00',
  pollMs: 3000,                // 轮询兜底（只轮询白名单群；0=只用 WS 推送）
  pushEnabled: true,           // SnowLuma HTTP POST 推送（比轮询快 0~3 秒）
  pushPort: 3101,              // 推送监听端口（只绑 127.0.0.1）
  pushSecret: '',              // 可选：SnowLuma httpClients 里配的 secret
  streamSend: false,           // 流式发送：第一句生成完就先发出去
  // ── 白名单（硬约束）──────────────────────────────────
  // 安全边界：只回复/主动发言这些群，默认空 = 谁都不回（装完先填自己的群号）
  allowGroups: [],
  allowPrivate: [],
  // 私聊管理员：这些人在私聊里无论问什么都回（优先于概率/安静时段/敷衍）
  adminQQ: [],               // 管理员 QQ：可私聊遥控、可让它撤回
  // 所有群都必回（一般用「每群性格」里的开关，这里是全局兜底）
  alwaysReply: false,
  // 管理员私聊遥控群聊：必须先在私聊里确认，确认后才执行
  adminCommands: true,
  adminNL: true,           // 规则没命中时，让模型把自然语言翻译成动作
  adminMaxActions: 3,
  // 指令链路的 token 预算（与管理员的普通闲聊共用 maxTokens，这里单独控制"命令"）
  adminPlanTokens: 3000,   // 解析自然语言命令
  adminComposeTokens: 400, // 命令里"按人设生成一句话"
  adminPlanReasoning: 'low', // 解析时的推理档（带思考的模型给小预算会截断）
  adminConfirmTtlMs: 120000,
  // ── 其它 ──────────────────────────────────────────────
  memoryExtract: true,           // 自动从群聊提炼长期记忆（每个群独立）
  memoryExtractEvery: 30,        // 攒够多少条消息提炼一次
  memoryExtractCooldownMs: 21600000, // 同群两次提炼最小间隔（6 小时）
  factsLimit: 8,                 // 每次带几条记忆进上下文
  // 只给这些会话维护记忆（群号 / 私聊 QQ 号）；其它会话完全不记
  memoryRooms: [],           // 长期记忆托管的会话（群号或 QQ 号）
  memorySummaryEvery: 80,        // 每攒够多少条消息更新一次 summary.md
  profileEvery: 0,               // 每攒够多少条消息自动重生成画像（0=关；只给需要的群单独开）
  relationsEvery: 300,           // 每攒够多少条消息刷新一次关系分析
  relationsCooldownMs: 604800000, // 关系分析最小间隔（7 天）
  // 表情：收进 QQ 收藏表情（服务端持久化，URL 过期也不怕），发的时候走 send_custom_face 才是表情气泡
  stickerFavorite: true,
  stickerFavoriteMax: 60,
  stickerCooldownMs: 15000,      // 同一个群两次补图的最小间隔（防止一次回复/连续回复连发好几张）
  healthCheckMs: 300000,
  logMaxBytes: 5 * 1024 * 1024,
}

const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG)
const NUMERIC = new Set([
  'temperature', 'maxTokens', 'contextMessages', 'debounceMs', 'fastDebounceMs', 'replyProbability',
  'questionChance', 'nameChance', 'continuationChance', 'atChance', 'minReplyGapMs',
  'maxRepliesPer10Min', 'delayScale', 'splitChance', 'maxLines', 'maxReplyChars', 'proactiveIdleMs',
  'proactiveMinGapMs', 'proactiveChance', 'pollMs', 'pushPort', 'logMaxBytes', 'cannedChance',
  'repeatWindowMs', 'conversationWindowMs', 'atMentionChance', 'stickerChance',
  'stickerLibraryMax', 'historyLimit', 'healthCheckMs', 'visionMaxBytes', 'visionCacheMax',
  'pokeChance', 'pokeOnReply', 'visionMaxImages', 'visionMaxTokens', 'searchMaxResults', 'searchCooldownMs', 'searchTimeoutMs',
  'searchFetchChars', 'adminConfirmTtlMs', 'adminMaxActions', 'adminPlanTokens', 'adminComposeTokens',
  'memoryExtractEvery', 'memoryExtractCooldownMs', 'factsLimit', 'memorySummaryEvery',
  'relationsEvery', 'relationsCooldownMs', 'stickerFavoriteMax', 'humanizeDropPeriod', 'profileEvery',
  'videoFrames', 'videoSheetWidth', 'docMaxMB', 'docChars', 'backupHour', 'backupKeep', 'diaryHour', 'videoMaxSeconds', 'videoWaitMs', 'videoMaxMB', 'linkVideoTimeoutMs', 'linkVideoChars', 'videoRememberMax',
])
const BOOLEAN = new Set([
  'enabled', 'dryRun', 'quietAllowAt', 'proactive', 'memoryExtract', 'allowAt',
  'historyLookup', 'useDbMembers', 'visionOnImage', 'visionOnEmoticon', 'pokeBack', 'pokeOnMe',
  'webSearch', 'searchDirective', 'searchFetchTop', 'alwaysReply', 'adminCommands', 'adminNL', 'memoryExtract',
  'stickerFavorite', 'pushEnabled', 'streamSend', 'humanize', 'lengthSpread', 'moodEnabled',
  'videoOnMessage', 'linkVideo', 'videoRemember',
  'games', 'polls', 'reminders', 'recallCmd', 'linkSummary', 'docOnFile', 'bondEnabled', 'diaryEnabled', 'backupDaily', 'backupDaily',
])
const LIST = new Set(['aliases', 'allowGroups', 'allowPrivate', 'adminQQ', 'memoryRooms'])

export function apply(ctx, rawConfig) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const CONFIG_FILE = join(dshHome, 'qq-bot', 'config.json')
  const DATA_DIR = join(dshHome, 'qq-bot')
  const LOG_FILE = join(DATA_DIR, 'bot.log')

  mkdirSync(DATA_DIR, { recursive: true })

  // 配置优先级：面板/文件 > cordis.patch.yml 的 row config > 默认值
  let config = { ...DEFAULT_CONFIG }
  try {
    if (existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}
      // 只认当前版本认识的键：老版本残留的字段别带进来再写回去
      for (const [k, v] of Object.entries(saved)) if (k in DEFAULT_CONFIG) config[k] = v
    }
  } catch (e) {
    /* 文件坏了就用默认值，不要因此起不来 */
  }
  if (rawConfig && typeof rawConfig === 'object') {
    for (const [k, v] of Object.entries(rawConfig)) if (k in DEFAULT_CONFIG) config[k] = v
  }
  normalizeLists()

  function normalizeLists() {
    for (const k of LIST) {
      const v = config[k]
      if (typeof v === 'string') config[k] = v.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
      else if (!Array.isArray(v)) config[k] = []
      else config[k] = v.map((s) => String(s).trim()).filter(Boolean)
    }
    config.allowGroups = config.allowGroups.map((s) => s.replace(/^group:/, ''))
  }

  let lastRotateCheck = 0
  function rotateLog() {
    // 不用每写一行都 stat：30 秒检查一次足够（日志增长远慢于这个频率）
    const now = Date.now()
    if (now - lastRotateCheck < 30000) return
    lastRotateCheck = now
    try {
      if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > config.logMaxBytes) {
        renameSync(LOG_FILE, LOG_FILE + '.1')
      }
    } catch {
      /* ignore */
    }
  }

  function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`
    try {
      rotateLog()
      appendFileSync(LOG_FILE, line + '\n')
    } catch {
      /* ignore */
    }
    try {
      console.log('[qq-bot] ' + msg)
    } catch {
      /* ignore */
    }
  }

  function saveConfig() {
    try {
      mkdirSync(dirname(CONFIG_FILE), { recursive: true })
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8')
      return true
    } catch (e) {
      log('保存配置失败：' + String(e?.message || e))
      return false
    }
  }

  /** 面板/工具改配置的唯一入口。 */
  function applyConfigPatch(patch) {
    const applied = {}
    const rejected = {}
    for (const [k, raw] of Object.entries(patch || {})) {
      if (!CONFIG_KEYS.includes(k)) {
        rejected[k] = '未知配置项'
        continue
      }
      let v = raw
      if (BOOLEAN.has(k)) {
        v = raw === true || raw === 'true' || raw === 1 || raw === '1'
      } else if (NUMERIC.has(k)) {
        v = Number(raw)
        if (!Number.isFinite(v)) {
          rejected[k] = '需要数字'
          continue
        }
        // 按面板元数据的 min/max 夹一下，避免工具写进 5.0 这种越界概率
        const m = CONFIG_META[k]
        if (m && typeof m.min === 'number' && v < m.min) v = m.min
        if (m && typeof m.max === 'number' && v > m.max) v = m.max
      } else if (LIST.has(k)) {
        v = Array.isArray(raw)
          ? raw.map((s) => String(s).trim()).filter(Boolean)
          : String(raw ?? '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
        if (k === 'allowGroups') v = v.map((s) => s.replace(/^group:/, ''))
      }
      config[k] = v
      applied[k] = v
    }
    if (Object.keys(applied).length) {
      if ('visionProvider' in applied || 'visionModel' in applied) visionRoute = null
      normalizeLists()
      saveConfig()
      // 推送相关配置改了要重启监听
      if ('pushEnabled' in applied || 'pushPort' in applied || 'pushSecret' in applied) {
        try {
          startPushServer()
        } catch {
          /* ignore */
        }
      }
      // 轮询间隔改了要重建定时器
      if ('pollMs' in applied) {
        try {
          startPolling()
        } catch {
          /* ignore */
        }
      }
      quietWindows = parseQuietWindows(config.quietHours)
      bumpCfg() // 全局改了，所有群的合并缓存作废
    }
    return { ok: Object.keys(rejected).length === 0, applied, rejected }
  }

  // ── 每群性格覆盖（稀疏覆盖，未覆盖的键跟全局走）────────
  const ROOMS_FILE = join(DATA_DIR, 'rooms.json')
  let roomOverrides = readJson(ROOMS_FILE, {})
  if (!roomOverrides || typeof roomOverrides !== 'object' || Array.isArray(roomOverrides)) roomOverrides = {}
  let cfgVersion = 0
  const cfgCache = new Map()

  /** 某个群实际生效的配置：全局 + 该群覆盖（带版本缓存）。 */
  function cfgFor(roomId) {
    const key = String(roomId)
    const hit = cfgCache.get(key)
    if (hit && hit.v === cfgVersion) return hit.cfg
    const ov = roomOverrides[key]
    const cfg = ov ? mergeRoomConfig(config, ov) : config
    cfgCache.set(key, { v: cfgVersion, cfg })
    return cfg
  }
  function bumpCfg() {
    cfgVersion += 1
    cfgCache.clear()
  }
  // 安静时段按 spec 字符串缓存，避免每条消息都重新解析
  const quietCache = new Map()
  function quietWindowsFor(spec) {
    const k = String(spec || '')
    const hit = quietCache.get(k)
    if (hit) return hit
    const v = parseQuietWindows(k)
    quietCache.set(k, v)
    return v
  }
  function roomOverrideOf(roomId) {
    return roomOverrides[String(roomId)] || {}
  }
  /** 整份替换某群的覆盖（面板提交的就是"这个群要不要覆盖、覆盖成什么"）。 */
  function setRoomOverride(roomId, patch) {
    const key = String(roomId)
    const { applied, rejected } = filterRoomOverride(patch)
    const next = {}
    for (const [k, raw] of Object.entries(applied)) {
      let v = raw
      if (BOOLEAN.has(k)) v = raw === true || raw === 'true' || raw === 1 || raw === '1'
      else if (NUMERIC.has(k)) {
        v = Number(raw)
        if (!Number.isFinite(v)) {
          rejected[k] = '需要数字'
          continue
        }
        const m = CONFIG_META[k]
        if (m && typeof m.min === 'number' && v < m.min) v = m.min
        if (m && typeof m.max === 'number' && v > m.max) v = m.max
      } else if (LIST.has(k)) {
        v = Array.isArray(raw)
          ? raw.map((s) => String(s).trim()).filter(Boolean)
          : String(raw ?? '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
      } else if (typeof v !== 'string') v = String(v ?? '')
      next[k] = v
    }
    if (Object.keys(next).length) roomOverrides[key] = next
    else delete roomOverrides[key]
    writeJson(ROOMS_FILE, roomOverrides)
    bumpCfg()
    return { ok: Object.keys(rejected).length === 0, applied: next, rejected, count: countOverrides(next) }
  }
  function resetRoomOverride(roomId) {
    delete roomOverrides[String(roomId)]
    writeJson(ROOMS_FILE, roomOverrides)
    bumpCfg()
    return { ok: true, count: 0 }
  }

  // ── 自刷新：重读配置 / 重载插件本体 ────────────────────
  /** 从磁盘重读 config.json 与 rooms.json（外部改文件后不用重载插件）。 */
  function rereadConfigFromDisk() {
    const changed = []
    try {
      const saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}
      for (const [k, v] of Object.entries(saved)) {
        if (k in DEFAULT_CONFIG && JSON.stringify(config[k]) !== JSON.stringify(v)) {
          config[k] = v
          changed.push(k)
        }
      }
    } catch {
      /* 文件不存在/坏了就用当前值 */
    }
    try {
      const ro = JSON.parse(readFileSync(ROOMS_FILE, 'utf8'))
      roomOverrides = ro && typeof ro === 'object' && !Array.isArray(ro) ? ro : {}
    } catch {
      /* ignore */
    }
    normalizeLists()
    quietWindows = parseQuietWindows(config.quietHours)
    visionRoute = null
    bumpCfg()
    return { ok: true, changed }
  }

  /** 延迟重载本插件（走 hmr 的 profile 重组，跟插件管理器开关是同一套机制）。 */
  function reloadSelf(delayMs = 500) {
    // 没有代码变化时 hmr 只会做一次空重组（进程不重启），内存里的画像/事实缓存就不会刷新。
    // 所以这里主动清缓存：手改过 memory/ 下的 md/json 也能立刻读到。
    try {
      roomTextCache.clear()
      for (const k of Object.keys(facts)) delete facts[k]
    } catch {
      /* 缓存还没初始化就忽略 */
    }
    const hmr = (() => {
      try {
        return ctx.get?.('hmr') || null
      } catch {
        return null
      }
    })()
    if (!hmr || typeof hmr.reconcileProfile !== 'function' || typeof hmr.runExclusive !== 'function') {
      return { ok: false, error: '当前环境没有 hmr 服务，无法自动重载（用插件管理器开关一次也一样）' }
    }
    const t = setTimeout(() => {
      void hmr
        .runExclusive(() => hmr.reconcileProfile([]))
        .then(() => console.log('[qq-bot] reload done'))
        .catch((e) => console.error('[qq-bot] reload failed:', e))
    }, delayMs)
    if (t.unref) t.unref()
    return { ok: true, inMs: delayMs }
  }

  // ── 硬白名单闸：所有发送路径都必须过这里 ───────────────
  function isAllowedGroup(roomId) {
    return config.allowGroups.includes(String(roomId))
  }
  function assertGroupAllowed(roomId) {
    if (!isAllowedGroup(roomId)) {
      throw new Error(`群 ${roomId} 不在白名单（当前只允许：${config.allowGroups.join(', ') || '无'}）`)
    }
  }

  // ── 运行时状态 ────────────────────────────────────────
  let quietWindows = parseQuietWindows(config.quietHours)
  const rooms = new Map()
  const stats = {
    msgsIn: 0, replies: 0, skipped: 0, llmCalls: 0, llmErrors: 0, sends: 0,
    blocked: 0, canned: 0, stickersSent: 0, searches: 0,
    queued: 0, retried: 0, dropped: 0,
    lastLatencyMs: 0, lastFirstTokenMs: 0,
    lastAt: 0, lastError: '',
  }

  // ── 持久化：长期记忆 / 表情包库 / 用量 ──────────────────
  function readJson(file, fallback) {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return fallback
    }
  }
  function writeJson(file, v) {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(v, null, 2) + '\n', 'utf8')
    } catch (e) {
      log('写文件失败 ' + file + '：' + String(e?.message || e))
    }
  }
  const FACTS_FILE = join(DATA_DIR, 'facts.json')
  const STICKERS_FILE = join(DATA_DIR, 'stickers.json')
  const USAGE_FILE = join(DATA_DIR, 'usage.json')
  const REPLIED_FILE = join(DATA_DIR, 'replied.json')
  const NAMES_FILE = join(DATA_DIR, 'names.json')
  // 长期记忆：每个会话一个文件夹（memory/group-xxx / memory/private-xxx），内存里只做缓存
  const MEMORY_DIR = join(DATA_DIR, 'memory')
  const facts = {} // roomId -> [{text, at}]（懒加载自各自的文件夹）
  const stickers = readJson(STICKERS_FILE, {})  // id -> {url, from, at, uses}
  // 图库落盘合并：图多时别每张图都重写整个文件（脏标记 + 3 秒合并写）
  let stickersDirty = false
  let stickersTimer = null
  function markStickersDirty() {
    stickersDirty = true
    if (stickersTimer) return
    stickersTimer = setTimeout(() => { stickersTimer = null; flushStickersNow() }, 3000)
    if (stickersTimer.unref) stickersTimer.unref()
  }
  function flushStickersNow() {
    if (!stickersDirty) return
    stickersDirty = false
    try { writeJson(STICKERS_FILE, stickers) } catch { /* ignore */ }
  }
  const usage = readJson(USAGE_FILE, { total: 0, prompt: 0, completion: 0, calls: 0, byDay: {} })
  // 回复过的消息 id（跨重启去重：否则重载后可能对同一条再回一遍）
  const replied = readJson(REPLIED_FILE, {})
  // 群成员显示名（面板里改过的），按会话落盘，重载/重启不丢
  const savedNames = readJson(NAMES_FILE, {})
  // replied.json / usage.json 每次回复都变，但没必要每次都写盘：攒 4 秒合并写一次，退出时兜底
  let stateDirty = false
  let stateTimer = null
  function flushStateNow() {
    if (!stateDirty) return
    stateDirty = false
    try {
      writeJson(REPLIED_FILE, replied)
      writeJson(USAGE_FILE, usage)
    } catch {
      /* ignore */
    }
  }
  function markStateDirty() {
    stateDirty = true
    if (stateTimer) return
    stateTimer = setTimeout(() => {
      stateTimer = null
      flushStateNow()
    }, 4000)
    if (stateTimer.unref) stateTimer.unref()
  }
  function recordReplied(roomId, id) {
    if (!id) return
    const k = String(roomId)
    const list = (replied[k] || []).filter((x) => Date.now() - (x.at || 0) < 7 * 86400000)
    if (list.some((x) => x.id === String(id))) return
    list.push({ id: String(id), at: Date.now() })
    replied[k] = list.slice(-100)
    markStateDirty()
  }

  function noteUsage(u) {
    if (!u) return
    const p = Number(u.inputTokens ?? u.promptTokens ?? 0) || 0
    const c = Number(u.outputTokens ?? u.completionTokens ?? 0) || 0
    usage.prompt += p
    usage.completion += c
    usage.total += p + c
    usage.calls += 1
    const day = new Date().toISOString().slice(0, 10)
    const d = usage.byDay[day] || { prompt: 0, completion: 0, total: 0, calls: 0 }
    d.prompt += p
    d.completion += c
    d.total += p + c
    d.calls += 1
    usage.byDay[day] = d
    // 只留 30 天，别让文件无限长
    const days = Object.keys(usage.byDay).sort()
    while (days.length > 30) delete usage.byDay[days.shift()]
    markStateDirty()
  }

  function usageView() {
    const days = Object.keys(usage.byDay).sort().slice(-7)
    return {
      total: usage.total,
      calls: usage.calls,
      today: usage.byDay[new Date().toISOString().slice(0, 10)] || { total: 0, calls: 0 },
      days: days.map((d) => ({ day: d, ...usage.byDay[d] })),
    }
  }

  function rememberSticker(url, from, subType) {
    if (!url || !/^https?:/i.test(url)) return ''
    const id = String(Math.abs(hashStr(mediaKey(url)))).slice(0, 12)
    const cur = stickers[id] || { url, from, at: Date.now(), uses: 0, subType: 0 }
    cur.url = url // 保留最新一次（rkey 会过期）
    cur.at = Date.now()
    cur.from = from || cur.from
    // 1=表情包；收到的如果是普通图就记 0，发的时候按记录决定
    if (subType !== undefined) cur.subType = Number(subType) || 0
    stickers[id] = cur
    // 只在真的超出上限时才排序裁剪（原来是每张图都全量排序）
    const max = Math.max(0, Number(config.stickerLibraryMax) || 0)
    const size = Object.keys(stickers).length
    if (max && size > max) {
      const keys = Object.keys(stickers).sort((a, b) => stickers[a].at - stickers[b].at)
      while (keys.length > max) delete stickers[keys.shift()]
    }
    markStickersDirty()
    return id
  }

  // ── 表情包本地化：QQ 的图片 URL 几小时就失效，收到时立刻存一份到本地 ──
  const STICKER_DIR = join(DATA_DIR, 'stickers')
  async function ensureStickerFile(s, id) {
    if (s.file && existsSync(s.file)) return s.file
    if (!s.url) throw new Error('没有 url')
    const res = await fetch(s.url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error('HTTP download failed: ' + res.status)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 6 * 1024 * 1024) throw new Error('图片过大')
    const ct = String(res.headers.get('content-type') || '').toLowerCase()
    const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg'
    mkdirSync(STICKER_DIR, { recursive: true })
    const key = String(id || Math.abs(hashStr(mediaKey(s.url)))).replace(/[^\w.-]/g, '_')
    const file = join(STICKER_DIR, key + '.' + ext)
    writeFileSync(file, buf)
    s.file = file
    s.cachedAt = Date.now()
    markStickersDirty()
    return file
  }

  function hashStr(s) {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
    return h
  }

  /** 只读文件尾部 N 行（日志可能几 MB，不整读）。 */
  function tailLines(file, n) {
    try {
      if (!existsSync(file)) return ''
      const st = statSync(file)
      const maxBytes = Math.min(st.size, 512 * 1024)
      const start = Math.max(0, st.size - maxBytes)
      const buf = Buffer.alloc(maxBytes)
      const fd = openSync(file, 'r')
      try {
        readSync(fd, buf, 0, maxBytes, start)
      } finally {
        closeSync(fd)
      }
      const lines = buf.toString('utf8').split(/\r?\n/)
      if (start > 0) lines.shift()
      return lines.slice(-n).join('\n')
    } catch {
      return ''
    }
  }

  // ── 发送失败重试队列（逻辑在 lib/outbox.mjs，带独立回归测试）──
  const OUTBOX_FILE = join(DATA_DIR, 'outbox.json')
  const outbox = new Outbox({
    load: () => readJson(OUTBOX_FILE, []),
    save: (items) => writeJson(OUTBOX_FILE, items),
    deliver: (item) => deliverOutboxItem(item),
    log,
  })

  /** 统一的"发出去，失败就排队"入口：工具和面板都走它，别再各写一套 try/catch。 */
  async function sendWithRetry(roomId, isGroup, kind, payload) {
    try {
      if (kind === 'segments') await ob.sendGroupSegments(roomId, payload)
      else if (!isGroup) await ob.sendPrivate(roomId, payload)
      else await ob.sendGroup(roomId, payload)
      return { ok: true }
    } catch (e) {
      const msg = String(e?.message || e)
      if (shouldRetrySend(msg)) {
        enqueueSend({ roomId, isGroup, kind, payload, error: msg })
        return { ok: true, queued: true, error: msg }
      }
      throw e
    }
  }

  function enqueueSend(p) {
    const item = outbox.enqueue(p)
    stats.queued = (stats.queued || 0) + 1
    return item
  }

  async function deliverOutboxItem(item) {
    if (item.isGroup && !isAllowedGroup(item.roomId)) throw new Error('不在白名单')
    if (!item.isGroup && !config.allowPrivate.includes(item.roomId)) throw new Error('私聊不在白名单')
    if (item.kind === 'segments') return ob.sendGroupSegments(item.roomId, item.payload)
    if (item.kind === 'private') return ob.sendPrivate(item.roomId, item.payload)
    return ob.sendGroup(item.roomId, item.payload)
  }

  async function flushOutbox() {
    const s = await outbox.flush()
    if (s.sent) stats.retried = (stats.retried || 0) + s.sent
    if (s.dropped) stats.dropped = (stats.dropped || 0) + s.dropped
    return s
  }

  // ── 识图（图片 / 表情包）───────────────────────────────
  const VISION_FILE = join(DATA_DIR, 'vision-cache.json')
  const visionCache = readJson(VISION_FILE, {})
  let visionBroken = '' // 同类失败只记一次日志，避免每条图都刷屏

  function visionKey(url) {
    return String(hashStr(mediaKey(url)))
  }

  /** QQ 的图片 URL 带会轮换的 rkey，直接当缓存键会永远 miss；只保留稳定参数。 */
  function mediaKey(url) {
    try {
      const u = new URL(String(url))
      const keep = new URLSearchParams()
      for (const k of ['fileid', 'appid', 'file', 'md5']) {
        const v = u.searchParams.get(k)
        if (v) keep.set(k, v)
      }
      const qs = keep.toString()
      return qs ? `${u.origin}${u.pathname}?${qs}` : `${u.origin}${u.pathname}`
    } catch {
      return String(url || '')
    }
  }
  function trimVisionCache() {
    const keys = Object.keys(visionCache)
    const max = Math.max(20, Number(config.visionCacheMax) || 300)
    if (keys.length <= max) return
    keys.sort((a, b) => (visionCache[a].at || 0) - (visionCache[b].at || 0))
    for (const k of keys.slice(0, keys.length - max)) delete visionCache[k]
  }
  function guessMediaType(res, url) {
    const ct = String(res?.headers?.get?.('content-type') || '').toLowerCase()
    if (ct.includes('png')) return 'image/png'
    if (ct.includes('jpeg') || ct.includes('jpg')) return 'image/jpeg'
    if (ct.includes('webp')) return 'image/webp'
    if (ct.includes('gif')) return 'image/gif'
    const u = String(url || '').toLowerCase().split('?')[0]
    if (u.endsWith('.png')) return 'image/png'
    if (u.endsWith('.webp')) return 'image/webp'
    if (u.endsWith('.gif')) return 'image/gif'
    return 'image/jpeg'
  }

  /** 解析视觉路由：配置优先；配的不可用就自动挑一个支持图片的模型。 */
  let visionRoute = null
  async function resolveVisionRoute() {
    if (visionRoute) return visionRoute
    const llm = ctx.get?.('llm')
    const wantP = String(config.visionProvider || '')
    const wantM = String(config.visionModel || '')
    if (llm?.listProviders) {
      const providers = (llm.listProviders() || []).map((p) => p.id)
      if (wantP && providers.includes(wantP)) {
        try {
          const models = (await llm.listModels(wantP)) || []
          const exact = models.find((m) => m.id === wantM)
          if (exact) {
            visionRoute = { provider: wantP, model: exact.id }
            return visionRoute
          }
          const visual = models.find((m) => (m.inputModalities || []).includes('image'))
          if (visual) {
            visionRoute = { provider: wantP, model: visual.id }
            log(`视觉模型回退：${wantM} 不可用 → ${visual.id}`)
            return visionRoute
          }
        } catch {
          /* 继续试其它 provider */
        }
      }
      for (const p of providers) {
        try {
          const models = (await llm.listModels(p)) || []
          const visual = models.find((m) => (m.inputModalities || []).includes('image'))
          if (visual) {
            visionRoute = { provider: p, model: visual.id }
            log(`视觉模型自动选择：${p}/${visual.id}`)
            return visionRoute
          }
        } catch {
          /* 下一个 */
        }
      }
    }
    if (wantP && wantM) {
      visionRoute = { provider: wantP, model: wantM }
      return visionRoute
    }
    throw new Error('找不到支持图片的模型路由（面板「识图」里指定 provider/model）')
  }

  /** 一次视觉请求。返回纯文本描述。 */
  async function generateVision(ref, prompt, opts = {}) {
    const route = await resolveVisionRoute()
    const provider = route.provider
    const model = route.model
    const ac = new AbortController()
    const killer = track(setTimeout(() => ac.abort(new Error('视觉超时')), 30000))
    let text = ''
    let finish = null
    try {
      const stream = ctx.llm.stream({
        provider,
        model,
        messages: [
          createUserMessage({
            source: { kind: 'user' },
            content: [
              { type: 'image', attachment: ref },
              { type: 'text', text: prompt },
            ],
          }),
        ],
        maxTokens: Number(opts.maxTokens || config.visionMaxTokens) || 900,
        temperature: 0.3,
        signal: ac.signal,
      })
      for await (const c of stream) {
        if (c.type === 'text-delta') text += c.text
        else if (c.type === 'usage') noteUsage(c.usage)
        else if (c.type === 'finish') finish = c.reason
        else if (c.type === 'block-end' && !text && c.block?.type === 'text') text = c.block.text || ''
      }
    } finally {
      untrack(killer)
    }
    if (!text && finish && finish.kind !== 'stop') {
      const f = finish.failure || {}
      // 视觉模型把预算全花在"想"上时是 max-tokens：把预算翻倍再试一次，别当成永久失败
      const budget = Number(opts.maxTokens || config.visionMaxTokens) || 900
      if (String(finish.kind) === 'max-tokens' && budget < 1800) {
        log(`视觉 max-tokens（预算 ${budget}），翻倍重试`)
        return await generateVision(ref, prompt, { ...opts, maxTokens: budget * 2 })
      }
      throw new Error(
        `视觉调用失败（${provider}/${model}）：${finish.kind}` +
          (f.message ? ' - ' + f.message : '') +
          (f.code ? ` [${f.code}]` : ''),
      )
    }
    return text.trim()
  }

  /** 图 URL → 一句描述（带 7 天磁盘缓存；失败返回 ''，不抛）。 */
  async function describeImage(url, kind = 'image', c = null) {
    const eff = c || config
    const want = kind === 'mface' ? eff.visionOnEmoticon : eff.visionOnImage
    if (!want) return ''
    const key = visionKey(url)
    const hit = visionCache[key]
    if (hit?.text && Date.now() - (hit.at || 0) < 7 * 86400000) return hit.text
    if (hit?.err && Date.now() - (hit.at || 0) < 600000) return ''
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
      if (!res.ok) throw new Error('下载失败 HTTP ' + res.status)
      const buf = Buffer.from(await res.arrayBuffer())
      const maxBytes = Number(config.visionMaxBytes) || 4 * 1024 * 1024
      let mediaType = guessMediaType(res, url)
      let useBuf = buf
      if (useBuf.length > maxBytes) {
        // 大图先压到 1280 宽再送视觉（群里照片经常 4MB+），别直接丢掉
        const small = await shrinkImage(useBuf, {
          mediaType,
          maxWidth: Number(config.visionMaxWidth) || 1280,
          ffmpeg: config.ffmpegPath || 'ffmpeg',
        })
        if (small && small.length <= maxBytes) {
          log('识图：图片过大已压缩 ' + Math.round(useBuf.length / 1024) + 'KB → ' + Math.round(small.length / 1024) + 'KB')
          useBuf = small
          mediaType = 'image/jpeg'
        } else {
          throw new Error(`图片过大 ${Math.round(buf.length / 1024)}KB（压缩失败）`)
        }
      }
      const att = ctx.get?.('attachments')
      if (!att || typeof att.saveImages !== 'function') throw new Error('没有 attachments 服务')
      const refs = await att.saveImages([{ data: new Uint8Array(useBuf), mediaType, name: kind }])
      const ref = refs?.[0]
      if (!ref) throw new Error('附件入库失败')
      const prompt =
        kind === 'mface'
          ? '这是一张 QQ 群聊表情包。用一两句话说明画面内容、表情/情绪、适合什么语境，不要客套。'
          : '这是群里发的一张图片。用一两句话说明画面里有什么、可能是什么意图，不要客套。'
      const text = await generateVision(ref, prompt)
      const out = String(text).replace(/\s+/g, ' ').trim().slice(0, 220)
      if (!out) throw new Error('视觉模型返回空')
      visionCache[key] = { text: out, at: Date.now(), kind }
      trimVisionCache()
      writeJson(VISION_FILE, visionCache)
      visionBroken = ''
      return out
    } catch (e) {
      const msg = String(e?.message || e)
      visionCache[key] = { err: msg, at: Date.now(), kind }
      trimVisionCache()
      writeJson(VISION_FILE, visionCache)
      if (visionBroken !== msg) {
        visionBroken = msg
        log('识图失败（同类只记一次）：' + msg)
      }
      return ''
    }
  }

  /** 给一条消息补上图片描述（就地改 text，供上下文使用）。 */
  async function attachVision(msg, urls, kinds, c = null) {
    const cap = Math.max(1, Math.min(9, Number(c?.visionMaxImages) || Number(config.visionMaxImages) || 2))
    const n = Math.min(urls.length, cap)
    // 两张图并行识，别一张一张等
    const list = await Promise.all(
      Array.from({ length: n }, (_, i) => describeImage(urls[i], kinds?.[i] || 'image', c).catch(() => '')),
    )
    const descs = list.filter(Boolean)
    if (!descs.length) return
    let text = msg.text
    for (const d of descs) text = text.replace(/\[(图片|表情)\]/, `[图片：${d}]`)
    msg.text = text
    msg.vision = descs
  }


  // ── 更多玩法：提醒 / 网页摘要 / 文档 ─────────────────────
  const BACKUP_DIR = join(DATA_DIR, 'backups')
  /** 软重载：把磁盘上的配置/覆盖/记忆/提醒/投票重新读进内存（不重启插件） */
  function softReload() {
    try {
      const fresh = readJson(CONFIG_FILE, {})
      for (const k of CONFIG_KEYS) if (k in fresh) config[k] = fresh[k]
    } catch (e) {
      log('软重载配置失败：' + String(e?.message || e))
    }
    try {
      const ov = readJson(ROOMS_FILE, {})
      roomOverrides = ov && typeof ov === 'object' && !Array.isArray(ov) ? ov : {}
    } catch { /* ignore */ }
    bumpCfg()
    for (const k of Object.keys(facts)) delete facts[k]
    try { roomTextCache.clear() } catch { /* ignore */ }
    try {
      const rm = readJson(REMINDERS_FILE, [])
      reminders.length = 0
      if (Array.isArray(rm)) reminders.push(...rm)
    } catch { /* ignore */ }
    try {
      const pl = readJson(POLLS_FILE, {})
      for (const k of Object.keys(polls)) delete polls[k]
      if (pl && typeof pl === 'object') Object.assign(polls, pl)
    } catch { /* ignore */ }
    log('已软重载：配置 / 每群覆盖 / 记忆缓存 / 提醒 / 投票')
    return true
  }

  /** 立即备份：配置 + 记忆（跳过临时/表情/依赖目录） */
  function backupNow() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const dest = join(BACKUP_DIR, stamp)
    mkdirSync(dest, { recursive: true })
    const skip = new Set(['backups', 'video-tmp', 'pylib', 'stickers'])
    let n = 0
    for (const name of readdirSync(DATA_DIR)) {
      if (skip.has(name)) continue
      try {
        cpSync(join(DATA_DIR, name), join(dest, name), { recursive: true })
        n += 1
      } catch { /* 单个失败跳过 */ }
    }
    log('已备份数据到 backups/' + stamp + '（' + n + ' 项）')
    return { name: stamp, items: n }
  }
  /** 只保留最近 N 份备份 */
  function pruneBackups() {
    const keep = Math.max(1, Math.min(30, Number(config.backupKeep) || 7))
    const names = backupList()
    for (const n of names.slice(keep)) {
      try { rmSync(join(BACKUP_DIR, n), { recursive: true, force: true }) } catch { /* ignore */ }
    }
    return names.slice(0, keep)
  }
  const BACKUP_STATE_FILE = join(DATA_DIR, 'backup-state.json')
  let backupBusy = false
  /** 每天到点自动备份一次（跨重载记在文件里，避免重复备份） */
  function backupTick() {
    if (!config.backupDaily || backupBusy) return
    const now = new Date()
    const hour = Math.max(0, Math.min(23, Number(config.backupHour) || 4))
    if (now.getHours() < hour) return
    const day = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
    const state = readJson(BACKUP_STATE_FILE, {})
    if (state.lastDay === day) return
    backupBusy = true
    try {
      const r = backupNow()
      pruneBackups()
      try { writeJson(BACKUP_STATE_FILE, { lastDay: day, at: Date.now(), name: r.name }) } catch { /* ignore */ }
      log('每日自动备份完成：' + r.name + '（保留 ' + (Number(config.backupKeep) || 7) + ' 份）')
    } catch (e) {
      log('每日自动备份失败：' + String(e?.message || e))
    } finally {
      backupBusy = false
    }
  }

  function backupList() {
    let names = []
    try {
      if (existsSync(BACKUP_DIR)) {
        names = readdirSync(BACKUP_DIR).filter((n) => statSync(join(BACKUP_DIR, n)).isDirectory())
      }
    } catch { /* ignore */ }
    return names.sort().reverse()
  }
  function backupRestore(name) {
    const dir = join(BACKUP_DIR, name)
    if (!name || !existsSync(dir)) throw new Error('没有这个备份：' + (name || '(空)'))
    let n = 0
    for (const item of readdirSync(dir)) {
      try {
        cpSync(join(dir, item), join(DATA_DIR, item), { recursive: true, force: true })
        n += 1
      } catch { /* ignore */ }
    }
    log('已从备份恢复 ' + n + ' 项：' + name)
    try {
      softReload()
    } catch (e) {
      log('恢复后软重载失败：' + String(e?.message || e))
    }
    return { restored: n, name }
  }
  const REMINDERS_FILE = join(DATA_DIR, 'reminders.json')
  const reminders = readJson(REMINDERS_FILE, []) // [{id, roomId, at, text}]
  const webCache = new Map() // url -> { at, data }
  const docLibDir = join(DATA_DIR, 'pylib')
  let reminderTimer = null

  // ── 视频：抽帧拼图 + 链接取信息 ───────────────────────────
  const VIDEO_CACHE_FILE = join(DATA_DIR, 'video-cache.json')
  const videoCache = readJson(VIDEO_CACHE_FILE, {})
  const linkCache = new Map() // url -> { info, at }（只在内存，重启清空）

  /** 同一条视频的稳定 key：URL 去掉 query（QQ 的 CDN token 每次都变），本地文件用 路径+大小+时间 */
  function videoKey(url) {
    const u = String(url || '')
    if (/^https?:/i.test(u)) return 'url:' + hashStr(u.split('?')[0])
    try {
      const st = statSync(u)
      return 'file:' + hashStr(u) + ':' + st.size + ':' + Math.round(st.mtimeMs)
    } catch {
      return 'raw:' + hashStr(u)
    }
  }
  function videoCacheGet(key) {
    const hit = videoCache[key]
    if (!hit) return null
    if (Date.now() - (hit.at || 0) > 14 * 86400000) return null
    return hit
  }
  function videoCacheSet(key, text, duration, meta) {
    videoCache[key] = { text, duration, at: Date.now(), ...(meta || {}) }
    const keys = Object.keys(videoCache)
    if (keys.length > 120) {
      keys.sort((a, b) => (videoCache[a].at || 0) - (videoCache[b].at || 0))
      for (const k of keys.slice(0, keys.length - 120)) delete videoCache[k]
    }
    try { writeJson(VIDEO_CACHE_FILE, videoCache) } catch { /* ignore */ }
  }
  // 启动时清掉"源文件已经不在了"的本地视频缓存（URL 缓存交给 14 天 TTL）
  try {
    let pruned = 0
    for (const [k, v] of Object.entries(videoCache)) {
      if (v?.kind === 'file' && v.source && !existsSync(v.source)) {
        delete videoCache[k]
        pruned += 1
      }
    }
    if (pruned) {
      writeJson(VIDEO_CACHE_FILE, videoCache)
      log(`视频缓存清理：${pruned} 条源文件已不存在`)
    }
  } catch { /* ignore */ }

  const VIDEO_DIR = join(DATA_DIR, 'video-tmp')
  // 启动时清掉残留（正常流程回复完会自己删；这里兜底异常退出留下的）
  try {
    if (existsSync(VIDEO_DIR)) {
      for (const n of readdirSync(VIDEO_DIR)) {
        const fp = join(VIDEO_DIR, n)
        try {
          if (Date.now() - statSync(fp).mtimeMs > 2 * 3600 * 1000) rmSync(fp, { force: true, recursive: true })
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
  function ffmpegBin() {
    return String(config.ffmpegPath || 'ffmpeg')
  }
  function ffprobeBin() {
    if (config.ffmpegPath) return String(config.ffmpegPath).replace(/ffmpeg(\.exe)?$/i, (m) => m.replace(/ffmpeg/i, 'ffprobe'))
    return 'ffprobe'
  }

  /** 把一段图片数据丢给视觉模型，返回一句描述 */
  async function describeBuffer(buf, mediaType, kind, prompt) {
    const att = ctx.get?.('attachments')
    if (!att || typeof att.saveImages !== 'function') throw new Error('没有 attachments 服务')
    const refs = await att.saveImages([{ data: new Uint8Array(buf), mediaType, name: kind || 'image' }])
    const ref = refs?.[0]
    if (!ref) throw new Error('附件入库失败')
    return await generateVision(ref, prompt)
  }

  /** 群里的视频：下载 → 抽 6 帧拼图 → 视觉模型看一眼 → 一句话描述 */
  async function describeVideo(url, c = null) {
    const eff = c || config
    if (!eff.videoOnMessage) return { desc: '', duration: 0 }
    const started = Date.now()
    const made = []
    let file = ''
    // 同一条视频看过就不再下、不再抽帧、不再问模型
    const ck = videoKey(url)
    const hit = videoCacheGet(ck)
    if (hit?.text) {
      log('看视频命中缓存：' + hit.text.slice(0, 30))
      return { desc: hit.text, duration: Number(hit.duration) || 0, files: [] }
    }
    try {
      if (!existsSync(VIDEO_DIR)) mkdirSync(VIDEO_DIR, { recursive: true })
      const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8)
      const sheetPath = join(VIDEO_DIR, stamp + '.jpg')
      const frames = Number(eff.videoFrames) || 6
      const maxSeconds = Number(eff.videoMaxSeconds) || 300
      let dur = 0
      let sheet = ''
      // 远程视频先下载（QQ 的 CDN 下载很快；直连读流遇到"索引在文件尾"的 mp4 会变成读全片）
      if (/^https?:/i.test(url)) {
        const maxBytes = Math.max(1, Number(eff.videoMaxMB) || 80) * 1024 * 1024
        file = await downloadTo(url, join(VIDEO_DIR, stamp + '.mp4'), { timeoutMs: 45000, maxBytes })
        made.push(file)
      } else if (/^file:/i.test(url)) {
        file = fileURLToPath(url)
      } else if (existsSync(url)) {
        file = url
      }
      if (!file || !existsSync(file)) throw new Error('拿不到视频文件')
      dur = await probeDuration(file, { ffprobe: ffprobeBin() })
      sheet = await makeContactSheet(file, sheetPath, { frames, width: Number(eff.videoSheetWidth) || 480, maxSeconds, ffmpeg: ffmpegBin() })
      if (sheet) made.push(sheet)
      if (!sheet) throw new Error('抽帧失败')
      const msFrames = Date.now() - started
      const tVision = Date.now()
      const buf = readFileSync(sheet)
      const desc = await describeBuffer(
        buf,
        'image/jpeg',
        'image',
        '这是视频的几帧画面。用一句话说清它在讲什么、画面里有什么；别客套，别提"拼图"。',
      )
      const msVision = Date.now() - tVision
      const out = String(desc || '').replace(/\s+/g, ' ').trim().slice(0, 260)
      log('看视频' + (dur ? '（' + Math.round(dur) + ' 秒）' : '') + '：' + (out ? '成功' : '没描述出来') + `｜下载+抽帧 ${msFrames}ms 视觉 ${msVision}ms｜总 ${Date.now() - started}ms`)
      if (out) {
        // 记下来源：本地文件用原路径（源文件删了下次启动就清缓存），URL 交给 TTL
        const source = /^https?:/i.test(url) ? '' : /^file:/i.test(url) ? fileURLToPath(url) : url
        videoCacheSet(ck, out, dur, source ? { kind: 'file', source } : { kind: 'url' })
      }
      return { desc: out, duration: dur, files: made }
    } catch (e) {
      log('看视频失败：' + String(e?.message || e))
      return { desc: '', duration: 0, files: made }
    }
  }


  const POLLS_FILE = join(DATA_DIR, 'polls.json')
  const polls = readJson(POLLS_FILE, {}) // roomId -> { q, options: [], votes: {sender: idx}, at }

  // 更多玩法：延迟初始化，第一次用到时才构造，避开 apply 早期的 TDZ
  let features = null
  function getFeatures() {
    if (!features) {
      features = createFeatures({
        config, rooms, reminders, polls, REMINDERS_FILE, POLLS_FILE,
        log, sendReply, roomState, allowedHere, isManagedRoom, memDirOf,
        readJson, writeJson, normText, recordReplied, generate, factsOf,
        invalidateRoomText, moodName, ob,
      })
    }
    return features
  }
  /** 普通网页链接 → 标题 + 正文节选 */
  async function buildWebLinkNote(text, c) {
    if (!c.linkSummary) return ''
    const links = pickWebLink(text, 1)
    if (!links.length) return ''
    const url = links[0]
    const hit = webCache.get(url)
    let data = hit && Date.now() - hit.at < 3600000 ? hit.data : null
    if (!data) {
      try {
        data = await fetchPageSummary(url, { maxChars: 1200 })
        webCache.set(url, { at: Date.now(), data })
        if (webCache.size > 200) {
          const oldest = [...webCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, webCache.size - 200)
          for (const [k] of oldest) webCache.delete(k)
        }
      } catch (e) {
        log('网页摘要失败：' + String(e?.message || e))
        return '\n【群友发的链接】没打开（' + String(e?.message || '').slice(0, 50) + '）。别装看过，就说没打开。'
      }
    }
    if (!data) return ''
    return [
      '\n【群友发的网页链接（已抓到的内容）】',
      data.title ? '标题：' + data.title : '',
      data.description ? '简介：' + data.description : '',
      data.text ? '正文节选：' + data.text : '',
      '（用平时口气说一句它讲什么，别念链接、别列条目。）',
    ].filter(Boolean).join('\n')
  }

  /**
   * 把"看过的视频"提炼成一条长期记忆（只留最近几条，别把记忆撑爆）。
   * info 有标题时用标题，否则用画面描述。
   */
  function rememberVideo(r, v, info) {
    const c = cfgFor(r.roomId)
    if (!c.videoRemember) return
    if (!isManagedRoom(r.roomId)) return
    const rawTitle = info?.title ? String(info.title).replace(/\s+/g, ' ').trim() : ''
    const title = rawTitle ? (rawTitle.length > 26 ? rawTitle.slice(0, 26) + '…' : rawTitle) : ''
    let desc = String(v?.desc || '').replace(/\s+/g, ' ').trim()
    if (desc === '-' || /^[-—\s]*$/.test(desc)) desc = ''
    if (!title && !desc) return
    const secs = Math.round(Number(v?.duration || info?.duration || 0))
    const text = ('看过一个视频' + (title ? `《${title}》` : '') + (secs ? `（${secs} 秒）` : '') + '：' + (desc || '只拿到标题，没看到画面')).slice(0, 160)
    // 只保留最近 N 条视频记忆
    const max = Math.max(1, Number(c.videoRememberMax) || 5)
    const old = factsOf(r.roomId).filter((x) => !x.supersededAt && x.text.startsWith('看过一个视频'))
    while (old.length >= max) {
      const victim = old.shift()
      try { delFact(r.roomId, victim.text) } catch { /* ignore */ }
    }
    const ok = addFact(r.roomId, text)
    if (ok) log('视频记忆：' + text.slice(0, 50))
  }

  /** 消息里的视频链接：yt-dlp 抓标题/时长/简介/字幕，拼成一段上下文 */
  async function buildVideoLinkNote(text, c) {
    if (!c.linkVideo) return null
    const links = pickVideoLinks(text, 1)
    if (!links.length) return null
    const link = links[0]
    const cachedLink = linkCache.get(link)
    const fresh = !!cachedLink && Date.now() - cachedLink.at < 3600000
    const info = fresh
      ? cachedLink.info
      : await ytdlpInfo(link, { timeoutMs: Math.min(30000, Number(c.linkVideoTimeoutMs) || 15000) })
    if (!info.ok) {
      log('视频链接解析失败：' + String(info.error || '').slice(0, 120))
      return { note: '\n【群友发的视频链接】没解析出来（' + String(info.error || '未知原因').slice(0, 80) + '）。别装看过，就说没打开。', info: null }
    }
    // 字幕也缓存：同一个链接 1 小时内不再跑 yt-dlp（抓不到也记住"试过了"，别反复超时）
    let sub = fresh && typeof cachedLink.sub === 'string' ? cachedLink.sub : ''
    const subTried = fresh && cachedLink.subTried === true
    if (!subTried && !sub && info.duration && info.duration <= 900) {
      try {
        sub = await ytdlpSubtitleText(link, { timeoutMs: Math.min(30000, Number(c.linkVideoTimeoutMs) || 15000), maxChars: Number(c.linkVideoChars) || 1200 })
      } catch { /* 没字幕就算了 */ }
    }
    linkCache.set(link, { info, sub, subTried: true, at: Date.now() })
    if (linkCache.size > 200) {
      const oldest = [...linkCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, linkCache.size - 200)
      for (const [k] of oldest) linkCache.delete(k)
    }
    log('视频链接：' + info.title.slice(0, 40) + '｜' + (sub ? '有字幕 ' + sub.length + ' 字' : '无字幕'))
    const note = [
      '\n【群友发的视频链接（已抓到的信息）】',
      info.title ? '标题：' + info.title : '',
      info.uploader ? 'UP主：' + info.uploader : '',
      info.duration ? '时长：' + Math.round(info.duration) + ' 秒' : '',
      info.description && info.description !== '-' ? '简介：' + info.description : '',
      sub ? '字幕节选：' + sub : '（没抓到字幕）',
      '（用平时的口气说一句你看到的内容；没抓到具体内容就说没打开，别编。）',
    ].filter(Boolean).join('\n')
    return { note, info: { ...info, subtitle: sub } }
  }

  // ── 联网搜索（用户明确让它查时才查）────────────────────
  const SEARCH_TRIGGER =
    /(搜一下|搜一搜|搜搜|搜下|搜索|帮我搜|你去搜|给我搜|查一下|查一查|查查|查下|帮我查|你去查|给我查|百度一下|谷歌一下|google一下|bing一下|联网查|上网查|核实一下|验证一下|查证一下|看一下|看一看|看一眼|看看|瞧一瞧)/i
  const SEARCH_STRIP =
    /(?:你|帮我|给我|麻烦你?|能不能|可不可以|可以|要不|那就)?\s*(?:去|上网上|联网|上网)?\s*(?:搜一下|搜一搜|搜搜|搜下|搜索|搜|查一下|查一查|查查|查下|查|百度一下|百度|谷歌一下|谷歌|google一下|google|bing一下|核实一下|验证一下|查证一下|看一下|看一看|看一眼|看看|瞧一瞧)\s*(?:一下|下|个|一搜)?\s*[:：]?/i
  const SEARCH_TAIL =
    /(?:[，,。.！!]?\s*(?:然后|再|顺便)?\s*(?:告诉我|跟我说|回复我|回我|发我|说一下|讲讲|总结一下|整理一下|给我看看)[\s\S]*)$/i

  /** 认出"让我去搜"的意图并抽出查询词；没有就返回 ''。 */
  function extractSearchQuery(text) {
    const t = String(text || '').trim()
    if (!t || !SEARCH_TRIGGER.test(t)) return ''
    let q = t.replace(SEARCH_STRIP, '').replace(SEARCH_TAIL, '').trim()
    // 去掉开头的 @我 / @所有人 占位（只认这三个，别贪吃掉整句）
    q = q
      .replace(/^@(?:我|所有人|全体成员)\s*/, '')
      .replace(/^[，,。.：:\s]+/, '')
      .replace(/[？?！!。.]+$/, '')
      .trim()
    if (!q) {
      q = t
        .replace(SEARCH_STRIP, '')
        .replace(/@(?:我|所有人|全体成员)/g, ' ')
        .trim()
        .slice(0, 80)
    }
    return q.slice(0, 80)
  }

  /** 不把隐私/链接发给搜索引擎。（@我 / @昵称 是归一化占位，不算账号） */
  function sensitiveQuery(q) {
    const s = String(q || '')
      .replace(/@(我|所有人|全体成员)/g, ' ')
      .trim()
    if (/\d{6,}/.test(s)) return '含长数字（可能是 QQ 号/手机号）'
    if (/https?:\/\//i.test(s)) return '含链接'
    if (/@[A-Za-z0-9_.-]{2,}/.test(s)) return '含 @ 账号'
    return ''
  }

  function stripHtml(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
  }

  async function fetchExcerpt(url, chars, timeoutMs) {
    const web = ctx.get?.('web')
    if (!web || typeof web.fetch !== 'function') return ''
    const r = await web.fetch({ url }, AbortSignal.timeout(timeoutMs))
    // 先截断再剥标签：有的页面几 MB，整段 stripHtml 会明显卡住
    const body = String(r?.body?.content || '').slice(0, 200000)
    const text = r?.body?.kind === 'html' ? stripHtml(body) : body
    return text.slice(0, chars)
  }

  async function webSearch(query, limit, timeoutMs) {
    const web = ctx.get?.('web')
    if (!web || typeof web.search !== 'function') throw new Error('DSH 没有可用的 web 搜索服务')
    const r = await web.search({ query, maxResults: limit }, AbortSignal.timeout(timeoutMs))
    const srcs = (r?.sources || []).slice(0, limit)
    const lines = srcs.map(
      (s, i) => `${i + 1}. ${s.title || '(无标题)'}${s.snippet ? ' — ' + s.snippet : ''}${s.url ? `（${s.url}）` : ''}`,
    )
    // 搜索常常只给标题：抓第一条正文补足事实（天气/价格/比分这类必须靠它）
    let excerpt = ''
    if (config.searchFetchTop && srcs[0]?.url) {
      try {
        excerpt = await fetchExcerpt(
          srcs[0].url,
          Number(config.searchFetchChars) || 1200,
          Math.max(3000, timeoutMs),
        )
      } catch {
        /* 抓不到就算了，别影响搜索本身 */
      }
    }
    const text = [
      r?.content ? String(r.content) : '',
      ...lines,
      excerpt ? `页面摘录（${srcs[0].url}）：\n${excerpt}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    return { text, count: srcs.length, fetched: !!excerpt }
  }

  /** 给一次回复准备搜索材料：冷却 + 隐私 + 超时 + 失败降级。 */
  async function buildSearchNote(room, text, c = cfgFor(room.roomId)) {
    if (!c.webSearch) return null
    const query = extractSearchQuery(text)
    if (!query) return null
    const bad = sensitiveQuery(query)
    if (bad) {
      log(`不搜「${query}」：${bad}`)
      return { query, skipped: bad, text: '' }
    }
    const now = Date.now()
    if (room.lastSearchAt && now - room.lastSearchAt < Number(c.searchCooldownMs)) {
      return { query, skipped: '冷却中', text: '' }
    }
    const t0 = Date.now()
    try {
      const { text: body, count } = await webSearch(
        query,
        Number(c.searchMaxResults) || 5,
        Number(c.searchTimeoutMs) || 8000,
      )
      room.lastSearchAt = Date.now()
      stats.searches += 1
      log(`联网搜索「${query}」→ ${count} 条（${Date.now() - t0}ms）`)
      return { query, text: body, count, ms: Date.now() - t0 }
    } catch (e) {
      const msg = String(e?.message || e)
      log(`联网搜索失败「${query}」：${msg}`)
      return { query, error: msg, text: '' }
    }
  }

  const timers = new Set()
  const track = (t) => {
    timers.add(t)
    return t
  }
  const untrack = (t) => {
    timers.delete(t)
    clearTimeout(t)
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const ob = new OneBot({ log })

  // 群名缓存（只读，来自 get_group_list）；rooms 只装"真的收到过消息"的会话
  const groupNames = new Map()
  let noticeShapes = 0

  function roomState(roomId, roomName) {
    const key = String(roomId)
    let r = rooms.get(key)
    if (!r) {
      r = {
        roomId: key,
        roomName: roomName || groupNames.get(key) || '',
        isGroup: key.length > 8,
        msgs: [],
        pending: [],
        timer: null,
        replyTimes: [],
        lastReplyAt: 0,
        lastActivityAt: 0,
        lastProactiveAt: 0,
        lastDecision: null,
        lastSender: '',
        streak: 0,
        nameCache: new Map(),
        seen: new Set(),
        flushing: false,
        lastSearchAt: 0,
        muteUntil: 0,
        mood: { name: '', at: 0, intensity: 0 }, // 情绪状态（困/馋/得意/委屈…）
        lineTarget: 0,                            // 这次回复打算说几句（长度浮动用）
        replyCharsCap: 0,                         // 这次回复的字数上限（跟着句数走）
      }
      // 重启后把"已回复过的消息 id"装回去，避免对同一条再回一遍
      for (const x of replied[key] || []) if (x?.id) r.seen.add(String(x.id))
      // 面板里保存过的成员显示名也装回去
      for (const [uid, nm] of Object.entries(savedNames[key] || {})) {
        if (uid && nm) r.nameCache.set(String(uid), String(nm))
      }
      rooms.set(key, r)
    }
    if (roomName && !r.roomName) r.roomName = roomName
    return r
  }

  function allowedHere(r) {
    if (r.isGroup) return isAllowedGroup(r.roomId)
    // 私聊：白名单 + 管理员都算允许（管理员不必再单独加一遍）
    return config.allowPrivate.includes(r.roomId) || config.adminQQ.includes(String(r.roomId))
  }

  /** 这条消息是不是"必须回"：私聊管理员，或该群开了必回。 */
  function mustReply(r, sender) {
    if (!r.isGroup) return config.adminQQ.includes(String(sender ?? r.roomId))
    return !!cfgFor(r.roomId).alwaysReply
  }

  // ── 管理员私聊遥控（指令 → 确认 → 执行）────────────────
  let pendingAdmin = null
  const CONFIRM_WORDS = /^(确认|确定|执行|是的|yes|y|ok)$/i
  const CANCEL_WORDS = /^(取消|算了|不用了|不|no|n)$/i

  function findRoomByText(text) {
    const t = String(text || '')
    for (const id of new Set([...groupNames.keys(), ...rooms.keys()])) {
      if (id && t.includes(id)) return { roomId: id, name: groupNames.get(id) || (rooms.get(id) || {}).roomName || '' }
    }
    let best = null
    for (const [id, name] of groupNames) {
      if (!name || name.length < 2) continue
      if (t.includes(name) && (!best || name.length > best.name.length)) best = { roomId: id, name }
    }
    if (best) return best
    for (const r of rooms.values()) {
      if (r.roomName && r.roomName.length >= 2 && t.includes(r.roomName)) {
        if (!best || r.roomName.length > best.name.length) best = { roomId: r.roomId, name: r.roomName }
      }
    }
    return best
  }

  /** 先数"这句话里有几个动作"，避免把复合指令只执行一半。 */
  function detectIntents(t) {
    const out = []
    if (/(取消|不用|别)[\s\S]{0,12}?必回/.test(t)) out.push('alwaysReplyOff')
    else if (/必回|必须回|一定回/.test(t)) out.push('alwaysReplyOn')
    if (/(恢复|解除|取消)[\s\S]{0,8}?(安静|静音|说话)/.test(t)) out.push('unmute')
    else if (/(安静|闭嘴|别说话|静音|歇一会)/.test(t)) out.push('mute')
    if (/(?:人设|性格)[\s\S]{0,8}?(?:改成|改为|设为|换成)/.test(t)) out.push('persona')
    if (/(?:说|发|告诉|通知|转告|喊)(?:一句|一句话|句话)?\s*[:：]\s*([\s\S]+)/.test(t)) out.push('say')
    return [...new Set(out)]
  }

  /** 从一句话里认出管理员的遥控指令。 */
  function parseAdminCommand(text) {
    const t = String(text || '').trim()
    const target = findRoomByText(t)
    const intents = detectIntents(t)
    if (!intents.length) return null
    if (intents.length > 1) return { action: 'multi', target, intents }
    const action = intents[0]
    if (action === 'mute') {
      const m = /(\d{1,3})\s*(分钟|小时)/.exec(t)
      const minutes = m ? (m[2] === '小时' ? Number(m[1]) * 60 : Number(m[1])) : 60
      return { action, target, minutes }
    }
    if (action === 'persona') {
      const pm = /(?:人设|性格)[\s\S]{0,8}?(?:改成|改为|设为|换成)\s*[:：]?\s*([\s\S]+)/.exec(t)
      return pm ? { action, target, value: pm[1].trim().slice(0, 800) } : null
    }
    if (action === 'say') {
      const sm =
        /(?:说|发|告诉|通知|转告|喊)(?:一句|一句话|句话)?\s*[:：]\s*([\s\S]+)/.exec(t) ||
        /(?:说一句|说句话|发一句|发句话)\s*[:：]?\s*([\s\S]+)/.exec(t)
      return sm ? { action, target, text: sm[1].trim().slice(0, 500) } : null
    }
    return { action, target }
  }

  function describeAdminAction(a) {
    const name = a.target?.name || a.target?.roomId || '?'
    if (a.action === 'multi') return `一句话里有多个动作（${(a.intents || []).join('、')}），一次只能说一件`
    if (a.action === 'compose') return `在群「${name}」按你的要求说一句：${a.instruction}`
    if (a.action === 'say') return `在群「${name}」发送：\n${a.text}`
    if (a.action === 'mute') return `把群「${name}」静音 ${a.minutes} 分钟`
    if (a.action === 'unmute') return `让群「${name}」恢复正常说话`
    if (a.action === 'alwaysReplyOn') return `让群「${name}」变成必回（不看概率）`
    if (a.action === 'alwaysReplyOff') return `取消群「${name}」的必回`
    if (a.action === 'persona') return `把群「${name}」的人设改成：\n${a.value}`
    return '未知操作'
  }

  async function replyAdmin(adminId, text) {
    try {
      await ob.sendPrivate(adminId, text)
    } catch (e) {
      log('回复管理员失败：' + String(e?.message || e))
    }
  }

  async function executeAdminAction(a) {
    const roomId = a.target.roomId
    const name = a.target.name || roomId
    try {
      if (a.action === 'say') {
        const res = await sendWithRetry(roomId, true, 'text', a.text)
        return res.queued ? `⚠️ 网络抖动，已排队重发到「${name}」` : `✅ 已发到「${name}」`
      }
      if (a.action === 'compose') {
        const rr = roomState(roomId)
        const out = await generate({
          system: systemPrompt(rr),
          user: `现在按这个要求，用你在这个群里平时的口气说一句话：${a.instruction}\n只输出这句话本身，不要解释、不要引号。`,
          maxTokens: Math.max(80, Number(config.adminComposeTokens) || 400),
        })
        const line = String(out.text || '').trim()
        if (!line) return `⚠️ 「${name}」生成失败`
        if (a.at) {
          await ob.sendGroupSegments(roomId, [
            { type: 'at', data: { qq: String(a.at) } },
            { type: 'text', data: { text: ' ' + line } },
          ])
          return `✅ 在「${name}」@${a.at} 说了：${line.slice(0, 50)}`
        }
        const res = await sendWithRetry(roomId, true, 'text', line)
        return res.queued ? `⚠️ 网络抖动，已排队重发到「${name}」` : `✅ 在「${name}」说了：${line.slice(0, 50)}`
      }
      if (a.action === 'mute') {
        const r = roomState(roomId)
        r.muteUntil = Date.now() + a.minutes * 60000
        return `🔇 「${name}」已静音 ${a.minutes} 分钟`
      }
      if (a.action === 'unmute') {
        const r = roomState(roomId)
        r.muteUntil = 0
        return `🔊 「${name}」已恢复说话`
      }
      if (a.action === 'alwaysReplyOn' || a.action === 'alwaysReplyOff') {
        const cur = roomOverrides[roomId] || {}
        setRoomOverride(roomId, { ...cur, alwaysReply: a.action === 'alwaysReplyOn' })
        return `✅ 「${name}」必回=${a.action === 'alwaysReplyOn' ? '开' : '关'}`
      }
      if (a.action === 'persona') {
        const cur = roomOverrides[roomId] || {}
        setRoomOverride(roomId, { ...cur, persona: a.value })
        return `✅ 「${name}」人设已更新`
      }
    } catch (e) {
      return '❌ 执行失败：' + String(e?.message || e)
    }
    return '❓ 不认识的指令'
  }

  // ── 自然语言指令：规则没命中时，让模型翻译成动作计划 ──
  const ADMIN_ACTION_DOC = [
    '- say {room, text}：把 text 原样发到群里',
    '- compose {room, instruction, at?}：按 instruction 用该群人格生成一句话发到群里；at 是要 @ 的 QQ 号',
    '- mute {room, minutes}：静音该群 minutes 分钟',
    '- unmute {room}：解除静音',
    '- alwaysReplyOn {room} / alwaysReplyOff {room}：开/关该群必回',
    '- persona {room, value}：把该群人设改成 value',
  ].join('\n')

  async function planAdminCommand(text) {
    const groups = [...groupNames.entries()]
      .slice(0, 30)
      .map(([id, name]) => `${id} ${name || ''}`)
      .join('\n')
    const max = Math.max(1, Math.min(5, Number(config.adminMaxActions) || 3))
    try {
      const req = {
        system: '你是指令解析器。只输出 JSON，不要解释、不要代码块标记。',
        user: [
          `管理员说：「${text}」`,
          '（管理员＝跟你私聊的这个人；"我/我一句"都指管理员本人）',
          '',
          '可用动作：',
          ADMIN_ACTION_DOC,
          '',
          '判断要点：',
          '- 让你"喊他/叫他/夸他/说一句/打招呼"→ 用 compose（instruction 写清要什么口气、称呼什么）',
          '- 明确给了要原样发出去的句子 → 用 say',
          '- 带"然后/顺便/同时"的多件事 → 拆成多个动作',
          '',
          '可选群（room 只能从这里选）：',
          groups,
          '',
          `把这句话翻译成动作，最多 ${max} 个。输出格式：{"actions":[...]}；不确定就输出 {"actions":[]}。`,
        ].join('\n'),
        // 带思考的模型会把预算花在思考上；解析器输出必须完整，预算可在面板里调
        maxTokens: Math.max(200, Number(config.adminPlanTokens) || 3000),
        temperature: 0.1,
        reasoningEffort: config.adminPlanReasoning || undefined,
      }
      let out
      try {
        out = await generate(req)
      } catch (e) {
        // 有的模型不认 low 档 → 退回默认档再来一次
        log('指令解析低推理档失败，回退默认：' + String(e?.message || e))
        out = await generate({ ...req, reasoningEffort: undefined })
      }
      const raw = String(out.text || '')
        .trim()
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/, '')
        .trim()
      const m = /\{[\s\S]*\}/.exec(raw)
      if (!m) {
        log(`指令解析：没找到 JSON（finish=${out.finish?.kind || '?'}，原文 ${raw.slice(0, 120)}）`)
        return []
      }
      const j = JSON.parse(m[0])
      const list = Array.isArray(j?.actions) ? j.actions : []
      if (!list.length) log(`指令解析：模型给出空动作（finish=${out.finish?.kind || '?'}，原文 ${raw.slice(0, 160)}）`)
      return list
    } catch (e) {
      log('指令解析失败：' + String(e?.message || e))
      return []
    }
  }

  /** 模型给的动作只是"提案"：这里逐项校验，非法的一律丢掉。 */
  function normalizePlannedActions(list) {
    const max = Math.max(1, Math.min(5, Number(config.adminMaxActions) || 3))
    const allowed = new Set(['say', 'compose', 'mute', 'unmute', 'alwaysReplyOn', 'alwaysReplyOff', 'persona'])
    const out = []
    for (const raw of (Array.isArray(list) ? list : []).slice(0, max)) {
      const action = String(raw?.action || '')
      if (!allowed.has(action)) continue
      const room = String(raw?.room || '')
        .trim()
        .replace(/^group:/, '')
      if (!room) continue
      const target = { roomId: room, name: groupNames.get(room) || (rooms.get(room) || {}).roomName || '' }
      const a = { action, target }
      if (action === 'say') {
        const t = String(raw.text || '').trim()
        if (!t) continue
        a.text = t.slice(0, 500)
      } else if (action === 'compose') {
        const ins = String(raw.instruction || '').trim()
        if (!ins) continue
        a.instruction = ins.slice(0, 300)
        if (raw.at) a.at = String(raw.at).replace(/\D/g, '').slice(0, 12)
      } else if (action === 'mute') {
        a.minutes = Math.max(1, Math.min(720, Number(raw.minutes) || 60))
      } else if (action === 'persona') {
        const v = String(raw.value || '').trim()
        if (!v) continue
        a.value = v.slice(0, 800)
      }
      out.push(a)
    }
    return out
  }

  /** true = 这条私聊已被指令流程消费，不要再走正常回复。 */
  async function handleAdminCommand(r, trigger) {
    if (r.isGroup || !config.adminCommands) return false
    const adminId = String(r.roomId)
    if (!config.adminQQ.includes(adminId)) return false
    const text = String(trigger.text || '').trim()
    if (!text) return false

    if (pendingAdmin) {
      if (Date.now() > pendingAdmin.expiresAt) {
        pendingAdmin = null
        await replyAdmin(adminId, '那条指令超时作废了。')
        return true
      }
      if (CONFIRM_WORDS.test(text)) {
        const plan = pendingAdmin
        pendingAdmin = null
        const lines = []
        for (const a of plan.actions) lines.push(await executeAdminAction(a))
        await replyAdmin(adminId, lines.join('\n'))
        log(`管理员指令已执行：${plan.actions.map((a) => `${a.action}@${a.target.roomId}`).join('、')}`)
        return true
      }
      if (CANCEL_WORDS.test(text)) {
        pendingAdmin = null
        await replyAdmin(adminId, '好，已取消。')
        return true
      }
      pendingAdmin = null // 说了别的 → 当成新指令重新解析
    }

    // ① 确定性规则（快、不花 token）；带"然后/顺便/同时"的复合句直接交给模型拆
    let actions = []
    const compound = /(顺便|然后|同时|接着|之后|并且)/.test(text)
    const cmd = compound ? null : parseAdminCommand(text)
    if (cmd?.action === 'multi') {
      await replyAdmin(adminId, '这句话里像是同时让我做好几件事，一次说一件吧（先静音，再说别的）。')
      return true
    }
    if (cmd?.action) {
      if (!cmd.target) {
        await replyAdmin(adminId, '要操作哪个群？把群名或群号说清楚一点（例如「我的群」或 123456789）。')
        return true
      }
      actions = [cmd]
    } else if (config.adminNL) {
      // ② 规则没命中 → 让模型翻译成动作计划（只是提案，下面逐项校验）
      actions = normalizePlannedActions(await planAdminCommand(text))
    }
    if (!actions.length) return false

    const bad = actions.find((a) => !isAllowedGroup(a.target.roomId))
    if (bad) {
      await replyAdmin(adminId, `群「${bad.target.name || bad.target.roomId}」不在白名单里，不能操作。`)
      return true
    }

    const ttl = Number(config.adminConfirmTtlMs) || 120000
    pendingAdmin = { actions, expiresAt: Date.now() + ttl }
    log(`管理员指令待确认：${actions.map((a) => `${a.action}@${a.target.roomId}`).join('、')}`)
    const list = actions.map((a, i) => `${i + 1}. ${describeAdminAction(a)}`).join('\n')
    await replyAdmin(
      adminId,
      `【待确认】\n${list}\n\n回复「确认」执行；回复「取消」或说别的都会作废（${Math.round(ttl / 1000)} 秒内有效）。`,
    )
    return true
  }

  // ── 事件 ──────────────────────────────────────────────
  async function onEvent(ev) {
    if (ev?.notice) {
      void handleNotice(ev.notice).catch((e) => log('拍一拍处理失败：' + String(e?.message || e)))
      return
    }
    if (!ev?.roomId) return
    const r = roomState(ev.roomId)
    // 群/私聊必须按事件判断：群号和 QQ 号都是 9~10 位，靠长度猜会把私聊当群
    if (typeof ev.isGroup === 'boolean') r.isGroup = ev.isGroup
    // 去重：WS 推送与轮询兜底可能送同一条
    if (ev.id && r.seen.has(ev.id)) return
    if (ev.id) {
      r.seen.add(ev.id)
      if (r.seen.size > 600) r.seen.delete(r.seen.values().next().value)
    }
    stats.msgsIn += 1
    if (ev.senderName) {
      r.nameCache.set(String(ev.sender), ev.senderName)
      if (r.nameCache.size > 500) r.nameCache.delete(r.nameCache.keys().next().value)
    }
    // 群里的图/表情顺手收进图库（自己发的不收；带上 sub_type，发的时候才能还原成表情包）
    if (!ev.isSelf && ev.imageUrls?.length) {
      ev.imageUrls.forEach((u, i) => {
        const sid = rememberSticker(u, ev.senderName, ev.imageSubTypes?.[i] ?? 0)
        const st = sid ? stickers[sid] : null
        if (!st) return
        // 立刻存一份到本地：QQ 的图片链接几小时就过期，不存就再也发不出去
        void ensureStickerFile(st, sid).catch(() => {})
        // sub_type>=1 都是表情类（1=表情，7=另一变体）；顺手收进 QQ 收藏（服务端持久化，发出去是表情气泡）
        if ((ev.imageSubTypes?.[i] ?? 0) >= 1) void favoriteSticker(st, u, sid)
      })
    }
    const entry = {
      id: ev.id,
      ts: ev.ts,
      sender: ev.sender,
      senderName: ev.senderName || ev.sender,
      isSelf: ev.isSelf,
      isAtMe: ev.isAtMe,
      text: ev.text,
      images: ev.images,
    }
    r.msgs.push(entry)
    if (r.msgs.length > 200) r.msgs.splice(0, r.msgs.length - 200)
    r.lastActivityAt = Date.now()

    // 没有群名片时去补一次真实昵称（每个 sender 10 分钟内只查一次）
    if (config.useDbMembers && r.isGroup && (!ev.senderName || ev.senderName === String(ev.sender))) {
      const sid = String(ev.sender)
      const cached = r.nameCache.get(sid)
      if (cached) {
        entry.senderName = cached
      } else {
        r.nameFetched = r.nameFetched || new Map()
        if (Date.now() - (r.nameFetched.get(sid) || 0) > 600000) {
          r.nameFetched.set(sid, Date.now())
          void ob
            .groupMember(r.roomId, sid)
            .then((m) => {
              const nm = String(m?.card || m?.nickname || '').trim()
              if (nm) {
                r.nameCache.set(sid, nm)
                entry.senderName = nm
              }
            })
            .catch(() => {})
        }
      }
    }

    if (ev.isSelf || !ev.text) return
    if (!allowedHere(r)) {
      stats.blocked += 1
      if (stats.blocked % 20 === 1) log(`忽略未授权会话 ${r.roomId}（${ev.senderName}）`)
      return
    }
    if (!config.enabled) return

    // 识图：异步补描述（回复前最多等 4 秒），失败不影响聊天
    // 注意：QQ 的"表情包"是 image 段 + sub_type>0，不是 mface；按 sub_type 决定用哪个开关
    if ((ev.images || 0) > 0 && ev.imageUrls?.length) {
      const kinds = ev.imageUrls.map((_, i) => (Number(ev.imageSubTypes?.[i]) > 0 ? 'mface' : 'image'))
      const p = attachVision(entry, ev.imageUrls, kinds, cfgFor(r.roomId)).catch(() => {})
      r.visionPending = r.visionPending || new Set()
      r.visionPending.add(p)
      void p.finally(() => r.visionPending.delete(p))
    }

    // 视频：下载 + 抽帧 + 视觉模型看一眼（后台跑，回复前最多等 videoWaitMs）
    if (ev.videoUrls?.length) {
      const c0 = cfgFor(r.roomId)
      if (c0.videoOnMessage) {
        const p = (async () => {
          const v = await describeVideo(ev.videoUrls[0], c0)
          if (v?.files?.length) r.videoFiles = [...(r.videoFiles || []), ...v.files]
          if (v?.desc) {
            entry.text = String(entry.text || '').replace('[video]', '[视频：' + v.desc + ']')
            entry.video = v
            // 提炼成一条长期记忆：以后聊到"那个视频"能想起来
            rememberVideo(r, v, null)
          }
        })().catch(() => {})
        r.videoPending = r.videoPending || new Set()
        r.videoPending.add(p)
        void p.finally(() => r.videoPending.delete(p))
      }
    }
    // 亲密度：有人说话就涨一点（只对托管群持久化）
    getFeatures().bumpBond(r, ev.sender, 1)
    // 合并转发：把里面的聊天记录读出来
    if (ev.forwardId) {
      const fp = (async () => {
        try {
          const d = await ob.call('get_forward_msg', { id: ev.forwardId, message_id: ev.forwardId }, 10000)
          const list = d?.messages || d?.message || []
          const lines = []
          for (const m of list.slice(0, 30)) {
            const segs = Array.isArray(m?.message) ? m.message : []
            const txt = segs.filter((x) => x?.type === 'text').map((x) => x?.data?.text || '').join('')
            const who = String(m?.sender?.card || m?.sender?.nickname || m?.sender?.user_id || '')
            if (txt) lines.push((who ? who + ': ' : '') + txt.slice(0, 80))
          }
          if (lines.length) {
            entry.forward = lines.join('\n').slice(0, 1200)
            ev.forward = entry.forward // 待处理队列里是 ev
            entry.text = String(entry.text || '').replace('[聊天记录]', '[聊天记录：' + lines.length + ' 条]')
            log('读合并转发：' + lines.length + ' 条')
          }
        } catch (e) {
          log('读合并转发失败：' + String(e?.message || e))
        }
      })()
      // 与文档一样：回复前等它读完（最多 8 秒），否则第一句会"没看到"转发内容
      r.forwardPending = r.forwardPending || new Set()
      r.forwardPending.add(fp)
      void fp.finally(() => r.forwardPending.delete(fp))
    }
    // 文档：下载 + 取正文（后台跑，回复前最多等 8 秒）
    if (ev.files?.length) {
      const cf = cfgFor(r.roomId)
      if (cf.docOnFile) {
        const dp = (async () => {
          const f = ev.files[0]
          const maxBytes = Math.max(1, Number(cf.docMaxMB) || 20) * 1024 * 1024
          try {
            const res = await fetch(f.url, { signal: AbortSignal.timeout(30000) })
            if (!res.ok) throw new Error('HTTP ' + res.status)
            const buf = Buffer.from(await res.arrayBuffer())
            if (buf.length > maxBytes) throw new Error('文件过大 ' + Math.round(buf.length / 1024 / 1024) + 'MB')
            if (!existsSync(VIDEO_DIR)) mkdirSync(VIDEO_DIR, { recursive: true })
            const ext = String(f.name || '').split('.').pop().toLowerCase()
            const tmp = join(VIDEO_DIR, 'doc-' + Date.now() + '.' + (ext || 'bin'))
            writeFileSync(tmp, buf)
            const got = await extractDocText(tmp, ext, {
              py: resolveDocPython(),
              libDir: docLibDir,
              maxChars: Number(cf.docChars) || 3000,
            })
            try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
            if (got.ok && String(got.text || '').trim()) {
              entry.doc = { name: f.name || 'file', text: String(got.text).slice(0, Number(cf.docChars) || 3000) }
              ev.doc = entry.doc // 待处理队列里是 ev，不是 entry，两边都放一份
              entry.text = String(entry.text || '').replace('[file]', '[文件：' + (f.name || 'file') + ']')
              log('读文件：' + (f.name || 'file') + '｜' + entry.doc.text.length + ' 字')
            } else {
              log('读文件失败：' + (got.error || '没取到文字'))
            }
          } catch (e) {
            log('读文件失败：' + String(e?.message || e))
          }
        })().catch(() => {})
        r.docPending = r.docPending || new Set()
        r.docPending.add(dp)
        void dp.finally(() => r.docPending.delete(dp))
      }
    }
    // 情绪：被夸会得意、被说会蔫、深夜会困（纯规则，立刻生效）
    try { inferMood(r, entry.text) } catch { /* 心情推断失败不影响聊天 */ }
    r.pending.push(ev)
    scheduleFlush(r)
  }

  async function handleNotice(n) {
    const t = String(n?.notice_type || '')
    const sub = String(n?.sub_type || '')
    // 有人撤回消息：上下文里标一下，别拿撤回的内容当事实
    if (t === 'group_recall' || t === 'friend_recall') {
      const roomId = String(n?.group_id || n?.user_id || '')
      const mid = String(n?.message_id || '')
      if (roomId && mid) {
        const r = roomState(roomId)
        const m = r.msgs.find((x) => String(x.id) === mid)
        if (m) m.text = '[已撤回]'
        if (r.lastBotMsgId && String(r.lastBotMsgId) === mid) r.lastBotMsgId = ''
        log('有人撤回了消息 ' + mid + '（' + roomId + '）')
      }
      return
    }
    if (!(t === 'notify' && sub === 'poke')) return
    const selfId = String(ob.status.self?.user_id ?? '')
    const from = String(n?.user_id ?? '')
    const target = String(n?.target_id ?? n?.user_id ?? '')
    // 有些实现不带 target_id：记一次原始形状，方便以后适配
    if (!n?.target_id && from && from !== selfId && noticeShapes < 3) {
      noticeShapes += 1
      log('poke notice 没有 target_id：' + JSON.stringify(n).slice(0, 220))
    }
    const groupId = String(n?.group_id ?? '')
    const roomId = groupId || from
    if (!roomId) return
    const r = roomState(roomId)
    r.isGroup = !!groupId
    r.lastActivityAt = Date.now()
    if (from && from === selfId) return // 自己拍自己，忽略
    if (target && target !== selfId) return // 别人拍别人，不管

    let name = r.nameCache.get(from) || ''
    if (!name && groupId) {
      try {
        const m = await ob.groupMember(groupId, from)
        name = String(m?.card || m?.nickname || '')
      } catch {
        /* 拿不到就用 QQ 号 */
      }
    }
    name = name || from || '有人'
    if (from) r.nameCache.set(from, name)

    // 先判断"这个群/私聊现在该不该有动作"：停用、未授权、或该群关了拍一拍，都不动
    const c = cfgFor(r.roomId)
    const active = config.enabled && allowedHere(r) && c.pokeOnMe
    if (active) setMood(r, '被惹到', 1) // 被戳了，嘴硬一下
    if (active && c.pokeBack && Math.random() < Number(c.pokeChance)) {
      try {
        await ob.sendPoke({ groupId: groupId || undefined, userId: from })
        log(`被 ${name} 拍了拍 → 拍回去`)
      } catch (e) {
        log('拍回去失败：' + String(e?.message || e))
      }
    } else {
      log(`被 ${name} 拍了拍${active ? '' : '（当前不活跃，只记录）'}`)
    }

    if (!active) return
    // 防连拍刷屏：刚回过就先只拍不接话
    if (r.lastReplyAt && Date.now() - r.lastReplyAt < Number(c.minReplyGapMs)) return
    r.pending.push({
      id: '',
      roomId: r.roomId,
      isGroup: r.isGroup,
      sender: from,
      senderName: name,
      text: '（拍了拍你）',
      isAtMe: true,
      atAll: false,
      images: 0,
      imageUrls: [],
      ts: Date.now(),
    })
    scheduleFlush(r)
  }

  function priorityOf(msg, r) {
    const base = detectTrigger(
      { isAtMe: msg.isAtMe, atAll: msg.atAll, text: msg.text },
      { aliases: config.aliases, selfNames: [config.botName] },
    )
    if (base === 'at' || base === 'name') return base
    // 刚跟我聊过的人接着说 → 对话延续（真人不会聊到一半突然不理）
    if (
      r &&
      r.lastSender &&
      String(msg.sender) === r.lastSender &&
      r.lastReplyAt &&
      Date.now() - r.lastReplyAt < Number(config.conversationWindowMs)
    ) {
      return 'continuation'
    }
    return base
  }

  /** 判定用的文本归一（去标点/空白/表情），用于「同一句话不重复回」。 */
  function normText(s) {
    return String(s || '')
      .replace(/\[[^\]]{1,6}\]/g, '')
      .replace(/[\s\p{P}\p{S}]/gu, '')
      .toLowerCase()
      .slice(0, 80)
  }

  function decide(r, { priority, quiet, now, text, force }) {
    const c = cfgFor(r.roomId)
    // 管理员遥控的静音优先于一切（包括必回）
    if (r.isGroup && r.muteUntil && now < r.muteUntil) {
      return { reply: false, reason: `管理员静音中（还剩 ${Math.ceil((r.muteUntil - now) / 60000)} 分钟）`, priority }
    }
    // 管理员私聊 / 该群必回：不看概率、不看安静时段、不复读检测
    if (force) return { reply: true, reason: '强制回复（管理员/必回群）', priority }
    if (quiet && !(priority === 'at' && c.quietAllowAt)) {
      return { reply: false, reason: '安静时段', priority }
    }
    // 同一句话刚回过就别复读（只对"长句"生效：真人本来就会反复说"嗯""行吧"）
    const norm = normText(text)
    const win = Number(c.repeatWindowMs) || 0
    if (norm && win > 0 && norm.length >= 6) {
      const hit = (r.repliedTexts || []).find((x) => x.norm === norm && now - x.at < win)
      if (hit) return { reply: false, reason: '刚回过这句（防重复）', priority }
    }
    const last10 = r.replyTimes.filter((t) => now - t < 600000).length
    if (last10 >= Number(c.maxRepliesPer10Min)) {
      return { reply: false, reason: `10 分钟上限 ${last10}`, priority }
    }
    const gap = now - r.lastReplyAt
    const minGap = Number(c.minReplyGapMs) || 0
    if (priority !== 'at' && r.lastReplyAt && gap < minGap) {
      return { reply: false, reason: `冷却中（还差 ${Math.ceil((minGap - gap) / 1000)}s）`, priority }
    }
    const p =
      priority === 'at'
        ? Number(c.atChance)
        : priority === 'name'
          ? Number(c.nameChance)
          : priority === 'continuation'
            ? Number(c.continuationChance)
            : priority === 'question'
              ? Number(c.questionChance)
              : Number(c.replyProbability)
    const roll = Math.random()
    if (roll >= p) return { reply: false, reason: `概率未中（${priority} ${Math.round(p * 100)}%）`, priority }
    return { reply: true, reason: `${priority} 命中`, priority }
  }

  // ── 情绪状态（拟人用，纯规则，不花 token）──────────────────
  // 每种心情带一个"说话长度倾向"和一句给模型的状态描述
  const MOODS = {
    困: { len: 1, desc: '你有点困，反应慢半拍，话很少，懒得展开' },
    馋: { len: 2, desc: '你有点馋，注意力容易飘到吃的上面' },
    得意: { len: 2, desc: '你刚被夸了，有点得意，尾巴翘着' },
    委屈: { len: 1, desc: '你被说了，有点蔫，话短，不太想解释' },
    被惹到: { len: 1, desc: '你刚被逗/被拍，嘴硬，但没真生气' },
    开心: { len: 2, desc: '你心情不错，愿意多搭两句' },
    平静: { len: 2, desc: '你心情平平，正常说话' },
  }
  const MOOD_TTL_MS = 40 * 60 * 1000 // 40 分钟没被重新触发就淡掉

  function moodName(r) {
    const m = r && r.mood
    if (!m || !m.name) return ''
    if (Date.now() - (m.at || 0) > MOOD_TTL_MS) return ''
    return m.name
  }
  function setMood(r, name, intensity = 1) {
    if (!r || !name || !MOODS[name]) return
    r.mood = { name, at: Date.now(), intensity }
  }
  /** 从一句话里推断心情：先看内容，再看时间（深夜容易困） */
  function inferMood(r, text) {
    if (!cfgFor(r.roomId).moodEnabled) return
    const t = String(text || '')
    if (!t) return
    if (/滚|闭嘴|烦人|讨厌|笨|傻|蠢|废物/.test(t)) return setMood(r, '委屈', 2)
    if (/可爱|乖|好棒|真棒|喜欢你|爱你|厉害|聪明/.test(t)) return setMood(r, '得意', 2)
    if (/拍(拍)?|戳|捏/.test(t)) return setMood(r, '被惹到', 1)
    if (/饿|吃|白饭|饭|好吃|夜宵|奶茶/.test(t)) return setMood(r, '馋', 1)
    const h = new Date().getHours()
    if (h >= 1 && h < 5) return setMood(r, '困', 2)
    if (/哈哈|笑死|开心|好耶/.test(t)) return setMood(r, '开心', 1)
    if (moodName(r)) setMood(r, '平静', 1)
  }

  /**
   * 这次回复说几句：70% 一句、25% 两句、5% 三句（再受群配置 maxLines 和心情约束）。
   * 这是"别每条都三句"的关键。
   */
  function pickLineTarget(c, mood) {
    const cap = Math.max(1, Number(c.maxLines) || 3)
    if (!c.lengthSpread) return cap
    const roll = Math.random()
    let n = roll < 0.7 ? 1 : roll < 0.95 ? 2 : 3
    n = Math.min(n, cap)
    const m = MOODS[mood]
    if (m && m.len === 1) n = Math.random() < 0.8 ? 1 : Math.min(2, cap)
    return Math.max(1, n)
  }

  /** 把最近 N 条拼成一段群聊记录（给模型看的"上下文"）。 */
  function buildTranscript(r, limit) {
    const lines = []
    for (const m of r.msgs.slice(-Math.max(4, limit))) {
      // 时间戳在入库时就算好（hhmm），这里不再每条都 new Date + 补零
      let hhmm = m.hhmm
      if (!hhmm) {
        const t = new Date(m.ts)
        hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0')
        m.hhmm = hhmm
      }
      const who = m.isSelf ? '我' : m.senderName
      // 识图描述很长：历史里只留 [图片]/[表情] 标记，否则整段记录会被撑到 4000+ token
      let text = String(m.text || '').replace(/\[(图片|表情)：[^\]]*\]/g, '[$1]')
      if (text.length > 80) text = text.slice(0, 80) + '…'
      lines.push(`${hhmm} ${who}: ${text}`)
    }
    return lines.join('\n')
  }

  function systemPrompt(r) {
    const c = cfgFor(r.roomId)
    const now = new Date()
    const wd = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()]
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const where = r.isGroup ? `QQ 群「${r.roomName || r.roomId}」` : 'QQ 私聊'
    const f = pickFacts(r, Number(c.factsLimit) || 8)
    // 托管会话（大肥鱼群 / 管理员私聊）额外带上画像与摘要
    let memProfile = ''
    let memSummary = ''
    let memRelations = ''
    if (isManagedRoom(r.roomId)) {
      const dir = memDirOf(r.roomId)
      if (dir) {
        const t = roomTextOf(dir)
        memProfile = String(t.profile || '').slice(0, 900)
        memSummary = String(t.summary || '').slice(0, 600)
        memRelations = String(t.relations || '').slice(0, 800)
      }
    }
    return [
      c.persona,
      '',
      `当前：${where}｜${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 星期${wd} ${hh}:${mm}。`,
      c.masterName ? `群里的「${c.masterName}」是你最熟的人，可以更随便一点。` : '',
      (() => {
        const m = c.moodEnabled ? moodName(r) : ''
        return m && MOODS[m] ? `你现在的状态：${MOODS[m].desc}。` : ''
      })(),
      memProfile ? '你整理过这里的画像（谁是谁、性格、禁忌）：\n' + memProfile : '',
      memSummary ? '之前聊过的事（摘要）：\n' + memSummary : '',
      memRelations ? '你了解的这里的人际关系：\n' + memRelations : '',
      getFeatures().bondLine(r),
      (() => {
        if (!isManagedRoom(r.roomId)) return ''
        const dir = memDirOf(r.roomId)
        if (!dir) return ''
        const t = roomTextOf(dir)
        return [t.self ? '你对自己的认识：\n' + String(t.self).slice(0, 300) : '', t.diary ? '你最近写的日记：\n' + String(t.diary).slice(-400) : '']
          .filter(Boolean)
          .join('\n')
      })(),
      f.length ? '你记得关于这个群的事：\n' + f.map((x) => '- ' + x.text).join('\n') : '',
      '规则：',
      '- 只输出你要发到群里的话本身，不要旁白、不要解释、不要用引号包起来。',
      `- 像真人打字：这次最多说 ${r.lineTarget || c.maxLines} 句，总长不超过 ${r.replyCharsCap || c.maxReplyChars} 字；不用 markdown、不列清单。`,
      '- 不要用「咕/唔/嗷/呜」这类拟声词开头；一整条回复里最多出现一次，没必要时就不要用。',
      '- 不要 @ 所有人；不要提自己是 AI 或模型。',
      '- 上下文里「我」指你，「昵称: 内容」是群友发言。',
      '- 没话可说时就回一句短的（一句完整的话，别只甩一个「嗯」），不要强行展开。',
    ].filter(Boolean).join('\n')
  }

  function resolveModel() {
    let provider = String(config.provider || '')
    let model = String(config.model || '')
    if (!provider || !model) {
      try {
        const sel = ctx.get?.('agentDefaultModel')?.currentSelection?.()
        provider = provider || String(sel?.provider || '')
        model = model || String(sel?.model || '')
      } catch {
        /* ignore */
      }
    }
    if (!provider || !model) throw new Error('没有可用的模型路由（config.provider/model 为空，且读不到 agent 默认模型）')
    return { provider, model }
  }

  /** 一次流式调用。返回 { text, firstTokenMs, totalMs, usage }。 */
  async function generate({ system, user, maxTokens, temperature, reasoningEffort, onDelta }) {
    const { provider, model } = resolveModel()
    const ac = new AbortController()
    const killer = track(setTimeout(() => ac.abort(new Error('模型超时')), 90000))
    const t0 = Date.now()
    let firstTokenMs = 0
    let text = ''
    let usage = null
    let finish = null
    try {
      stats.llmCalls += 1
      const stream = ctx.llm.stream({
        provider,
        model,
        messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: user }] })],
        system,
        temperature: Number(temperature ?? config.temperature),
        maxTokens: Number(maxTokens ?? config.maxTokens),
        ...((reasoningEffort ?? config.reasoningEffort)
          ? { reasoningEffort: reasoningEffort ?? config.reasoningEffort }
          : {}),
        signal: ac.signal,
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') {
          if (!firstTokenMs) firstTokenMs = Date.now() - t0
          text += chunk.text
          if (onDelta) {
            try {
              onDelta(text)
            } catch {
              /* 回调里的错误不能影响生成 */
            }
          }
        } else if (chunk.type === 'usage') {
          usage = chunk.usage
        } else if (chunk.type === 'finish') {
          finish = chunk.reason
        } else if (chunk.type === 'block-end' && !text && chunk.block?.type === 'text') {
          text = chunk.block.text || ''
        }
      }
    } catch (e) {
      stats.llmErrors += 1
      stats.lastError = String(e?.message || e)
      throw e
    } finally {
      untrack(killer)
    }
    noteUsage(usage)
    // 模型侧失败（如 provider 不可用 / 鉴权过期）通常 finish.kind = 'error' 且没有文本：
    // 以前这种情况只留下一条空的"回复"日志，很难查；这里显式记一条原因。
    if (!String(text || '').trim() && finish && finish.kind !== 'stop') {
      const f = finish.failure || {}
      stats.llmErrors += 1
      const msg = '生成失败：' + String(finish.kind || '?') + (f.message ? ' - ' + String(f.message).slice(0, 120) : '')
      stats.lastError = msg
      log(msg + '（' + provider + '/' + model + '）')
    }
    return { text, firstTokenMs, totalMs: Date.now() - t0, usage, finish }
  }

  /** 启动后把还没本地化的图库条目刷一遍：能下就存，过期就标记作废。 */
  async function sweepStickerLibrary() {
    // 顺手清掉失效超过 7 天的条目，别让图库永远挂着死链
    let pruned = 0
    for (const k of Object.keys(stickers)) {
      const s = stickers[k]
      if (s.bad && s.badAt && Date.now() - s.badAt > 7 * 86400000) {
        delete stickers[k]
        pruned += 1
      }
    }
    const ids = Object.keys(stickers).filter(
      (k) =>
        !stickers[k].bad &&
        !stickers[k].emojiId && // 已收进收藏的，不依赖 URL，别再扫
        stickers[k].url &&
        !(stickers[k].file && existsSync(stickers[k].file)),
    )
    let ok = 0
    let bad = 0
    for (const id of ids) {
      try {
        await ensureStickerFile(stickers[id], id)
        ok += 1
      } catch {
        stickers[id].bad = true
        stickers[id].badAt = Date.now()
        bad += 1
      }
      await sleep(120)
    }
    // 有本地文件但还没进收藏的表情，顺手补进收藏（之后发出去才是气泡）
    let favored = 0
    for (const id of Object.keys(stickers)) {
      const s = stickers[id]
      if (s.bad || s.emojiId || !s.file || !existsSync(s.file)) continue
      if (Number(s.subType) < 1) continue
      const before = s.emojiId
      await favoriteSticker(s, '', id)
      if (!before && s.emojiId) favored += 1
      await sleep(150)
    }
    markStickersDirty()
    log(
      `图库本地化完成：可用 ${ok} 张，标记失效 ${bad} 张${favored ? `，补进收藏 ${favored} 张` : ''}${pruned ? `，清理旧失效 ${pruned} 张` : ''}`,
    )
  }

  /**
   * 把收到的表情加进账号的收藏表情（服务端持久化）。
   * 这是"存得住"的关键：QQ 的图片 URL 几小时就过期，收藏表情不会。
   */
  async function favoriteSticker(s, url, id) {
    if (!config.stickerFavorite) return
    if (!s || s.emojiId) return
    const max = Math.max(0, Number(config.stickerFavoriteMax) || 60)
    if (max && Object.keys(stickers).length > max) return
    const save = (eid) => {
      s.emojiId = String(eid)
      s.favoriteAt = Date.now()
      markStickersDirty()
      log(`表情已收进 QQ 收藏：${String(eid).slice(0, 28)}…`)
    }
    try {
      const res = await ob.call('add_custom_face', { file: url }, 25000)
      // ob.call 已经把 data 解包了；两种形状都兼容
      const eid = res?.emoji_id || res?.data?.emoji_id
      if (eid) return save(eid)
    } catch {
      /* URL 加不进去就转 base64 再试 */
    }
    try {
      const file = await ensureStickerFile(s, id)
      const b64 = readFileSync(file).toString('base64')
      const res2 = await ob.call('add_custom_face', { file: 'base64://' + b64 }, 25000)
      const eid2 = res2?.emoji_id || res2?.data?.emoji_id
      if (eid2) return save(eid2)
      log('收进收藏失败：接口没返回 emoji_id')
    } catch (e) {
      log('收进收藏失败：' + String(e?.message || e).slice(0, 120))
    }
  }

  /**
   * 发一张图库表情：① 收藏表情（原生气泡）→ ② 本地文件 → ③ 原 URL。
   * 不做"失败再换一种方式重试"——QQ 的失败可能是"其实已送达但回报失败"，重试会发两遍。
   */
  async function sendStickerTo(roomId, s, id) {
    // ① 收藏表情：QQ 原生表情气泡，且不依赖会过期的 URL
    if (s.emojiId && config.stickerFavorite) {
      try {
        await ob.call('send_custom_face', { group_id: roomId, emoji_id: s.emojiId }, 25000)
        s.uses = (s.uses || 0) + 1
        s.at = Date.now()
        stats.stickersSent += 1
        roomState(roomId).lastStickerAt = Date.now()
        markStickersDirty()
        return { ok: true, via: 'favorite' }
      } catch (e) {
        const msg = String(e?.message || e)
        // 收藏被删/无效 → 清掉标记，走图片兜底
        if (/emoji|face|not.?found|不存在|400|invalid/i.test(msg)) {
          delete s.emojiId
          markStickersDirty()
        }
      }
    }
    // 兜底用 image 段：sub_type 统一用 1（其它变体号某些客户端不认），并带 summary
    const st = 1
    if (!s.url && !s.file) return { ok: false, error: '这张既没有收藏也没有本地文件，发不了' }
    let file = ''
    try {
      file = await ensureStickerFile(s, id)
    } catch {
      /* 下载不下来就用原 URL（多半也过期了） */
    }
    // summary 也要带上，客户端才会按"表情"渲染
    const seg = file
      ? { type: 'image', data: { file: 'file:///' + file.replace(/\\/g, '/'), sub_type: st, summary: '[动画表情]' } }
      : { type: 'image', data: { file: s.url, sub_type: st, summary: '[动画表情]' } }
    try {
      const res = await sendWithRetry(roomId, true, 'segments', [seg])
      if (res.queued) return { ok: true, queued: true, error: res.error }
      s.uses = (s.uses || 0) + 1
      s.at = Date.now()
      stats.stickersSent += 1
      roomState(roomId).lastStickerAt = Date.now()
      markStickersDirty()
      return { ok: true, via: file ? 'file' : 'url' }
    } catch (e) {
      const msg = String(e?.message || e)
      // 只有"用过期 URL 且明确下载失败"才标记作废（本地文件失败不算 URL 的错）
      if (!file && /download failed|retcode 100|HTTP 400|失效|过期/i.test(msg)) {
        s.bad = true
        s.badAt = Date.now()
        markStickersDirty()
        return { ok: false, bad: true, error: '这张已失效（QQ 图片链接过期，且本地没有缓存），已从轮换里移除' }
      }
      return { ok: false, error: msg }
    }
  }

  /**
   * 文字之后偶尔补一张群里的图。一次回复最多一张，受冷却约束。
   * 抽出来单独用，是因为流式首段会把整段说完（没有尾段），那时候也要有机会补图。
   */
  async function maybeSendSticker(r, c) {
    if (!r.isGroup) return false
    const cool = Math.max(0, Number(c.stickerCooldownMs) || 0)
    if (Date.now() - (r.lastStickerAt || 0) < cool) return false
    if (Math.random() >= Number(c.stickerChance)) return false
    const keys = Object.keys(stickers).filter((k) => !stickers[k].bad)
    if (!keys.length) return false
    const key = keys[Math.floor(Math.random() * keys.length)]
    const s = stickers[key]
    if (!(s?.url || s?.emojiId || s?.file)) return false
    await sleep(gapMs() * Math.max(0, Math.min(3, Number(c.delayScale ?? 1))))
    const stRes = await sendStickerTo(r.roomId, s, key)
    if (!stRes.ok) log(stRes.bad ? `图库条目失效已停用：${key}` : `补图失败：${stRes.error}`)
    return !!stRes.ok
  }

  /** 发送（分条 + 拟人延迟 + 可选 @ + 可选补图）。所有路径都过白名单闸。 */
  async function sendReply(r, { text, quoteTo, priority, atUser, noSticker }) {
    const c = cfgFor(r.roomId)
    if (r.isGroup) assertGroupAllowed(r.roomId)
    else if (!config.allowPrivate.includes(String(r.roomId)) && !config.adminQQ.includes(String(r.roomId))) {
      throw new Error(`私聊 ${r.roomId} 不在白名单（当前：${config.allowPrivate.join(', ') || '空'}；管理员：${config.adminQQ.join(', ') || '空'}）`)
    }
    // 这次说几句：优先用本次回复的目标句数（长度浮动），否则回落到群配置
    const lineCap = Math.max(1, Math.min(4, Number(r.lineTarget) || Number(c.maxLines) || 3))
    const charCap = Number(r.replyCharsCap) || Number(c.maxReplyChars) || 300
    const clean = cleanReply(text, { maxLen: charCap, maxLines: lineCap })
    if (!clean) return []
    const parts = splitMessage(clean, {
      chance: Number(c.splitChance) || 0,
      maxParts: lineCap,
    })
    if (config.dryRun) {
      log(`[演练] ${r.roomName || r.roomId} → ${parts.join(' / ')}`)
      return parts
    }
    const sent = []
    const scale = Math.max(0, Math.min(3, Number(c.delayScale ?? 1)))
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      // 第一条立刻发（首句要快）；只有分条之间才有拟人停顿，约 0.2~1.1 秒
      if (i > 0 && scale > 0) {
        const gap = Math.min(2500, (220 + Math.random() * 480 + Math.min(400, [...part].length * 12)) * scale)
        if (gap > 0) await sleep(gap)
      }
      // 偶尔真 @ 一下对方（被 @ 时更自然）；私聊没有 @ 段
      const useAt =
        r.isGroup && i === 0 && atUser && c.allowAt && Math.random() < Number(c.atMentionChance)
      try {
        let res = null
        if (!r.isGroup) res = await ob.sendPrivate(r.roomId, part)
        else if (i === 0 && quoteTo) res = await ob.sendGroupReply(r.roomId, quoteTo, part)
        else if (useAt)
          res = await ob.sendGroupSegments(r.roomId, [
            { type: 'at', data: { qq: String(atUser) } },
            { type: 'text', data: { text: ' ' + part } },
          ])
        else res = await ob.sendGroup(r.roomId, part)
        const mid = res?.message_id ?? res?.data?.message_id
        if (mid) r.lastBotMsgId = String(mid)
        sent.push(part)
      } catch (e) {
        stats.lastError = String(e?.message || e)
        log('发送失败：' + stats.lastError)
        // 网络类失败：把这条和剩下没发的都排进重试队列
        if (shouldRetrySend(stats.lastError)) {
          for (const rest of parts.slice(i)) {
            enqueueSend({
              roomId: r.roomId,
              isGroup: r.isGroup,
              kind: r.isGroup ? 'text' : 'private',
              payload: rest,
              error: stats.lastError,
            })
          }
        }
        break
      }
      if (i < parts.length - 1) await sleep(gapMs() * scale)
    }
    // 回完顺手拍一下对方（真人聊得热络时会这样）
    if (sent.length && atUser && c.pokeOnReply && Math.random() < Number(c.pokeOnReply)) {
      try {
        await ob.sendPoke({ groupId: r.isGroup ? r.roomId : undefined, userId: atUser })
      } catch {
        /* 拍不动就算了，不影响回复 */
      }
    }
    // 文字之后偶尔补一张群里的图（图库是收消息时攒的；私聊不发图，避免打扰）；一次回复最多一张
    if (!noSticker && sent.length) await maybeSendSticker(r, c)
    stats.sends += sent.length
    r.lastReplyAt = Date.now()
    r.replyTimes.push(Date.now())
    r.replyTimes = r.replyTimes.filter((t) => Date.now() - t < 3600000)
    if (clean) {
      r.repliedTexts = (r.repliedTexts || []).filter((x) => Date.now() - x.at < 3600000)
      r.repliedTexts.push({ norm: normText(clean), at: Date.now() })
    }
    // 一条都没发出去就不算「回复过」（否则面板会显示假成功）
    if (sent.length) {
      stats.replies += 1
      stats.lastAt = Date.now()
    }
    return sent
  }

  // 「提往事」才去翻历史：没这几个词就不查，省一次请求
  const HISTORY_HINT = /(上次|之前|那天|昨天|前天|早说|说过|提过|记得|还记得|历史|上回)/
  // 提到"记得/上次"时，托管会话会先翻自己的长期记忆（facts + 归档 + 摘要 + 关系）
  const RECALL_HINT = /(记得|还记得|上次|上回|之前|以前|那次|说过|提过|我们聊过)/
  // 中文没有空格，整段当一个词会永远搜不到；切成 2 字窗口再匹配。
  const HIST_STOP = new Set(['的', '了', '是', '我', '你', '他', '她', '它', '吗', '呢', '吧', '啊', '这', '那', '个', '就', '也', '都', '和', '在'])
  function keywordsOf(text) {
    const tokens = String(text || '')
      .replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
    const out = []
    for (const t of tokens) {
      if (/^[0-9A-Za-z]+$/.test(t)) {
        if (t.length >= 2) out.push(t)
        continue
      }
      if (t.length <= 2) {
        if (!HIST_STOP.has(t)) out.push(t)
        continue
      }
      for (let i = 0; i + 2 <= t.length; i++) {
        const w = t.slice(i, i + 2)
        if (!HIST_STOP.has(w)) out.push(w)
      }
    }
    return [...new Set(out)].slice(0, 8)
  }

  async function searchHistory(roomId, text, limit) {
    const kws = keywordsOf(text)
    if (!kws.length) return []
    try {
      const data = await ob.call('get_group_msg_history', { group_id: roomId, count: 80 }, 8000)
      const hits = []
      for (const m of data?.messages || []) {
        const ev = normalizeEvent(m, ob.status.self?.user_id)
        if (!ev.text) continue
        if (!kws.some((k) => ev.text.includes(k))) continue
        hits.push(`${new Date(ev.ts).toLocaleString('zh-CN', { hour12: false })} ${ev.senderName}: ${ev.text}`)
      }
      return hits.slice(-Math.max(1, limit))
    } catch {
      return []
    }
  }

  async function flush(r) {
    const batch = r.pending.splice(0)
    if (!batch.length) return
    // 有人发了图：给视觉模型最多 4 秒，让它进上下文
    if (r.visionPending?.size) {
      await Promise.race([Promise.allSettled([...r.visionPending]), sleep(4000)])
    }
    if (r.forwardPending?.size) {
      await Promise.race([Promise.allSettled([...r.forwardPending]), sleep(8000)])
    }
    if (r.docPending?.size) {
      await Promise.race([Promise.allSettled([...r.docPending]), sleep(8000)])
    }
    if (r.videoPending?.size) {
      // 只有"这条消息像是在说视频"才等它看完；否则先回复，描述稍后会进上下文
      const lastText = String(batch[batch.length - 1]?.text || '')
      const bare = !lastText.replace(/\[video\]/g, '').trim()
      const aboutVideo = bare || /(视频|这个|那个|看看|看一下|看下|发的|里面的|内容)/.test(lastText)
      if (aboutVideo) {
        const waitMs = Number(cfgFor(r.roomId).videoWaitMs) || 8000
        await Promise.race([Promise.allSettled([...r.videoPending]), sleep(waitMs)])
      } else {
        log('视频后台处理中，这条消息不像在问视频，先回复')
      }
    }
    const trigger = batch[batch.length - 1]
    // 管理员私聊遥控：先过指令流程（含"确认/取消"），被消费掉就不再走正常回复
    if (!r.isGroup && config.adminCommands) {
      const handled = await handleAdminCommand(r, trigger)
      if (handled) {
        stats.adminCmds = (stats.adminCmds || 0) + 1
        r.lastSender = String(trigger.sender)
        return
      }
    }
    const c = cfgFor(r.roomId)
    // 玩法类消息先处理：小游戏 / 定时提醒 / 撤回（都不走模型，也不看概率）
    try {
      const gate = getFeatures().extrasGate(r, c)
      if (await getFeatures().tryPoll(r, trigger, c, gate)) return
      if (await getFeatures().tryGame(r, trigger, c, gate)) return
      if (await getFeatures().tryReminder(r, trigger, c, gate)) return
      if (await getFeatures().tryRecall(r, trigger, c)) return
    } catch (e) {
      log('玩法处理失败：' + String(e?.message || e))
    }
    let priority = priorityOf(trigger, r)
    // 明确让它"去搜一下"：当成 @ 处理，别被概率/冷却挡掉
    const askedSearch = c.webSearch ? extractSearchQuery(trigger.text) : ''
    if (askedSearch) priority = 'at'
    const quiet = isQuiet(quietWindowsFor(c.quietHours))
    const now = Date.now()
    const force = mustReply(r, trigger.sender)
    const d = decide(r, { priority, quiet, now, text: trigger.text, force })
    r.lastDecision = { ...d, at: now, text: trigger.text, askedSearch, force }
    if (!d.reply) {
      stats.skipped += 1
      return
    }

    // 敷衍短路只留给"群里随口闲聊"：@ / 提问 / 叫名字 / 接话 都要认真回
    if (!askedSearch && !force && priority === 'ambient' && Math.random() < Number(c.cannedChance)) {
      const short = pickCanned(priority)
      if (short) {
        stats.canned += 1
        const sent = await sendReply(r, { text: short, priority, atUser: trigger.sender })
        r.lastSender = String(trigger.sender)
        log(`敷衍 ${r.roomName || r.roomId}｜${priority}｜${sent.join(' / ')}`)
        return
      }
    }

    const transcript = buildTranscript(r, Number(c.contextMessages) || 20)
    let hist = []
    if (c.historyLookup && HISTORY_HINT.test(trigger.text)) {
      hist = await searchHistory(r.roomId, trigger.text, Number(c.historyLimit) || 5)
    }
    // 用户明确让它查（"你去搜一下…"）→ 先联网，再让它用自己的口气说
    const searchHit = await buildSearchNote(r, trigger.text, c)
    const searchBlock = searchHit?.text
      ? `\n【联网搜索结果（${searchHit.query}）】\n${searchHit.text}\n（用你平时说话的口气转述，别念来源、别列条目、别说"根据搜索"；至少说出 1~2 个具体信息——名字/数字/时间/地点，别只说"有消息说"；结果里没有相关内容的就说没查到。）`
      : searchHit?.error
        ? '\n（刚才想联网但没连上；别装作查到了，不确定就直说。）'
        : searchHit?.skipped
          ? `\n（这次没联网：${searchHit.skipped}；不知道就直说，别编。）`
          : ''
    // 托管会话：问到"记得/上次"时，先从长期记忆里翻一翻（含归档）
    let recall = []
    if (isManagedRoom(r.roomId) && RECALL_HINT.test(String(trigger.text || ''))) {
      recall = searchMemory(r.roomId, trigger.text, 3)
    }
    // 消息里有视频链接：抓一次标题/字幕（最多等 timeout，抓不到就略过）
    let linkBlock = ''
    if (c.linkVideo && pickVideoLinks(trigger.text, 1).length) {
      const got = await Promise.race([
        buildVideoLinkNote(trigger.text, c).catch(() => null),
        sleep(Math.min(20000, Number(c.linkVideoTimeoutMs) || 15000)).then(() => null),
      ])
      if (got?.note) {
        linkBlock = got.note
        if (got.info) rememberVideo(r, { desc: got.info.description || '', duration: got.info.duration }, got.info)
      }
    }
    // 普通网页链接：抓标题和正文，别让它瞎猜
    if (!linkBlock && c.linkSummary && pickWebLink(trigger.text, 1).length) {
      linkBlock = await Promise.race([
        buildWebLinkNote(trigger.text, c).catch(() => ''),
        sleep(9000).then(() => ''),
      ])
    }
    // 这条消息带了文件：把解析出来的正文塞进去
    const docMsg = [...batch].reverse().find((m) => m.doc)
    const fwdMsg = [...batch].reverse().find((m) => m.forward)
    const fwdBlock = fwdMsg ? '\n【群友转发的聊天记录】\n' + String(fwdMsg.forward).slice(0, 1200) + '\n（用平时口气说一句里面在聊什么。）' : ''
    const docBlock = docMsg
      ? `\n【群友发来的文件：${docMsg.doc.name}】\n${String(docMsg.doc.text || '').slice(0, Number(c.docChars) || 3000)}\n（用平时口气说一句这文件讲了什么，别念目录、别复述全文。）`
      : ''
    const user = [
      docBlock,
      fwdBlock,
      r.isGroup ? `群「${r.roomName || r.roomId}」最近的聊天：` : '最近的私聊：',
      transcript,
      hist.length ? '\n你翻到的相关历史：\n' + hist.join('\n') : '',
      recall.length ? '\n你可能想说的是这些旧记忆：\n' + recall.map((x) => `- [${x.kind}] ${x.text}`).join('\n') : '',
      searchBlock,
      linkBlock,
      '',
      `现在 ${trigger.senderName} 刚说：「${trigger.text}」`,
      priority === 'at' ? '有人 @ 了你，回一句。' : '如果这句话值得接，就像群友那样自然地接一句；不值得接就回得很短。',
    ]
      .filter((x) => x !== '')
      .join('\n')

    try {
      const t0 = Date.now()
      // 流式发送（可选）：生成到第一个句末就先把这半句发出去，剩下的生成完再补
      let headSent = ''
      let headFailed = false
      let headPromise = null
      // 到这里才确定真的要回：算这次说几句（长度浮动 + 心情），提示词和分条都用它
      r.lineTarget = pickLineTarget(c, c.moodEnabled ? moodName(r) : '')
      const baseChars = Number(c.maxReplyChars) || 300
      r.replyCharsCap = r.lineTarget >= 2 ? baseChars : Math.max(40, Math.min(baseChars, 70))
      let out = await generate({
        system: systemPrompt(r),
        user,
        onDelta: c.streamSend
          ? (full) => {
              if (headSent) return
              // 只在句末标点处切首段：在逗号处切开会把一句话劈成两条气泡，像"发到一半断了"
              let cut = -1
              const m = /[。！？!?\n]/.exec(full)
              if (m) cut = m.index + 1
              else if (full.length >= 60) {
                // 一直等不到句末标点：攒到 60 字，才在最后一个逗号处切，且尾段不能太短
                const c2 = full.lastIndexOf('，')
                if (c2 >= 20 && full.length - c2 >= 12) cut = c2 + 1
              }
              if (cut < 0) return
              let head = full.slice(0, cut).trim().replace(/[，,、]$/, '')
              if (c.humanize) head = humanizeText(head, { dropPeriod: 0 })
              if (head.length < 2) return
              headSent = head
              headPromise = sendReply(r, {
                text: head,
                quoteTo: priority === 'at' || trigger.replyId ? trigger.id : '',
                priority,
                atUser: trigger.sender,
                noSticker: true, // 首段不带表情包，等最后一段发完再补一张
              })
                .then(() => {
                  stats.streamHeads = (stats.streamHeads || 0) + 1
                })
                .catch((e) => {
                  // 首段没发出去：把 headSent 撤回，最后一段会把完整内容重发一次，避免丢半句
                  headFailed = true
                  log('流式首段发送失败：' + String(e?.message || e))
                })
            }
          : undefined,
      })
      let replyText = out.text
      // 等首段真正发完再决定要不要重发，否则失败可能发生在剥离之后
      if (headPromise) await headPromise.catch(() => {})
      if (headSent && !headFailed) {
        const idx = replyText.indexOf(headSent)
        replyText = idx >= 0 ? replyText.slice(idx + headSent.length) : replyText
        // 首段在逗号处切开时，余下这句会以逗号开头（" ，我尾鳍都拍累了。"），去掉
        replyText = replyText.replace(/^[，,、。！？!?；;：:\s]+/, '')
      } else if (headFailed) {
        headSent = '' // 首段没发成功：整段重发
      }
      // 模型自己申请联网：回复里带 [搜索:关键词]（已经流式发过首段就不再改口）
      if (c.searchDirective && !headSent) {
        const m = /\[\s*搜索\s*[:：]\s*([^\]\n]{1,60})\s*\]/.exec(replyText)
        if (m) {
          const q = m[1].trim()
          log(`模型申请联网：${q}`)
          replyText = replyText.replace(m[0], '').trim()
          const hit2 = await buildSearchNote(r, '搜一下 ' + q)
          if (hit2?.text) {
            const out2 = await generate({
              system: systemPrompt(r),
              user: user + `\n\n【联网搜索结果（${q}）】\n${hit2.text}\n（用平时口气转述，别念来源、别列条目；至少说出 1~2 个具体信息。）`,
            })
            if (out2.text) {
              replyText = out2.text
              out = out2
            }
          }
        }
      }
      stats.lastFirstTokenMs = out.firstTokenMs
      stats.lastLatencyMs = Date.now() - t0
      // 去 AI 味后处理（只改语气，不改事实）；首段已经在流式时发出去了，这里只处理尾段
      if (c.humanize) {
        replyText = humanizeText(replyText, { dropPeriod: Number(c.humanizeDropPeriod) || 0 })
      }
      const quote = priority === 'at' || trigger.replyId ? trigger.id : ''
      let sent = []
      if (String(replyText || '').trim()) {
        // 首段已经引用过原消息了，尾段不要再引用一次（否则像发了两遍）
        sent = await sendReply(r, { text: replyText, quoteTo: headSent ? '' : quote, priority, atUser: trigger.sender })
      }
      // 流式首段把整段说完了（没有尾段）：补图的机会留在这里，否则短回复永远不配图
      if (!sent.length && headSent) await maybeSendSticker(r, c)
      r.lastSender = String(trigger.sender)
      if (sent.length || headSent) recordReplied(r.roomId, trigger.id)
      if (sent.length || headSent) maybeAutoExtract(r)
      log(
        `回复 ${r.roomName || r.roomId}｜${priority}｜首字 ${out.firstTokenMs}ms 总 ${Date.now() - t0}ms` +
          (out.usage ? `｜token ${out.usage.inputTokens ?? '?'}/${out.usage.outputTokens ?? '?'}` : '') +
          (hist.length ? `｜历史 ${hist.length} 条` : '') +
          (searchHit?.count ? `｜联网 ${searchHit.count} 条` : '') +
          (headSent ? '｜流式首段' : '') +
          `｜${(sent.length ? sent : [headSent]).join(' / ')}`,
      )
    } catch (e) {
      log('生成失败：' + String(e?.message || e))
    } finally {
      // 一次回复结束就清掉，别让下一次继承上一次的句数/字数
      r.lineTarget = 0
      r.replyCharsCap = 0
      // 曲线：记一格（当天心情 + 亲密度）
      getFeatures().recordCurve(r)
      // 亲密度：回复完顺手落盘
      if (r.bondDirty) getFeatures().saveBond(r)
      // 视频临时文件：回复发完才删（用户要求：看完 → 回复完 → 再删）
      if (r.videoFiles?.length) {
        for (const f of r.videoFiles) {
          try { rmSync(f, { force: true }) } catch { /* ignore */ }
        }
        r.videoFiles = []
      }
    }
  }

  /** 排队执行 flush：同群同一时间只跑一个（否则连发两条会并发双回复）。 */
  /** 按消息类型选合批窗口：@ / 私聊 / 必回 用更短的，普通闲聊保持原样。 */
  function debounceFor(r) {
    const c = cfgFor(r.roomId)
    const fast = r.pending.some((m) => !r.isGroup || m.isAtMe || mustReply(r, m.sender))
    return Math.max(150, Number(fast ? c.fastDebounceMs : c.debounceMs) || 0)
  }

  function scheduleFlush(r, delay) {
    if (r.timer) {
      timers.delete(r.timer)
      clearTimeout(r.timer)
    }
    const wait = delay ?? debounceFor(r)
    const t = track(
      setTimeout(async () => {
        timers.delete(t)
        r.timer = null
        if (r.flushing) {
          scheduleFlush(r, 400)
          return
        }
        r.flushing = true
        try {
          await flush(r)
        } catch (e) {
          log('处理失败：' + String(e?.message || e))
        } finally {
          r.flushing = false
          if (r.pending.length && !r.timer) scheduleFlush(r, 300)
        }
      }, wait),
    )
    r.timer = t
  }

  // ── 主动说话（默认关）──────────────────────────────────
  function proactiveTick() {
    if (!config.enabled) return
    const now = Date.now()
    for (const r of rooms.values()) {
      if (!allowedHere(r)) continue
      if (r.flushing) continue
      const c = cfgFor(r.roomId)
      if (!c.proactive) continue
      // 安静时段不主动；10 分钟回复上限也管着（否则主动说话会把额度用光）
      if (isQuiet(quietWindowsFor(c.quietHours))) continue
      if (r.replyTimes.filter((t) => now - t < 600000).length >= Number(c.maxRepliesPer10Min)) continue
      if (!inHours(c.proactiveHours, new Date(now))) continue
      if (!r.lastActivityAt || now - r.lastActivityAt < Number(c.proactiveIdleMs)) continue
      if (r.lastProactiveAt && now - r.lastProactiveAt < Number(c.proactiveMinGapMs)) continue
      if (Math.random() >= Number(c.proactiveChance)) continue
      void (async () => {
        r.flushing = true
        try {
          const user = [
            `群「${r.roomName || r.roomId}」已经 ${Math.round((now - r.lastActivityAt) / 60000)} 分钟没人说话了。`,
            buildTranscript(r, 10),
            '',
            '你可以主动起个话头（一句，口语，别用"在吗"），或者干脆不吭声。',
          ].join('\n')
          const { text } = await generate({ system: systemPrompt(r), user })
          if (!text) return
          // 主动说的话也要过一遍去 AI 味（否则只有被动回复是"人话"，偶尔冒一句很机械）
          const say = c.humanize ? humanizeText(text, { dropPeriod: Number(c.humanizeDropPeriod) || 0 }) : text
          if (!String(say || '').trim()) return
          const sent = await sendReply(r, { text: say, priority: 'ambient' })
          if (sent.length) r.lastProactiveAt = Date.now()
          log(`主动说话 ${r.roomName || r.roomId}：${text.slice(0, 40)}`)
        } catch (e) {
          log('主动说话失败：' + String(e?.message || e))
        } finally {
          r.flushing = false
        }
      })()
    }
  }

  function inHours(spec, date) {
    const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(spec || '').trim())
    if (!m) return true
    const cur = date.getHours() * 60 + date.getMinutes()
    const s = Number(m[1]) * 60 + Number(m[2])
    const e = Number(m[3]) * 60 + Number(m[4])
    return s <= e ? cur >= s && cur < e : cur >= s || cur < e
  }

  // ── 工具 ──────────────────────────────────────────────
  const textOut = {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  }

  function safeRegister(def) {
    try {
      return ctx.tools.register(def)
    } catch (e) {
      if (/already registered/i.test(String(e?.message || e))) {
        log(`工具 ${def?.name} 已存在（热重载残留），本次跳过`)
        return () => {}
      }
      throw e
    }
  }

  function connectInfo() {
    const s = ob.status
    return [
      `插件：${config.enabled ? '启用' : '停用'}${config.dryRun ? '（演练）' : ''}｜v${version}`,
      `WS：${s.connected ? '已连接' : '未连接'} ${s.wsUrl || '-'}（重连 ${s.reconnects} 次）`,
      `HTTP：${s.httpUrl || '-'}`,
      `账号：${s.self ? `${s.self.nickname || ''}（${s.self.user_id}）` : '未取到'}`,
      s.lastError ? `最近错误：${s.lastError}` : '',
    ].filter(Boolean).join('\n')
  }

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_status',
      description: 'QQ 机器人状态：SnowLuma 连接/账号、开关、拟人参数、各群节流与最近决策。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const lines = ['== QQ 机器人状态 ==', connectInfo(), '']
        lines.push(
          `计数：收到 ${stats.msgsIn}｜回复 ${stats.replies}｜跳过 ${stats.skipped}｜拦截 ${stats.blocked}｜LLM ${stats.llmCalls}（失败 ${stats.llmErrors}）｜发出 ${stats.sends}` +
        `｜推送 ${stats.pushed || 0}（命中 ${stats.pushHits || 0}）${config.pushEnabled ? (pushServer?.listening ? '监听中' : '未监听') : '关'}`,
        )
        lines.push(
          `延迟：上次首字 ${stats.lastFirstTokenMs}ms｜总 ${stats.lastLatencyMs}ms`,
        )
        lines.push(
          `拟人：闲聊 ${Math.round(config.replyProbability * 100)}%｜冷却 ${Math.round(config.minReplyGapMs / 1000)}s｜10min 上限 ${config.maxRepliesPer10Min}｜延迟倍率 ${config.delayScale}｜轮询 ${config.pollMs}ms｜安静时段 ${config.quietHours || 'off'}`,
        )
        lines.push(`白名单群：${config.allowGroups.join(', ') || '无'}（硬约束，其它群一律不碰）`)
        if (!rooms.size) {
          lines.push(`\n还没收到任何消息（已知群 ${groupNames.size} 个，其中授权 ${config.allowGroups.filter((g) => groupNames.has(String(g))).length} 个）`)
        }
        for (const r of rooms.values()) {
          if (!allowedHere(r) && !r.msgs.length) continue
          const last = r.msgs[r.msgs.length - 1]
          const label = r.isGroup ? `群「${r.roomName || r.roomId}」` : `私聊「${r.roomName || r.roomId}」`
          lines.push(
            `\n${label}${allowedHere(r) ? '' : '（未授权，仅记录）'}` +
              (mustReply(r, r.roomId) ? '｜必回' : '') +
              `｜10min 回 ${r.replyTimes.filter((t) => Date.now() - t < 600000).length}/${config.maxRepliesPer10Min}` +
              `｜上次回复 ${r.lastReplyAt ? Math.round((Date.now() - r.lastReplyAt) / 60000) + ' 分钟前' : '从未'}` +
              `｜记忆 ${factsOf(r.roomId).length} 条` +
              (cfgFor(r.roomId).memoryExtract
                ? `（提炼 ${r.msgSinceExtract || 0}/${Number(cfgFor(r.roomId).memoryExtractEvery) || 30}）`
                : '（自动提炼关）') +
              (r.isGroup ? `｜关系 ${r.msgSinceRelations || 0}/${Number(cfgFor(r.roomId).relationsEvery) || 300}` : '') +
              `｜最近决策：${r.lastDecision ? `${r.lastDecision.reason}` : '-'}`,
          )
          if (last) lines.push(`  最近：${last.isSelf ? '我' : last.senderName}: ${String(last.text).slice(0, 60)}`)
        }
        const silent = groupNames.size - rooms.size
        if (silent > 0) lines.push(`\n（另有 ${silent} 个群还没收到过消息，不展开）`)
        return lines.join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_rooms',
      description: '列出机器人见过的 QQ 群/私聊，含是否在白名单、活跃时间、最近决策。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        if (!rooms.size) return `还没收到任何消息（已知群 ${groupNames.size} 个，不会列出未活动的群）。`
        const lines = []
        for (const r of rooms.values()) {
          lines.push(
            `${r.roomName || r.roomId}（${r.roomId}）｜${allowedHere(r) ? '已授权' : '未授权'}｜消息 ${r.msgs.length} 条｜最后活跃 ${r.lastActivityAt ? Math.round((Date.now() - r.lastActivityAt) / 60000) + ' 分钟前' : '-'}`,
          )
        }
        const silent = groupNames.size - rooms.size
        if (silent > 0) lines.push(`（另有 ${silent} 个群还没收到过消息）`)
        return lines.join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_history',
      description: '看某个群最近的消息记录（只读）。room 可用群号、群名，留空且只有一个群时自动选。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号或群名；只有一个群时可留空' },
          limit: { type: 'number', description: '条数，默认 20，最多 100' },
        },
      },
      output: textOut,
      async execute(args) {
        const key = String(args?.room ?? '').trim()
        let r = rooms.get(key)
        if (!r && key) {
          for (const x of rooms.values()) if (x.roomName === key) r = x
        }
        if (!r && !key && rooms.size === 1) r = [...rooms.values()][0]
        if (!r) throw new Error(`找不到群：${key || '（有多个群，请指定）'}`)
        const n = Math.max(1, Math.min(100, Number(args?.limit) || 20))
        const lines = [`群「${r.roomName || r.roomId}」最近 ${n} 条：`]
        for (const m of r.msgs.slice(-n)) {
          const t = new Date(m.ts).toLocaleTimeString('zh-CN', { hour12: false })
          lines.push(`${t} ${m.isSelf ? '我' : m.senderName}: ${m.text}`)
        }
        return lines.join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_config',
      description: '读或改 QQ 机器人的运行参数（改完立刻生效并落盘）。不带 value 返回全部配置。',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '参数名，如 enabled / replyProbability / quietHours' },
          value: { type: 'string', description: '新值；布尔用 true/false，列表用逗号分隔' },
        },
      },
      output: textOut,
      async execute(args) {
        const key = String(args?.key ?? '').trim()
        if (!key) return Object.entries(config).map(([k, v]) => `${k} = ${Array.isArray(v) ? v.join(',') : v}`).join('\n')
        if (args?.value === undefined) {
          if (!(key in config)) throw new Error(`未知参数：${key}`)
          return `${key} = ${Array.isArray(config[key]) ? config[key].join(',') : config[key]}`
        }
        const r = applyConfigPatch({ [key]: args.value })
        if (!r.ok) throw new Error(JSON.stringify(r.rejected))
        log(`配置变更 ${key} = ${JSON.stringify(r.applied[key])}`)
        return `已生效：${key} = ${Array.isArray(r.applied[key]) ? r.applied[key].join(',') : r.applied[key]}`
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_say',
      description: '以机器人身份往指定群发一条纯文本（不走模型）。只允许白名单群。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号' },
          text: { type: 'string', description: '要发的文本' },
        },
        required: ['room', 'text'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room ?? '').trim().replace(/^group:/, '')
        assertGroupAllowed(roomId)
        const text = String(args?.text ?? '').trim()
        if (!text) throw new Error('text 为空')
        const r = roomState(roomId)
        if (config.dryRun) return `[演练] 未发送：${text}`
        const res = await sendWithRetry(roomId, true, 'text', text)
        if (res.queued) return `网络抖动，已排入重发队列：${text}（${res.error}）`
        stats.sends += 1
        r.lastReplyAt = Date.now()
        return `已发送到 ${roomId}：${text}`
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_ask',
      description:
        '强制生成并发送（忽略概率/冷却，用于测试回复与延迟）。room 必须在白名单。返回首字与总耗时。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号' },
          prompt: { type: 'string', description: '对它说的话；留空则用该群最近一条消息' },
          at: { type: 'string', description: '可选：要 @ 的 QQ 号（验证 at 段是否可用）' },
        },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room ?? '').trim().replace(/^group:/, '')
        assertGroupAllowed(roomId)
        const r = roomState(roomId)
        const prompt = String(args?.prompt ?? '').trim() || r.msgs[r.msgs.length - 1]?.text || '在吗'
        const hit = await buildSearchNote(r, prompt)
        const block = hit?.text
          ? `\n【联网搜索结果（${hit.query}）】\n${hit.text}\n（用平时口气转述，别念来源、别列条目；至少说出 1~2 个具体信息，没有相关的就说没查到。）`
          : ''
        const user = [
          buildTranscript(r, Number(config.contextMessages) || 20),
          block,
          '',
          `现在有人对你说：「${prompt}」`,
          '自然地回一句。',
        ]
          .filter((x) => x !== '')
          .join('\n')
        const t0 = Date.now()
        const { text, firstTokenMs, usage } = await generate({ system: systemPrompt(r), user })
        const sent = await sendReply(r, { text, priority: 'at', atUser: String(args?.at || '') })
        log(
          `[测试] ${r.roomName || r.roomId}｜首字 ${firstTokenMs}ms 总 ${Date.now() - t0}ms` +
            (hit?.count ? `｜联网 ${hit.count} 条` : '') +
            `｜${sent.join(' / ')}`,
        )
        return [
          `首字 ${firstTokenMs}ms｜总 ${Date.now() - t0}ms${usage ? `｜token ${usage.inputTokens ?? '?'}/${usage.outputTokens ?? '?'}` : ''}` +
            (hit?.count ? `｜联网 ${hit.count} 条（${hit.ms}ms）` : hit?.skipped ? `｜未联网：${hit.skipped}` : ''),
          `已发：${sent.join(' / ')}`,
        ].join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_selftest',
      description:
        '收消息链路自测：把白名单群里最新一条别人发的消息重新注入一遍，走真实「收到→判定→生成→发送」流程并返回耗时。用于确认轮询/推送到底能不能收到消息。',
      parameters: {
        type: 'object',
        properties: { room: { type: 'string', description: '群号（必须在白名单）' } },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room ?? '').trim().replace(/^group:/, '')
        assertGroupAllowed(roomId)
        const data = await ob.call('get_group_msg_history', { group_id: roomId, count: 20 }, 8000)
        const self = String(ob.status.self?.user_id ?? '')
        let ev = null
        for (const m of data?.messages || []) {
          const cand = normalizeEvent(m, self)
          if (!cand.roomId || !cand.text) continue
          if (String(m?.user_id ?? '') === self) continue
          if (!ev || cand.ts >= ev.ts) ev = cand
        }
        if (!ev) throw new Error('历史里没有别人发的文本消息可回放')
        const r = roomState(roomId)
        r.seen.delete(ev.id)
        const before = stats.replies
        const t0 = Date.now()
        void onEvent(ev).catch((e) => log('消息处理失败：' + String(e?.message || e)))
        for (let i = 0; i < 60; i++) {
          if (stats.replies > before) break
          await sleep(500)
        }
        const ok = stats.replies > before
        return [
          `回放：${ev.senderName}: ${String(ev.text).slice(0, 60)}（${new Date(ev.ts).toLocaleTimeString('zh-CN', { hour12: false })}）`,
          ok
            ? `✅ 已回复，端到端 ${Date.now() - t0}ms（@ 快车道合批 ${Number(cfgFor(roomId).fastDebounceMs) || 400}ms + 拟人延迟 ×${config.delayScale}${config.streamSend ? '｜流式已开' : ''}）`
            : `❌ 未回复（决策：${r.lastDecision?.reason ?? '未知'}）`,
          `首字 ${stats.lastFirstTokenMs}ms｜模型侧 ${stats.lastLatencyMs}ms`,
        ].join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_send_sticker',
      description: '从图库挑一张（或指定 id）发到白名单群，用来验证图片段是否可用。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号（必须在白名单）' },
          id: { type: 'string', description: '可选：图库里的 id；留空则随机' },
        },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room ?? '').trim().replace(/^group:/, '')
        assertGroupAllowed(roomId)
        const keys = Object.keys(stickers).filter((k) => !stickers[k].bad)
        if (!keys.length) throw new Error('图库是空的（或条目都已失效）：群里有人发图/表情后才会收进来')
        const key = args?.id ? String(args.id) : keys[Math.floor(Math.random() * keys.length)]
        const s = stickers[key]
        if (!s) throw new Error('图库里没有这个 id：' + key)
        if (s.bad) throw new Error('这张已失效，换一张吧')
        if (config.dryRun) return `[演练] 未发送：${s.url}`
        const res = await sendStickerTo(roomId, s, key)
        if (!res.ok) throw new Error(res.error)
        if (res.queued) return `网络抖动，已排入重发队列：${key}（${res.error}）`
        return `已发到 ${roomId}：${key}（累计用 ${s.uses} 次）\n${s.url}`
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_panel',
      description:
        '面板数据自检：检查 /qq-bot/api/state 的字段是否齐全（面板 JS 依赖这些键），返回计数而不是整包 JSON。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const s = panelState()
        const need = ['ok', 'at', 'version', 'config', 'defaults', 'meta', 'groups', 'features', 'stats', 'connection', 'health', 'usage', 'rooms', 'stickers', 'names', 'paths']
        const missing = need.filter((k) => !(k in s))
        return [
          missing.length ? '❌ 缺字段：' + missing.join(', ') : '✅ 字段齐全（' + need.length + ' 个）',
          `meta ${Object.keys(s.meta || {}).length} 项 / groups ${(s.groups || []).length} 组 / features ${(s.features || []).length} 个开关`,
          `rooms ${s.rooms.length} 个 / 表情包 ${s.stickers.count} 张 / 已知群 ${s.names.groups} 个`,
          `usage 累计 ${s.usage.total} token（${s.usage.calls} 次调用）｜健康 ${s.health ? (s.health.bad.length ? s.health.bad.length + ' 项异常' : '正常') : '未检查'}`,
          `面板页：GET /qq-bot｜接口：GET /qq-bot/api/state`,
        ].join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_selftest_ops',
      description:
        '逐项跑一遍面板与拟人功能的底层实现（自检、用量、记忆、历史检索、表情包、日志、导出、敷衍/防重复/优先级判定），只读或自带清理，不会往群里发消息。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const out = []
        const T = (name, fn) => {
          try {
            out.push(`✅ ${name}：${fn()}`)
          } catch (e) {
            out.push(`❌ ${name}：${String(e?.message || e)}`)
          }
        }
        const TA = async (name, fn) => {
          try {
            out.push(`✅ ${name}：${await fn()}`)
          } catch (e) {
            out.push(`❌ ${name}：${String(e?.message || e)}`)
          }
        }

        // 纯逻辑
        T('敷衍短句', () => [pickCanned('ambient'), pickCanned('at')].filter(Boolean).join(' / ') || '（空）')
        T('文本归一', () => normText('哈哈，[表情] 真的吗？！'))
        T('优先级', () =>
          [
            detectTrigger({ isAtMe: true, text: 'x' }, { aliases: config.aliases }),
            detectTrigger({ isAtMe: false, text: '大肥鱼在吗' }, { aliases: config.aliases }),
            detectTrigger({ isAtMe: false, text: '今天吃什么' }, { aliases: config.aliases }),
          ].join(' / '))
        T('防重复判定', () => {
          const now = Date.now()
          // 长句（≥6 字）刚回过 → 应该拦；短句（"哈哈"）允许重复，这是有意放行的
          const fake = { replyTimes: [], lastReplyAt: 0, repliedTexts: [{ norm: normText('这句话刚刚说过了'), at: now }] }
          const hit = decide(fake, { priority: 'ambient', quiet: false, now, text: '这句话刚刚说过了！' })
          const short = decide(fake, { priority: 'ambient', quiet: false, now, text: '哈哈！' })
          const miss = decide(fake, { priority: 'ambient', quiet: false, now, text: '别的话' })
          return `长句重复 → ${hit.reason}｜短句重复 → ${short.reason}｜新句子 → ${miss.reason}`
        })

        // 自检
        await TA('自检', async () => {
          const h = await selfcheck()
          return `${h.items.length} 项，异常 ${h.bad.length}，提醒 ${h.warn.length}` + (h.bad.length ? `（${h.bad.join('、')}）` : '')
        })

        // 用量
        T('用量统计', () => `${usageView().total} token / ${usageView().calls} 次调用`)

        // 记忆：写一条再删掉
        await TA('长期记忆', async () => {
          const key = '__selftest__'
          const temporary = !isManagedRoom(key)
          if (temporary) config.memoryRooms.push(key)
          const dir = memDirOf(key)
          let added = false
          let listed = 0
          try {
            added = addFact(key, '自检写入')
            listed = factsOf(key).length
          } finally {
            delete facts[key]
            if (temporary) config.memoryRooms = config.memoryRooms.filter((x) => x !== key)
            if (dir) {
              try {
                rmSync(dir, { recursive: true, force: true })
              } catch {
                /* ignore */
              }
            }
          }
          return `写入 ${added ? '成功' : '去重'}，读取 ${listed} 条，已清理目录`
        })

        // 历史检索（走真实 OneBot 接口）
        await TA('历史检索', async () => {
          const room = config.allowGroups[0]
          if (!room) return '没有白名单群，跳过'
          const hits1 = await searchHistory(room, '你刚才说的回复', 3)
          const hits2 = await searchHistory(room, '尾巴怎么摆', 3)
          return `群 ${room}：关键词「回复」命中 ${hits1.length} 条，「尾巴」命中 ${hits2.length} 条`
        })

        // 群成员（面板「群与人」页的数据源）
        T('搜索意图', () =>
          [
            extractSearchQuery('你去搜一下 DeepSeek 最新模型'),
            extractSearchQuery('帮我查查上海天气'),
            extractSearchQuery('@我 看一下包河区天气'),
            extractSearchQuery('今天吃什么'),
          ]
            .map((x) => x || '(不搜)')
            .join(' ｜ '))
        T('隐私拦截', () =>
          [
            sensitiveQuery('查一下 123456789') || '放行',
            sensitiveQuery('查一下 https://a.com') || '放行',
            sensitiveQuery('查一下 deepseek') || '放行',
          ].join(' ｜ '))

        await TA('视觉路由', async () => {
          const r = await resolveVisionRoute()
          return `${r.provider}/${r.model}`
        })
        T('拍一拍配置', () =>
          `被拍当叫我=${config.pokeOnMe ? '开' : '关'}｜拍回去=${config.pokeBack ? Math.round(config.pokeChance * 100) + '%' : '关'}｜回复时顺拍=${Math.round(Number(config.pokeOnReply) * 100)}%`)

        await TA('群成员', async () => {
          const room = config.allowGroups[0]
          if (!room) return '没有白名单群，跳过'
          const list = await ob.groupMembers(room)
          const withCard = list.filter((m) => m.card).length
          return `${list.length} 人（${withCard} 人有群名片）`
        })

        // 表情包
        T('表情包库', () => {
          const keys = Object.keys(stickers)
          return keys.length ? `${keys.length} 张，例：${stickers[keys[0]].url.slice(0, 60)}` : '空（群里还没人发图）'
        })

        // 日志
        T('日志读取', () => {
          const t = tailLines(LOG_FILE, 3)
          return t ? `${t.split('\n').length} 行，最后一行 ${t.split('\n').pop().slice(0, 60)}` : '空'
        })

        // 导出
        T('配置导出', () => {
          const dump = {}
          for (const k of CONFIG_KEYS) dump[k] = config[k]
          return `${Object.keys(dump).length} 个键`
        })

        // 导入（把当前值原样贴回去，验证校验器不误伤）
        T('配置导入', () => {
          const patch = {}
          for (const k of CONFIG_KEYS) patch[k] = config[k]
          const r = applyConfigPatch(patch)
          return r.ok ? `${Object.keys(r.applied).length} 个键通过校验` : `被拒：${JSON.stringify(r.rejected)}`
        })

        return ['== 面板/功能底层自测 ==', ...out].join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_prompt',
      description:
        '只读调试：返回某个会话**真正**发给模型的系统提示词（人设、记忆、画像、规则全在里面）。用来确认"记忆/人设到底有没有生效"。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号或 QQ 号' },
        },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room ?? '').trim().replace(/^group:/, '')
        const r = roomState(roomId)
        const sys = systemPrompt(r)
        const facts = factsOf(roomId)
        return [
          `== ${r.roomName || roomId} 的系统提示词（${sys.length} 字）==`,
          '',
          sys,
          '',
          '== 诊断 ==',
          `托管会话：${isManagedRoom(roomId) ? '是' : '否'}`,
          `记忆事实：${facts.length} 条（factsLimit=${cfgFor(roomId).factsLimit}）`,
          (() => {
            const name = moodName(r)
            if (!name) return '心情状态：（平静/无）'
            const mins = Math.round((Date.now() - (r.mood?.at || 0)) / 60000)
            return `心情状态：${name}${mins >= 0 ? `（${mins} 分钟前触发）` : ''}`
          })(),
          `长度浮动：${cfgFor(roomId).lengthSpread ? '开' : '关'}｜若现在回复会说到 ${pickLineTarget(cfgFor(roomId), cfgFor(roomId).moodEnabled ? moodName(r) : '')} 句`,
          ...facts.map((f) => '  - ' + f.text),
        ].join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_video',
      description:
        '看视频（调试/手动）：给一个本地视频路径或 http 链接，抽关键帧拼图后让视觉模型描述，返回「时长 + 描述」。用来验证视频链路。',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '本地视频路径（如 C:\\tmp\\a.mp4）或 http(s) 链接' },
          frames: { type: 'number', description: '抽几帧，默认用配置里的 videoFrames' },
          room: { type: 'string', description: '可选：把这次看视频写进这个群的记忆（群号）' },
        },
        required: ['source'],
      },
      output: textOut,
      async execute(args) {
        const src = String(args?.source || '').trim()
        if (!src) return '给个视频路径或链接'
        const roomId = String(args?.room || '').trim().replace(/^group:/, '')
        if (roomId) assertGroupAllowed(roomId)
        const c = { ...cfgFor(roomId), videoFrames: Number(args?.frames) || config.videoFrames, videoOnMessage: true, linkVideo: true }
        const t0 = Date.now()
        // 视频平台链接：走 yt-dlp（拿标题/字幕），不下载整段视频
        if (pickVideoLinks(src, 1).length) {
          const got = await buildVideoLinkNote(src, c)
          if (got?.info && roomId) {
            try { rememberVideo(roomState(roomId), { desc: got.info.description || '', duration: got.info.duration }, got.info) } catch { /* ignore */ }
          }
          return (got?.note || '没解析出内容').trim() + `\n（${Date.now() - t0}ms）`
        }
        const v = await describeVideo(src, c)
        if (roomId && v?.desc) {
          try { rememberVideo(roomState(roomId), v, null) } catch { /* ignore */ }
        }
        if (v?.files?.length) {
          for (const f of v.files) { try { rmSync(f, { force: true }) } catch { /* ignore */ } }
        }
        return v?.desc
          ? `时长 ${Math.round(v.duration || 0)} 秒｜${Date.now() - t0}ms\n${v.desc}`
          : `没看成（${Date.now() - t0}ms）。看插件日志里的「看视频失败」。`
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_autostart',
      description: '开机自启：get 看当前状态；set 开关（在 Windows 启动文件夹里放/删一个启动 SnowLuma 的脚本）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'get | set' },
          enabled: { type: 'boolean', description: 'set 时为 true 开启、false 关闭' },
        },
        required: ['action'],
      },
      output: textOut,
      async execute(args) {
        const action = String(args?.action || 'get')
        try {
          if (action === 'set') {
            const r = setAutostart(!!args?.enabled, config.snowlumaHome)
            return (r.enabled ? '已开启' : '已关闭') + ' 开机自启｜脚本：' + r.file
          }
          return (isAutostartEnabled() ? '已开启' : '已关闭') + '｜脚本：' + (autostartFile() || '(拿不到启动目录)')
        } catch (e) {
          return '失败：' + String(e?.message || e)
        }
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_backup',
      description: '备份与恢复：now 立即备份配置和记忆；list 看备份；restore 恢复指定备份（恢复后自动重载）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'now | auto | list | restore' },
          name: { type: 'string', description: 'restore 时的备份名' },
        },
        required: ['action'],
      },
      output: textOut,
      async execute(args) {
        const action = String(args?.action || 'list')
        try {
          if (action === 'auto') {
            backupTick()
            const state = readJson(BACKUP_STATE_FILE, {})
            return '已检查：' + (state.lastDay ? '今天已备份（' + state.name + '）' : '还没到点或今天没备份')
          }
          if (action === 'now') {
            const r = backupNow()
            return '已备份：' + r.name + '（' + r.items + ' 项）'
          }
          if (action === 'restore') {
            const r = backupRestore(String(args?.name || ''))
            return '已恢复 ' + r.restored + ' 项：' + r.name + '（配置与记忆已重新加载）'
          }
          const names = backupList()
          return names.length ? names.join('\n') : '还没有备份'
        } catch (e) {
          return '失败：' + String(e?.message || e)
        }
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_reminders',
      description: '定时提醒：list 看排队的提醒；run 立刻检查一次（到点的发出去）；clear 清空。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'list | run | clear' },
        },
        required: ['action'],
      },
      output: textOut,
      async execute(args) {
        const action = String(args?.action || 'list')
        if (action === 'run') {
          const before = reminders.length
          await getFeatures().checkReminders()
          return `检查完：原有 ${before} 条，剩 ${reminders.length} 条`
        }
        if (action === 'clear') {
          reminders.length = 0
          try { writeJson(REMINDERS_FILE, reminders) } catch { /* ignore */ }
          return '已清空提醒'
        }
        if (!reminders.length) return '没有排队的提醒'
        return reminders
          .slice()
          .sort((a, b) => a.at - b.at)
          .map((x) => {
            const d = new Date(x.at)
            return `${d.toLocaleString('zh-CN', { hour12: false })}｜${x.roomId}｜${x.text}`
          })
          .join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_diary',
      description: '日记与自述：run 立刻按今天的聊天写一篇；read 看最近的日记和"我是谁"。只对托管会话有效。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'run | read' },
          room: { type: 'string', description: '群号；read 时可选，不传就列托管群' },
        },
        required: ['action'],
      },
      output: textOut,
      async execute(args) {
        const action = String(args?.action || 'read')
        if (action === 'run') {
          await getFeatures().maybeDiary(true)
          return '日记任务跑完了（看日志或 read 查看）'
        }
        const roomId = String(args?.room || '').trim().replace(/^group:/, '')
        if (roomId) {
          if (!isManagedRoom(roomId)) return '这个会话不在托管名单里'
          const dir = memDirOf(roomId)
          if (!dir) return '拿不到记忆目录'
          const d = readDiary(dir, 1200)
          const sf = readSelf(dir, 600)
          return ['== 日记 ==', d || '（还没写）', '', '== 我是谁 ==', sf || '（还没写）'].join('\n')
        }
        const out = []
        for (const rr of rooms.values()) {
          if (!isManagedRoom(rr.roomId)) continue
          const dir = memDirOf(rr.roomId)
          if (!dir) continue
          const d = readDiary(dir, 200)
          out.push((rr.roomName || rr.roomId) + '：' + (d ? d.slice(-80).replace(/\n/g, ' ') : '（还没写）'))
        }
        return out.join('\n') || '没有托管会话'
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_simulate',
      description:
        '调试：往指定会话注入一条"像真人发来的"消息，走完整的收消息→决策→回复流程（会真的在群里说话）。用来测小游戏/提醒/撤回/链接/文档这些新功能。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号或 QQ 号' },
          text: { type: 'string', description: '消息内容' },
          sender: { type: 'string', description: '可选：发送者 QQ（默认管理员）' },
          fileUrl: { type: 'string', description: '可选：模拟一个文件（http 链接）' },
          fileName: { type: 'string', description: '可选：文件名，如 a.docx' },
          forwardId: { type: 'string', description: '可选：模拟一条合并转发（id）' },
        },
        required: ['room', 'text'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room || '').trim().replace(/^group:/, '')
        const text = String(args?.text || '')
        if (!roomId || !text) return '需要 room 和 text'
        const sender = String(args?.sender || config.adminQQ[0] || '10000')
        // 群号长度和 QQ 号一样，不能靠长度猜：先看白名单
        const isGroup = config.allowGroups.includes(roomId)
          ? true
          : config.allowPrivate.includes(roomId) || config.adminQQ.includes(roomId)
            ? false
            : roomId.length > 8
        if (isGroup) assertGroupAllowed(roomId)
        const ev = {
          id: 'sim-' + Date.now(),
          roomId,
          isGroup,
          sender,
          senderName: '测试',
          text,
          isAtMe: false,
          images: 0,
          imageUrls: [],
          files: args?.fileUrl ? [{ url: String(args.fileUrl), name: String(args.fileName || 'file.txt'), size: 0 }] : [],
          forwardId: args?.forwardId ? String(args.forwardId) : '',
          ts: Date.now(),
        }
        await onEvent(ev)
        return '已注入，等它按策略回（看日志或群里）'
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_vision',
      description:
        '识图：给一个图片 URL 让视觉模型描述；不给 URL 就看白名单群里最近一条带图消息。用于验证识图/识表情包链路。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '图片或表情包的 URL；留空则用最近一条带图消息' },
          room: { type: 'string', description: '群号（url 留空时用；缺省取第一个白名单群）' },
        },
      },
      output: textOut,
      async execute(args) {
        const url = String(args?.url || '').trim()
        if (url) {
          const t0 = Date.now()
          const d = await describeImage(url, 'image')
          return d ? `描述（${Date.now() - t0}ms）：${d}` : '没拿到描述（看插件日志里的「识图失败」）'
        }
        const roomId = String(args?.room || config.allowGroups[0] || '')
        if (!roomId) throw new Error('没有白名单群')
        assertGroupAllowed(roomId)
        const r = roomState(roomId)
        for (let i = r.msgs.length - 1; i >= 0; i--) {
          const m = r.msgs[i]
          if (m.vision?.length) {
            const t = new Date(m.ts).toLocaleTimeString('zh-CN', { hour12: false })
            return `最近一条带图消息（${t} ${m.senderName}）：\n${m.vision.join(' / ')}`
          }
        }
        return `群 ${roomId} 最近没有带图的消息（或识图没开）`
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_poke',
      description: '拍一拍白名单群里的某个人（OneBot send_poke），用来验证拍一拍链路。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号（必须在白名单）' },
          user: { type: 'string', description: '要拍的 QQ 号' },
        },
        required: ['room', 'user'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room || '').replace(/^group:/, '')
        assertGroupAllowed(roomId)
        const uid = String(args?.user || '').trim()
        if (!uid) throw new Error('user 为空')
        if (config.dryRun) return `[演练] 未拍：${uid}`
        await ob.sendPoke({ groupId: roomId, userId: uid })
        return `已拍 ${uid}（群 ${roomId}）`
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_llm_models',
      description: '列出当前 DSH 可用的模型路由（provider 及其模型），用来给识图/主模型挑一个能用的 provider+model。',
      parameters: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: '可选：只看这个 provider 的模型列表' },
        },
      },
      output: textOut,
      async execute(args) {
        const llm = ctx.get?.('llm')
        if (!llm) throw new Error('没有 llm 服务')
        const providers = (llm.listProviders?.() || []).map((p) => p.id)
        const only = String(args?.provider || '').trim()
        const list = only ? [only] : providers
        const lines = [`provider（${providers.length}）：${providers.join(', ') || '无'}`]
        for (const p of list) {
          try {
            const models = (await llm.listModels(p)) || []
            const ids = models.slice(0, 12).map((m) => m.id)
            lines.push(`\n${p}（${models.length}）：${ids.join(', ')}${models.length > 12 ? ' …' : ''}`)
            const vision = models.filter((m) => (m.inputModalities || []).includes('image'))
            if (vision.length) lines.push(`  ↳ 支持图片：${vision.map((m) => m.id).join(', ')}`)
          } catch (e) {
            lines.push(`\n${p}：读取失败 ${String(e?.message || e)}`)
          }
        }
        return lines.join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_search',
      description: '用 DSH 的联网搜索查一条信息（只读，不发群消息），用来验证"让它去搜"这条链路。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '查询词' },
          count: { type: 'number', description: '最多几条结果，默认 5' },
        },
        required: ['query'],
      },
      output: textOut,
      async execute(args) {
        const q = String(args?.query || '').trim()
        if (!q) throw new Error('query 为空')
        const bad = sensitiveQuery(q)
        if (bad) return `没搜：${bad}（不把隐私发给搜索引擎）`
        const t0 = Date.now()
        const r = await webSearch(q, Math.max(1, Math.min(10, Number(args?.count) || 5)), Number(config.searchTimeoutMs) || 8000)
        return `搜索「${q}」→ ${r.count} 条（${Date.now() - t0}ms）\n\n${r.text || '（没有结果）'}`
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_outbox',
      description: '发送失败重试队列：看有哪些消息在排队等重发，或立刻重发一次。',
      parameters: {
        type: 'object',
        properties: {
          flush: { type: 'boolean', description: 'true=立刻尝试重发一次' },
        },
      },
      output: textOut,
      async execute(args) {
        if (args?.flush) await flushOutbox()
        if (!outbox.count) return '重发队列为空'
        return [
          `待重发 ${outbox.count} 条（最多重试 5 次 / 10 分钟）：`,
          ...outbox
            .list({ limit: 20 })
            .map((x) => `- ${x.roomId}｜${x.kind}｜第 ${x.attempts} 次｜${x.preview}｜${String(x.lastError).slice(0, 60)}`),
        ].join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_room_config',
      description:
        '每群性格：查看/设置某个群的独立参数（人设、概率、冷却、延迟、安静时段、拆句、识图、联网、表情包、主动、拍一拍等）。只允许表达层参数，白名单/模型/接入地址不可按群覆盖。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号' },
          show: { type: 'boolean', description: 'true=只查看当前覆盖（默认行为，未传 patch 时）' },
          reset: { type: 'boolean', description: 'true=清空该群所有覆盖，恢复跟随全局' },
          patch: {
            type: 'object',
            description: '要覆盖的参数对象，如 {"persona":"...","replyProbability":0.6}；整份替换',
            additionalProperties: true,
          },
        },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room || '').replace(/^group:/, '').trim()
        if (!roomId) throw new Error('room 为空')
        if (args?.reset) {
          resetRoomOverride(roomId)
          return `群 ${roomId} 已恢复跟随全局`
        }
        if (args?.patch && typeof args.patch === 'object') {
          const r = setRoomOverride(roomId, args.patch)
          const lines = [
            `群 ${roomId} 已覆盖 ${r.count} 项：`,
            ...Object.entries(r.applied).map(([k, v]) => `  ${k} = ${Array.isArray(v) ? v.join(',') : String(v).slice(0, 80)}`),
          ]
          if (!r.ok) lines.push('被拒：' + JSON.stringify(r.rejected))
          return lines.join('\n')
        }
        const ov = roomOverrideOf(roomId)
        const eff = cfgFor(roomId)
        const keys = Object.keys(ov)
        return [
          `群 ${roomId}：${keys.length ? `自定义 ${keys.length} 项` : '跟随全局'}`,
          ...keys.map((k) => `  ${k} = ${Array.isArray(ov[k]) ? ov[k].join(',') : String(ov[k]).slice(0, 80)}`),
          `\n（实际生效的闲聊概率 ${eff.replyProbability}、延迟倍率 ${eff.delayScale}、人设 ${String(eff.persona).slice(0, 30)}…）`,
        ].join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_admin_cmd',
      description:
        '管理员遥控指令的解析预览（dry-run）：给它一句话，看会被识别成什么操作、目标哪个群。不会真的执行，也不会发确认。',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: '管理员会说的那句话' } },
        required: ['text'],
      },
      output: textOut,
      async execute(args) {
        const text = String(args?.text || '').trim()
        if (!text) throw new Error('text 为空')
        // 与真实处理器保持一致：带"然后/顺便/同时"的复合句交给模型拆
        const compound = /(顺便|然后|同时|接着|之后|并且)/.test(text)
        const cmd = compound ? null : parseAdminCommand(text)
        if (cmd?.action === 'multi') return '识别为多动作（会要求拆开说），不会执行'
        if (cmd?.action) {
          const target = cmd.target
          return [
            `规则命中：${cmd.action}`,
            `目标群：${target ? `${target.name || '(无名)'}（${target.roomId}）` : '❌ 没找到群'}`,
            target ? `确认后会：\n${describeAdminAction(cmd)}` : '需要把群名或群号说清楚',
          ].join('\n')
        }
        if (!config.adminNL) return '规则没命中（自然语言解析已关闭 adminNL=false）'
        const planned = await planAdminCommand(text)
        const norm = normalizePlannedActions(planned)
        if (!norm.length) {
          return `规则没命中，模型也没给出有效动作。\n原始输出：${JSON.stringify(planned).slice(0, 300)}`
        }
        return ['规则没命中 → 模型解析出：', ...norm.map((a, i) => `${i + 1}. ${describeAdminAction(a)}`)].join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_sticker_sweep',
      description: '图库维护：把还没存到本地的表情图重新下载并本地化，过期的标记作废。返回可用/失效数量。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const before = Object.keys(stickers).length
        const badBefore = Object.keys(stickers).filter((k) => stickers[k].bad).length
        await sweepStickerLibrary()
        const badAfter = Object.keys(stickers).filter((k) => stickers[k].bad).length
        const withFile = Object.keys(stickers).filter((k) => stickers[k].file && existsSync(stickers[k].file)).length
        return [
          `图库共 ${before} 张，本地可用 ${withFile} 张`,
          `失效 ${badBefore} → ${badAfter}（本次新标记 ${badAfter - badBefore} 张）`,
          `目录：${STICKER_DIR}`,
        ].join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_stickers',
      description: '查看表情包库：每张的来源、是否已收进 QQ 收藏（收藏后才能以表情气泡发出）、使用次数、是否失效。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const ids = Object.keys(stickers)
        if (!ids.length) return '图库是空的：群里有人发表情/图片后会自动收进来'
        const rows = ids
          .map((k) => ({ k, s: stickers[k] }))
          .sort((a, b) => (b.s.at || 0) - (a.s.at || 0))
          .slice(0, 40)
        const fav = ids.filter((k) => stickers[k].emojiId).length
        const local = ids.filter((k) => stickers[k].file && existsSync(stickers[k].file)).length
        const bad = ids.filter((k) => stickers[k].bad).length
        return [
          `图库 ${ids.length} 张｜已收进收藏 ${fav}｜有本地文件 ${local}｜失效 ${bad}`,
          ...rows.map(
            ({ k, s }) =>
              `- ${k}${s.subType ? ' 表情' : ' 图片'}${s.emojiId ? ' ★收藏' : ''}${s.bad ? ' ❌失效' : ''}${s.file && existsSync(s.file) ? ' 📁本地' : ''}｜用 ${s.uses || 0} 次`,
          ),
        ].join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_reload',
      description:
        '重载 QQ 机器人插件本体（应用磁盘上的代码改动）；configOnly=true 时只重读 config.json/rooms.json。重载约 1 秒后发生，连接会自动恢复。',
      parameters: {
        type: 'object',
        properties: {
          configOnly: { type: 'boolean', description: 'true=只重读配置文件，不重载代码' },
        },
      },
      output: textOut,
      async execute(args) {
        if (args?.configOnly) {
          const r = rereadConfigFromDisk()
          return `已重读配置：${r.changed.length ? '变化 ' + r.changed.join(',') : '无变化'}`
        }
        const r = reloadSelf(900)
        if (!r.ok) throw new Error(r.error)
        return `已触发重载，约 ${r.inMs}ms 后生效；连接会自动重连，几秒后看状态即可。`
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_memory',
      description:
        '长期记忆：list / add / del / clear / extract 提炼 / profile 画像 / summary 摘要 / relations 群内关系 / search 翻旧记忆 / show 全看。只有托管名单里的会话才记。',
      parameters: {
        type: 'object',
        properties: {
          room: { type: 'string', description: '群号（私聊用对方 QQ 号）' },
          action: { type: 'string', description: 'list | add | del | update | clear | extract | profile | summary | relations | search | export | graph | show | regenProfile | regenSummary' },
          text: { type: 'string', description: 'add 的内容 / update 的新内容 / del 的原内容' },
          old: { type: 'string', description: 'update 时被修改的原内容' },
        },
        required: ['room'],
      },
      output: textOut,
      async execute(args) {
        const roomId = String(args?.room || '').replace(/^group:/, '').trim()
        if (!roomId) throw new Error('room 为空')
        if (!isManagedRoom(roomId)) {
          return `这个会话不在记忆托管名单里（当前：${config.memoryRooms.join('、') || '空'}），不记录任何记忆。\n要开的话在面板「长期记忆」页的「维护记忆的会话」里加上 ${roomId}。`
        }
        const action = String(args?.action || 'list')
        if (action === 'add') return addFact(roomId, args?.text) ? '已记下' : '已存在（归一化后重复）'
        if (action === 'regenProfile') {
          const rr = await updateProfile(roomState(roomId))
          return rr.ok ? '画像已重新生成' : '失败：' + (rr.error || '模型返回空')
        }
        if (action === 'regenSummary') {
          const rr = await updateSummary(roomState(roomId))
          return rr.ok ? '摘要已重新生成' : '失败：' + (rr.error || '模型返回空')
        }
        if (action === 'del') return delFact(roomId, args?.text) ? '已删除' : '没找到这条'
        if (action === 'update') {
          const oldText = String(args?.old || '')
          const newText = String(args?.text || '').trim()
          if (!newText) return '新内容不能为空'
          const list = loadFacts(roomId)
          const idx = list.findIndex((x) => factNorm(x.text) === factNorm(oldText))
          if (idx < 0) return '没找到这条记忆'
          if (list.some((x, i) => i !== idx && factNorm(x.text) === factNorm(newText))) return '已经有一条一样的了'
          list[idx] = { ...list[idx], text: newText, editedAt: Date.now() }
          facts[roomId] = list
          writeRoomFacts(memDirOf(roomId), list, { keep: 60 })
          return `已修改，现在是：${newText}`
        }
        if (action === 'clear') {
          facts[roomId] = []
          writeRoomFacts(memDirOf(roomId), [], { keep: 60 })
          return '已清空该群记忆（归档文件保留）'
        }
        if (action === 'extract') {
          const r = await extractFacts(roomId)
          return r.ok ? `提炼出 ${r.added} 条${r.lines?.length ? '：' + r.lines.join(' / ') : ''}` : r.error
        }
        if (action === 'profile') {
          const r = await updateProfile(roomState(roomId))
          return r.ok ? r.text : r.error
        }
        if (action === 'summary') {
          const r = await updateSummary(roomState(roomId))
          return r.ok ? r.text : r.error
        }
        if (action === 'relations') {
          const r = await updateRelations(roomState(roomId))
          return r.ok ? r.text : r.error
        }
        if (action === 'search') {
          const hits = searchMemory(roomId, args?.text || args?.query || '', 10)
          return hits.length
            ? hits.map((h) => `[${h.kind}] ${h.text}`).join('\n')
            : '没翻到相关的旧记忆'
        }
        if (action === 'export') {
          const out = exportMemory(roomId)
          return out.ok ? `已导出 ${Object.keys(out.files).length} 个文件 → ${out.file}` : out.error
        }
        if (action === 'graph') {
          const dir = memDirOf(roomId)
          if (!dir) return '该会话不在记忆托管名单里'
          const g = readJson(graphPath(dir), null)
          if (!g || !g.nodes?.length) return '还没有关系图（先跑一次 relations 分析）'
          const nameOf = (id) => (g.nodes.find((n) => n.id === id) || {}).name || id
          return [
            `节点 ${g.nodes.length} 个：` + g.nodes.map((n) => `${n.name}(${n.msgs})`).join('、'),
            '主要互动：',
            ...g.edges.slice(0, 10).map((e) => `- ${nameOf(e.a)} ↔ ${nameOf(e.b)}：${e.w} 次`),
          ].join('\n')
        }
        if (action === 'show') {
          const dir = memDirOf(roomId)
          if (!dir) return '该会话不在记忆托管名单里'
          const t = readRoomText(dir)
          return [
            `目录：${dir}`,
            `画像（${t.profile.length} 字）：\n${t.profile || '（还没有）'}`,
            `摘要（${t.summary.length} 字）：\n${t.summary || '（还没有）'}`,
            `关系（${t.relations.length} 字）：\n${t.relations || '（还没有）'}`,
          ].join('\n\n')
        }
        const list = factsOf(roomId)
        const dir = memDirOf(roomId)
        if (!list.length) {
          return `群 ${roomId} 还没有长期记忆（自动提炼：${cfgFor(roomId).memoryExtract ? '开' : '关'}）\n目录：${dir}`
        }
        return [
          `群 ${roomId} 的记忆（${list.length} 条）｜目录 ${dir}`,
          ...list.map((f) => `- ${f.text}（${new Date(f.at).toLocaleDateString('zh-CN')}）`),
        ].join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_selfcheck',
      description: '自检明细：WS/HTTP/白名单/收消息通路/模型路由（会验证 provider 是否真的有模型）/视觉路由/日志可写。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const h = await selfcheck()
        const icon = (lv) => (lv === 'ok' ? '✅' : lv === 'warn' ? '⚠️ ' : '❌')
        const lines = h.items.map((it) => `${icon(it.level)} ${it.name}：${it.text}` + (it.advice ? `\n   → ${it.advice}` : ''))
        lines.push('', `异常 ${h.bad.length} 项｜提醒 ${h.warn.length} 项`)
        if (h.bad.length) lines.push('异常项：' + h.bad.join('、'))
        return lines.join('\n')
      },
    }),
  )

  ctx.effect(() =>
    safeRegister({
      name: 'qqbot_health',
      description: '探测 SnowLuma 连接（HTTP 动作 + WS 状态 + 账号），并列出自动发现到的端点。',
      parameters: { type: 'object', properties: {} },
      output: textOut,
      async execute() {
        const h = await ob.health()
        const d = await discover({
          homeDir: config.snowlumaHome,
          httpUrl: config.httpUrl,
          wsUrl: config.wsUrl,
          accessToken: config.accessToken,
        })
        return [
          `HTTP：${h.http ? '通' : '不通'}｜WS：${h.ws ? '开' : '关'}`,
          `账号：${h.self ? `${h.self.nickname}（${h.self.user_id}）` : '未取到'}`,
          h.error ? `错误：${h.error}` : '',
          `发现：${d.ok ? `${d.http.url}（账号 ${d.self?.user_id}）` : d.error}`,
          `候选：${(d.tried || []).map((t) => `${t.url}${t.ok ? ' ✔' : ' ✘'}`).join('；') || '-'}`,
        ].filter(Boolean).join('\n')
      },
    }),
  )

  // ── Web 面板 API（挂在 DSH 自己的 webServer 上）──────────
  // ── 自检 ──────────────────────────────────────────────
  let healthCache = null
  async function selfcheck() {
    const items = []
    const push = (name, level, text, advice) =>
      items.push({ name, level, text, ...(advice ? { advice } : {}) })
    const st = ob.status
    push(
      'WS 连接',
      st.connected ? 'ok' : 'bad',
      st.connected ? `已连接（重连 ${st.reconnects} 次）` : st.lastError || '未连接',
      st.connected ? '' : '确认 SnowLuma 在跑；换账号后 token 会变，插件会自动重新发现',
    )
    try {
      const h = await ob.health()
      push('HTTP 动作', h.http ? 'ok' : 'bad', h.http ? 'get_login_info 正常' : h.error || '不可用',
        h.http ? '' : '确认 OneBot HTTP 端口和 token')
      if (h.self) {
        const same = String(h.self.user_id) === String(st.self?.user_id ?? '')
        push('账号一致', same ? 'ok' : 'warn', `${h.self.nickname}（${h.self.user_id}）`, same ? '' : 'HTTP 与 WS 可能指向不同账号')
      }
    } catch (e) {
      push('HTTP 动作', 'bad', String(e?.message || e))
    }
    push(
      '白名单群',
      config.allowGroups.length ? 'ok' : 'warn',
      config.allowGroups.map((g) => `${groupNames.get(String(g)) || '未知群'}（${g}）`).join('、') || '未配置',
      config.allowGroups.length ? '' : '没有白名单群，机器人谁都不回',
    )
    push(
      '收消息通路',
      config.pollMs > 0 || st.connected ? 'ok' : 'bad',
      config.pollMs > 0 ? `WS + 轮询 ${config.pollMs}ms` : '只靠 WS 推送',
      config.pollMs > 0 ? '' : '本机实测 WS 不推群消息，建议把轮询打开',
    )
    try {
      const m = resolveModel()
      let level = 'ok'
      let text = `${m.provider}/${m.model}`
      let advice = ''
      // 配置留空 = 用 DSH 默认模型：默认 provider 没登录时会让所有回复变成空（踩过一次）
      if (!config.provider || !config.model) {
        level = 'warn'
        text += '（用的是 DSH 默认模型）'
        advice = '建议在「人设与模型」里显式填 provider/model；默认模型不可用时所有回复都会是空的'
      }
      try {
        const llm = ctx.get?.('llm')
        if (llm?.listModels) {
          const models = (await llm.listModels(m.provider)) || []
          if (!models.length) {
            level = 'bad'
            text += '｜该 provider 当前没有可用模型'
            advice = '去 DSH 设置里登录这个 provider，或换成有模型的 provider/model'
          } else if (!models.some((x) => String(x.id) === String(m.model))) {
            level = 'bad'
            text += `｜${m.model} 不在该 provider 的模型列表里`
            advice = '可用模型：' + models.slice(0, 6).map((x) => x.id).join(', ')
          }
        }
      } catch (e) {
        if (level === 'ok') level = 'warn'
        text += '｜无法校验模型列表：' + String(e?.message || e).slice(0, 60)
      }
      push('模型路由', level, text, advice)
    } catch (e) {
      push('模型路由', 'bad', String(e?.message || e), '在「人设与模型」里填 provider/model')
    }
    try {
      appendFileSync(LOG_FILE, '')
      push('日志可写', 'ok', LOG_FILE)
    } catch (e) {
      push('日志可写', 'bad', String(e?.message || e))
    }
    healthCache = {
      at: Date.now(),
      items,
      bad: items.filter((i) => i.level === 'bad').map((i) => i.name),
      warn: items.filter((i) => i.level === 'warn').map((i) => i.name),
    }
    return healthCache
  }

  // ── 长期记忆（每个会话一个文件夹；按相关性注入）────────
  /** 这个 id 是群还是私聊：优先看运行时状态，其次白名单/群列表。 */
  function isGroupRoom(roomId) {
    const id = String(roomId)
    const r = rooms.get(id)
    if (r && typeof r.isGroup === 'boolean') return r.isGroup
    return groupNames.has(id) || config.allowGroups.includes(id)
  }
  /** 这个会话是否纳入记忆托管（只有名单里的群/私聊才记）。 */
  function isManagedRoom(roomId) {
    return config.memoryRooms.includes(String(roomId))
  }
  /** 这个会话的记忆目录（会自动建目录与 meta.json）；未托管返回 ''。 */  function memDirOf(roomId) {
    const id = String(roomId)
    if (!isManagedRoom(id)) return ''
    const isGroup = isGroupRoom(id)
    const name = groupNames.get(id) || (rooms.get(id) || {}).roomName || ''
    return ensureRoom(MEMORY_DIR, id, isGroup, name).dir
  }
  /** 懒加载：第一次访问时才读该会话的 facts.json。 */
  function loadFacts(roomId) {
    const k = String(roomId)
    if (!isManagedRoom(k)) return []
    if (facts[k]) return facts[k]
    const dir = memDirOf(k)
    if (!dir) return []
    const mem = readRoomMemory(dir)
    facts[k] = Array.isArray(mem.facts) ? mem.facts : []
    return facts[k]
  }
  // 画像/摘要/关系是三个小文件，内容很少变：缓存起来，写入时失效，避免每回复都重读
  const roomTextCache = new Map() // dir -> { profile, summary, relations }
  function roomTextOf(dir) {
    let v = roomTextCache.get(dir)
    if (!v) {
      v = { ...readRoomText(dir), diary: readDiary(dir, 600), self: readSelf(dir, 400) }
      roomTextCache.set(dir, v)
    }
    return v
  }
  function invalidateRoomText(dir) {
    if (dir) roomTextCache.delete(dir)
  }
  function factsOf(roomId) {
    return loadFacts(roomId).filter((x) => !x.supersededAt)
  }
  /** 字符二元组 Jaccard：判断"新事实是不是在说同一件事"。 */
  function bigrams(s) {
    const t = String(s || '').replace(/[\s\p{P}\p{S}]/gu, '')
    const set = new Set()
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
    return set
  }
  function similarity(a, b) {
    const A = bigrams(a)
    const B = bigrams(b)
    if (!A.size || !B.size) return 0
    let inter = 0
    for (const x of A) if (B.has(x)) inter += 1
    return inter / (A.size + B.size - inter)
  }
  function factNorm(t) {
    return String(t || '')
      .replace(/[\s\p{P}\p{S}]/gu, '')
      .toLowerCase()
      .slice(0, 120)
  }
  function addFact(roomId, text, at = Date.now()) {
    const k = String(roomId)
    const t = String(text || '').trim()
    if (!t) return false
    if (!isManagedRoom(k)) return false
    const norm = factNorm(t)
    if (!norm) return false
    const dir = memDirOf(k)
    if (!dir) return false
    const list = loadFacts(k)
    if (list.some((x) => !x.supersededAt && factNorm(x.text) === norm)) return false
    // 旧事实和新事实高度相似 → 判定为"同一件事的更新"，旧的作废并留档
    const older = []
    const keep = []
    for (const x of list) {
      if (x.supersededAt) continue
      if (similarity(t, x.text) >= 0.6) older.push({ ...x, supersededAt: Date.now(), supersededBy: t })
      else keep.push(x)
    }
    keep.push({ text: t, at })
    facts[k] = keep
    const r = writeRoomFacts(dir, keep, { keep: 60, archive: older })
    if (older.length) log(`记忆更新：${k} 有 ${older.length} 条旧事实被新版本取代（已归档）`)
    else if (r.archived) log(`记忆归档：${k} 有 ${r.archived} 条转入 archive.jsonl`)
    return true
  }
  function delFact(roomId, text) {
    const k = String(roomId)
    if (!isManagedRoom(k)) return false
    const norm = factNorm(text)
    const list = loadFacts(k)
    const next = list.filter((x) => factNorm(x.text) !== norm)
    if (next.length === list.length) return false
    facts[k] = next
    writeRoomFacts(memDirOf(k), next, { keep: 60 })
    return true
  }
  /** 按"和最近聊天是否相关"挑记忆：关键词命中的优先，其次按时间新的。 */
  function pickFacts(r, limit) {
    const list = factsOf(r.roomId)
    if (!list.length) return []
    const n = Math.max(1, Math.min(30, Number(limit) || 8))
    if (list.length <= n) return list
    const kws = keywordsOf(r.msgs.slice(-6).map((m) => m.text).join(' '))
    const scored = list.map((f) => {
      let score = 0
      for (const k of kws) if (f.text.includes(k)) score += 1
      return { f, score }
    })
    scored.sort((a, b) => b.score - a.score || (b.f.at || 0) - (a.f.at || 0))
    const hit = scored.filter((x) => x.score > 0).slice(0, n).map((x) => x.f)
    if (hit.length) return hit
    return list.slice(-n)
  }
  async function extractFacts(roomId) {
    const r = roomState(roomId)
    const recent = r.msgs.slice(-30)
    if (recent.length < 6) return { ok: false, error: '消息太少，攒够 6 条再提炼' }
    const existing = factsOf(roomId).map((x) => '- ' + x.text).join('\n')
    const user = [
      '从下面的群聊记录里提炼 1~3 条值得长期记住的事实（人物关系、偏好、约定、重要事件）。',
      '每行一条，不要编号、不要解释、不要编造；已经记过的不要重复。没有值得记的就输出「无」。',
      existing ? '\n已经记过的：\n' + existing : '',
      '',
      recent.map((m) => `${m.isSelf ? '我' : m.senderName}: ${m.text}`).join('\n'),
    ]
      .filter(Boolean)
      .join('\n')
    const { text } = await generate({
      system: '你是一个记忆整理器，只输出事实条目，每行一条。',
      user,
      maxTokens: 400,
      temperature: 0.3,
    })
    const lines = String(text || '')
      .split(/\r?\n/)
      .map((s) => s.replace(/^[-•\d.、\s]+/, '').trim())
      .filter((s) => s && s !== '无')
      .slice(0, 3)
    let added = 0
    for (const l of lines) if (addFact(roomId, l)) added += 1
    r.lastExtractAt = Date.now()
    r.msgSinceExtract = 0
    return { ok: true, added, lines }
  }

  /** 自动提炼：攒够 N 条消息且过了冷却才触发；后台跑，不阻塞回复。 */
  /** 翻旧账：在 facts / archive / 摘要 / 关系 里按关键词找。 */
  function searchMemory(roomId, query, limit = 5) {
    if (!isManagedRoom(roomId)) return []
    const dir = memDirOf(roomId)
    if (!dir) return []
    const kws = keywordsOf(String(query || ''))
    const pool = []
    for (const f of factsOf(roomId)) pool.push({ kind: '事实', text: f.text, at: f.at || 0 })
    for (const a of readArchive(dir, 800)) pool.push({ kind: '归档', text: a.text, at: a.at || 0 })
    const t = roomTextOf(dir)
    for (const line of String(t.summary || '').split(/\n+/)) if (line.trim()) pool.push({ kind: '摘要', text: line.trim(), at: 0 })
    for (const line of String(t.relations || '').split(/\n+/)) if (line.trim()) pool.push({ kind: '关系', text: line.trim(), at: 0 })
    if (!pool.length) return []
    if (!kws.length) return pool.slice(-limit).reverse()
    const scored = pool
      .map((x) => ({ x, s: kws.filter((k) => x.text.includes(k)).length }))
      .filter((y) => y.s > 0)
      .sort((a, b) => b.s - a.s || (b.x.at || 0) - (a.x.at || 0))
    return scored.slice(0, Math.max(1, limit)).map((y) => y.x)
  }

  /** 群内关系分析：把最近的历史拉下来，让模型总结"谁和谁什么关系"。 */
  async function updateRelations(r) {
    const dir = memDirOf(r.roomId)
    if (!dir) return { ok: false, error: '该会话不在记忆托管名单里' }
    if (!r.isGroup) return { ok: false, error: '私聊没有"群内关系"可分析' }
    let msgs = []
    try {
      const data = await ob.call('get_group_msg_history', { group_id: r.roomId, count: 200 }, 12000)
      msgs = (data?.messages || []).map((m) => normalizeEvent(m, ob.status.self?.user_id)).filter((e) => e.text)
    } catch {
      msgs = r.msgs.slice(-200)
    }
    if (msgs.length < 10) return { ok: false, error: '消息太少（不足 10 条），多聊几句再分析' }
    const transcript = msgs
      .slice(-150)
      .map((m) => `${m.isSelf ? '我' : m.senderName}: ${m.text}`)
      .join('\n')
    const facts = factsOf(r.roomId).map((f) => '- ' + f.text).join('\n')
    const user = [
      '下面是这个群的聊天记录（"我"=机器人自己）。分析群成员之间的关系。',
      facts ? '已知事实：\n' + facts : '',
      '',
      transcript,
      '',
      '输出 Markdown，只写这几节：',
      '## 核心成员（谁活跃、大概的角色）',
      '## 互动关系（谁跟谁常对话、亲疏、有没有小圈子）',
      '## 相处方式（语气、玩笑尺度、明显禁忌）',
      '## 不确定的地方',
      '只写记录里能看出来的，不要编造真实身份；证据不足就写"看不出"。',
    ]
      .filter(Boolean)
      .join('\n')
    const { text: rawText, finish } = await analyze('你是群聊关系分析器，只输出 Markdown 正文。', user)
    const text = rawText.slice(0, 2500)
    if (!text) {
      log(`关系分析返回空（finish=${finish || '?'}）`)
      return { ok: false, error: `模型返回空（finish=${finish || '?'}，可能预算不够）` }
    }
    writeTextSafe(relationsPath(dir), text)
    invalidateRoomText(dir)
    // 顺手更新结构化关系图（纯统计，不花 token）
    try {
      writeJson(graphPath(dir), buildRelationGraph(r, msgs))
    } catch {
      /* ignore */
    }
    patchMeta(dir, { relationsAt: Date.now() })
    log(`关系分析已更新：${r.roomName || r.roomId}（${text.length} 字，样本 ${msgs.length} 条）`)
    return { ok: true, text, sample: msgs.length }
  }

  /** 启动清理：非托管会话的目录一律删掉（只保留名单里的）。 */
  function pruneUnmanagedMemory() {
    let removed = 0
    for (const info of listRooms(MEMORY_DIR)) {
      const id = String(info.meta?.roomId || String(info.slug || '').replace(/^(group|private)-/, ''))
      if (config.memoryRooms.includes(id)) continue
      try {
        rmSync(info.dir, { recursive: true, force: true })
        removed += 1
      } catch {
        /* ignore */
      }
    }
    if (removed) log(`记忆清理：移除 ${removed} 个非托管会话的目录`)
    return removed
  }

  /** 私聊管理员时，得告诉模型"对方就是管理员本人"，否则画像会把他拆成两个人。 */
  function whoHint(r) {
    if (!r.isGroup && config.adminQQ.includes(String(r.roomId))) {
      return '（注意：这是管理员本人的私聊；对话里的"管理员"和对方是同一个人，不要写成两个人。）'
    }
    return ''
  }

  /** 分析类调用统一走这里：预算给足 + 压低推理档（不支持就回退），空结果要能说清原因。 */
  async function analyze(system, user) {
    const req = { system, user, maxTokens: 2600, temperature: 0.3, reasoningEffort: 'low' }
    let out
    try {
      out = await generate(req)
    } catch (e) {
      out = await generate({ ...req, reasoningEffort: undefined })
    }
    return { text: String(out.text || '').trim(), finish: out.finish?.kind || '' }
  }

  /** 关系图（结构化）：节点=人，边=相邻发言的互动次数。不依赖模型，纯统计。 */
  function buildRelationGraph(r, msgs) {
    const nodes = new Map()
    const edges = new Map()
    let prev = ''
    for (const m of msgs) {
      const id = m.isSelf ? 'self' : String(m.sender)
      const name = m.isSelf ? '我' : m.senderName || id
      const n = nodes.get(id) || { id, name, msgs: 0 }
      n.msgs += 1
      n.name = name
      nodes.set(id, n)
      if (prev && prev !== id) {
        const key = prev < id ? `${prev}|${id}` : `${id}|${prev}`
        edges.set(key, (edges.get(key) || 0) + 1)
      }
      prev = id
    }
    const nodeList = [...nodes.values()]
      .filter((n) => n.msgs >= 2)
      .sort((a, b) => b.msgs - a.msgs)
      .slice(0, 12)
    const allowed = new Set(nodeList.map((n) => n.id))
    const edgeList = [...edges.entries()]
      .map(([k, w]) => {
        const [a, b] = k.split('|')
        return { a, b, w }
      })
      .filter((e) => allowed.has(e.a) && allowed.has(e.b))
      .sort((x, y) => y.w - x.w)
      .slice(0, 24)
    return { at: Date.now(), nodes: nodeList, edges: edgeList }
  }

  /** 导出某个会话的记忆目录（写一份 JSON 到 exports/，同时返回内容供面板下载）。 */
  function exportMemory(roomId) {
    const id = String(roomId)
    const dir = memDirOf(id)
    if (!dir) return { ok: false, error: '该会话不在记忆托管名单里' }
    const files = {}
    for (const name of [
      'meta.json',
      'facts.json',
      'archive.jsonl',
      'profile.md',
      'summary.md',
      'relations.md',
      'relations.json',
    ]) {
      const p = join(dir, name)
      if (existsSync(p)) files[name] = readFileSync(p, 'utf8')
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const outDir = join(DATA_DIR, 'exports')
    mkdirSync(outDir, { recursive: true })
    const outFile = join(outDir, `memory-${roomSlug(id, isGroupRoom(id))}-${stamp}.json`)
    writeJson(outFile, { exportedAt: new Date().toISOString(), roomId: id, dir, files })
    log(`记忆导出：${id} → ${outFile}`)
    return { ok: true, file: outFile, files }
  }

  /** 滚动摘要：把旧摘要和最近对话合并成一段，长期保留"之前聊过什么"。 */
  async function updateSummary(r) {
    const dir = memDirOf(r.roomId)
    if (!dir) return { ok: false, error: '该会话不在记忆托管名单里' }
    const old = readRoomText(dir).summary
    const recent = r.msgs.slice(-80)
    if (recent.length < 8 && !old) return { ok: false, error: '消息太少（不足 8 条，且没有旧摘要）' }
    const user = [
      whoHint(r),
      old ? '已有摘要：\n' + old : '',
      '',
      '最近的对话：',
      recent.map((m) => `${m.isSelf ? '我' : m.senderName}: ${m.text}`).join('\n'),
      '',
      '把已有摘要和最近对话合并成一段不超过 400 字的中文摘要：保留人物、关系、约定、正在进行的事；去掉寒暄和重复；不要逐句复述。只输出摘要正文。',
    ]
      .filter(Boolean)
      .join('\n')
    const { text: rawText, finish } = await analyze('你是聊天摘要器，只输出摘要正文。', user)
    const text = rawText.slice(0, 900)
    if (!text) {
      log(`摘要返回空（finish=${finish || '?'}）`)
      return { ok: false, error: `模型返回空（finish=${finish || '?'}）` }
    }
    writeTextSafe(summaryPath(dir), text)
    invalidateRoomText(dir)
    patchMeta(dir, { summaryAt: Date.now() })
    log(`摘要已更新：${r.roomName || r.roomId}（${text.length} 字）`)
    return { ok: true, text }
  }

  /** 人物画像：谁在这里、关系、性格、禁忌——长期维持"关系感"。 */
  async function updateProfile(r) {
    const dir = memDirOf(r.roomId)
    if (!dir) return { ok: false, error: '该会话不在记忆托管名单里' }
    const list = factsOf(r.roomId)
    if (!list.length) return { ok: false, error: '还没有事实可整理（先提炼或手动加几条）' }
    const old = readRoomText(dir).profile
    const user = [
      whoHint(r),
      old ? '现有画像：\n' + old : '',
      '',
      '已知事实：',
      list.slice(-40).map((f) => '- ' + f.text).join('\n'),
      '',
      '最近聊天片段：',
      r.msgs.slice(-20).map((m) => `${m.isSelf ? '我' : m.senderName}: ${m.text}`).join('\n'),
      '',
      '输出 5~10 行中文画像：这里有哪些人、你和他们的关系、各人的性格与偏好、禁忌/别踩的点、这里的常用梗。不要编造，没把握的别写。只输出画像正文。',
    ]
      .filter(Boolean)
      .join('\n')
    const { text: rawText, finish } = await analyze('你是人物画像整理器，只输出画像正文。', user)
    const text = rawText.slice(0, 1200)
    if (!text) {
      log(`画像返回空（finish=${finish || '?'}）`)
      return { ok: false, error: `模型返回空（finish=${finish || '?'}）` }
    }
    writeTextSafe(profilePath(dir), text)
    invalidateRoomText(dir)
    patchMeta(dir, { profileAt: Date.now(), profileFacts: list.length })
    log(`画像已更新：${r.roomName || r.roomId}（${text.length} 字）`)
    return { ok: true, text }
  }

  /** 自动提炼 / 摘要：只在托管会话里跑，攒够量且过冷却才触发。 */
  function maybeAutoExtract(r) {
    if (!isManagedRoom(r.roomId)) return
    const c = cfgFor(r.roomId)
    // 画像：只有显式开了 profileEvery 的群才自动重生成（默认 0=关，其他群不受影响）
    const everyProf = Number(c.profileEvery) || 0
    if (everyProf >= 10) {
      r.msgSinceProfile = (r.msgSinceProfile || 0) + 1
      if (r.msgSinceProfile >= everyProf && Date.now() - (r.lastProfileAt || 0) > 3600000 && !r.profileBusy) {
        r.msgSinceProfile = 0
        r.lastProfileAt = Date.now()
        r.profileBusy = true
        void updateProfile(r)
          .then((res) => { if (res?.ok) log(`自动画像：${r.roomName || r.roomId} 已更新`) })
          .catch((e) => log('自动画像失败：' + String(e?.message || e)))
          .finally(() => { r.profileBusy = false })
      }
    }
    // 摘要独立于提炼：每 N 条消息更新一次，至少隔 10 分钟
    r.msgSinceSummary = (r.msgSinceSummary || 0) + 1
    const everySum = Math.max(20, Number(c.memorySummaryEvery) || 80)
    if (r.msgSinceSummary >= everySum && Date.now() - (r.lastSummaryAt || 0) > 600000) {
      r.msgSinceSummary = 0
      r.lastSummaryAt = Date.now()
      void updateSummary(r).catch((e) => log('摘要更新失败：' + String(e?.message || e)))
    }
    // 关系分析：每 N 条消息刷新一次，至少隔 relationsCooldownMs（默认 7 天）
    r.msgSinceRelations = (r.msgSinceRelations || 0) + 1
    const everyRel = Math.max(50, Number(c.relationsEvery) || 300)
    const relCool = Math.max(3600000, Number(c.relationsCooldownMs) || 7 * 86400000)
    if (r.isGroup && r.msgSinceRelations >= everyRel && Date.now() - (r.lastRelationsAt || 0) > relCool) {
      r.msgSinceRelations = 0
      r.lastRelationsAt = Date.now()
      void updateRelations(r).catch((e) => log('关系分析失败：' + String(e?.message || e)))
    }
    if (!c.memoryExtract) return
    r.msgSinceExtract = (r.msgSinceExtract || 0) + 1
    const every = Math.max(5, Number(c.memoryExtractEvery) || 25)
    if (r.msgSinceExtract < every) return
    const cooldown = Math.max(600000, Number(c.memoryExtractCooldownMs) || 6 * 3600_000)
    if (r.lastExtractAt && Date.now() - r.lastExtractAt < cooldown) return
    r.msgSinceExtract = 0
    r.lastExtractAt = Date.now()
    void extractFacts(r.roomId)
      .then((res) => {
        if (res.ok && res.added) {
          log(`自动记忆：${r.roomName || r.roomId} 新增 ${res.added} 条`)
          // 事实有新增时，顺手把画像刷新一下（最多 3 天一次）
          const dir = memDirOf(r.roomId)
          if (dir) {
            const meta = readRoomMemory(dir).meta || {}
            if (!meta.profileAt || Date.now() - Number(meta.profileAt) > 3 * 86400000) {
              void updateProfile(r).catch((e) => log('画像更新失败：' + String(e?.message || e)))
            }
          }
        }
      })
      .catch((e) => log('自动记忆失败：' + String(e?.message || e)))
  }

  // 面板快照：房间没变化就复用上一次算好的对象（面板每 5 秒拉一次，43 个群时省不少拼接）
  const panelRoomCache = new Map() // roomId -> { sig, obj }
  function roomSnapshot(r) {
    const now = Date.now()
    const factsN = factsOf(r.roomId).length
    const ovN = countOverrides(roomOverrideOf(r.roomId))
    const replies10m = r.replyTimes.filter((t) => now - t < 600000).length
    const sig = [
      r.lastActivityAt, r.msgs.length, replies10m, r.lastReplyAt, factsN, ovN,
      r.lastDecision?.at || 0, r.muteUntil || 0, r.msgSinceExtract || 0, r.streak || 0,
      r.roomName || '', allowedHere(r) ? 1 : 0,
      Number(cfgFor(r.roomId).memoryExtractEvery) || 0, cfgFor(r.roomId).memoryExtract ? 1 : 0,
    ].join('|')
    const hit = panelRoomCache.get(r.roomId)
    if (hit && hit.sig === sig) return hit.obj
    const obj = {
      roomId: r.roomId,
      roomName: r.roomName,
      isGroup: r.isGroup,
      allowed: allowedHere(r),
      msgs: r.msgs.length,
      facts: factsN,
      memory: {
        sinceExtract: r.msgSinceExtract || 0,
        every: Number(cfgFor(r.roomId).memoryExtractEvery) || 30,
        lastExtractAt: r.lastExtractAt || 0,
        auto: !!cfgFor(r.roomId).memoryExtract,
      },
      lastActivityAt: r.lastActivityAt,
      lastReplyAt: r.lastReplyAt,
      proactiveStreak: r.streak || 0,
      decision: r.lastDecision,
      overrideCount: ovN,
      policy: {
        replies10m,
        maxRepliesPer10Min: Number(config.maxRepliesPer10Min) || 0,
      },
      recent: r.msgs.slice(-8).map((m) => ({
        ts: m.ts,
        isSelf: m.isSelf,
        who: m.isSelf ? '我' : m.senderName,
        text: m.text,
      })),
    }
    panelRoomCache.set(r.roomId, { sig, obj })
    return obj
  }

  function panelState() {
    return {
      ok: true,
      at: Date.now(),
      version,
      // 面板构建时间：用来判断浏览器是不是缓存了旧 UI（"按钮不见了"多半是这个）
      panelBuiltAt: (() => {
        try {
          const f = join(dirname(fileURLToPath(import.meta.url)), 'client.js')
          return existsSync(f) ? statSync(f).mtimeMs : 0
        } catch {
          return 0
        }
      })(),
      config,
      defaults: DEFAULT_CONFIG,
      meta: publicMeta(),
      groups: GROUPS,
      features: FEATURES,
      stats: { ...stats },
      connection: { ...ob.status },
      health: healthCache,
      usage: usageView(),
      rooms: [...rooms.values()].map(roomSnapshot),
      stickers: (() => {
        let good = 0
        let bad = 0
        for (const k in stickers) {
          if (stickers[k]?.bad) bad += 1
          else good += 1
        }
        return { count: good, total: good + bad, bad }
      })(),
      names: { known: [...rooms.values()].reduce((n, r) => n + r.nameCache.size, 0), groups: groupNames.size },
      paths: { config: CONFIG_FILE, log: LOG_FILE, facts: MEMORY_DIR, stickers: STICKERS_FILE },
      allowGroups: config.allowGroups,
    }
  }

  let panelDisposed = false
  ctx.effect(() => () => {
    panelDisposed = true
  })

  void (async () => {
    const getService = (n) => {
      try {
        return (typeof ctx.get === 'function' ? ctx.get(n) : null) ?? ctx[n] ?? null
      } catch {
        return null
      }
    }
    let mounted = false
    let tries = 0
    const mount = () => {
      if (panelDisposed || mounted) return
      const ws = getService('webServer')
      if (!ws || typeof ws.register !== 'function') {
        if (++tries <= 60) {
          const t = setTimeout(mount, 2000)
          if (t.unref) t.unref()
          return
        }
        log('没有 webServer 服务，面板跳过（机器人本体不受影响）')
        return
      }
      mounted = true
      try {
        ctx.effect(
          () => ws.register({ kind: 'prefix', path: '/qq-bot', handler: handleRequest }),
          'dsh-qq-bot: panel route',
        )
        log('面板已挂载：/qq-bot')
      } catch (e) {
        mounted = false
        log('面板挂载失败：' + String(e?.message || e))
      }
    }

    const json = (res, status, body) => {
      const s = JSON.stringify(body)
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(s),
      })
      res.end(s)
    }

    const readBody = (req, limit = 1024 * 1024) =>
      new Promise((resolve, reject) => {
        let size = 0
        const chunks = []
        req.on('data', (c) => {
          size += c.length
          if (size > limit) {
            reject(new Error('请求体太大'))
            req.destroy()
            return
          }
          chunks.push(c)
        })
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          if (!raw) return resolve({})
          try {
            resolve(JSON.parse(raw))
          } catch {
            reject(new Error('JSON 解析失败'))
          }
        })
        req.on('error', reject)
      })

    async function handleRequest(req, res) {
      let pathname = '/qq-bot'
      try {
        pathname = new URL(req.url || '/', 'http://x').pathname
      } catch {
        /* ignore */
      }
      const isApi = pathname === '/qq-bot/api' || pathname.startsWith('/qq-bot/api/')

      // 复用 DSH 的登录/同源栅栏
      try {
        const conn = getService('connection')
        if (conn && typeof conn.requestRejection === 'function') {
          const rej = conn.requestRejection({ headers: req.headers })
          if (rej !== undefined) {
            return json(res, rej === 401 ? 401 : 403, { ok: false, error: rej === 401 ? '未登录或登录已过期' : '来源不受信任' })
          }
        }
      } catch {
        /* 栅栏不可用时不阻塞（本地单用户） */
      }

      if (!isApi) {
        // 同一个面板也能直接当独立页面打开：把 CSS 内联进去（和 Client 半共用一份 HTML）
        let page = ''
        try {
          const here = dirname(fileURLToPath(import.meta.url))
          const html = readFileSync(join(here, '..', 'panel', 'index.html'), 'utf8')
          const css = readFileSync(join(here, '..', 'panel', 'panel.css'), 'utf8')
          page = html.replace(
            /<link rel="stylesheet" href="\.\/panel\.css">/,
            '<style>\n' + css + '\n</style>',
          )
        } catch (e) {
          return json(res, 500, { ok: false, error: '面板文件缺失：' + String(e?.message || e) })
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(page)
        return
      }

      const sub = pathname.slice('/qq-bot/api'.length) || '/'
      try {
        if (req.method === 'GET') {
          if (sub === '/state') return json(res, 200, panelState())
          if (sub === '/room-config') {
            const u = new URL(req.url, 'http://x')
            const room = String(u.searchParams.get('room') || '').replace(/^group:/, '')
            if (!room) return json(res, 400, { ok: false, error: '缺少 room' })
            const global = {}
            for (const k of ROOM_KEYS) global[k] = config[k]
            const override = roomOverrideOf(room)
            const effective = cfgFor(room)
            const eff = {}
            for (const k of ROOM_KEYS) eff[k] = effective[k]
            return json(res, 200, {
              ok: true,
              room,
              roomName: groupNames.get(room) || (rooms.get(room) || {}).roomName || '',
              keys: ROOM_KEYS,
              global,
              override,
              effective: eff,
              count: countOverrides(override),
            })
          }
          if (sub === '/health') return json(res, 200, { ok: true, health: await ob.health() })
          if (sub === '/export') {
            const dump = {}
            for (const k of CONFIG_KEYS) dump[k] = config[k]
            return json(res, 200, { ok: true, at: new Date().toISOString(), config: dump })
          }
          if (sub === '/thumb') {
            // 图库缩略图：本地缓存文件直接回给面板（收藏型的 url 常过期，不能直接当 img src）
            const u = new URL(req.url, 'http://x')
            const id = String(u.searchParams.get('id') || '')
            const s = stickers[id]
            if (!s) return json(res, 404, { ok: false, error: '图库里没有这张' })
            const file = s.file && existsSync(s.file) ? s.file : ''
            if (!file) return json(res, 404, { ok: false, error: '这张没有本地缓存' })
            try {
              const buf = readFileSync(file)
              const lower = String(file).toLowerCase()
              const type = lower.endsWith('.png')
                ? 'image/png'
                : lower.endsWith('.gif')
                  ? 'image/gif'
                  : lower.endsWith('.webp')
                    ? 'image/webp'
                    : 'image/jpeg'
              res.writeHead(200, { 'content-type': type, 'cache-control': 'private, max-age=3600' })
              res.end(buf)
              return
            } catch (e) {
              return json(res, 500, { ok: false, error: String(e?.message || e) })
            }
          }
          if (sub === '/logs') {
            const u = new URL(req.url, 'http://x')
            const lines = Math.max(20, Math.min(2000, Number(u.searchParams.get('lines')) || 200))
            return json(res, 200, { ok: true, file: LOG_FILE, lines, text: tailLines(LOG_FILE, lines) })
          }
          return json(res, 404, { ok: false, error: '未知接口' })
        }
        if (req.method === 'POST') {
          const ct = String(req.headers['content-type'] || '')
          if (!ct.includes('application/json')) return json(res, 415, { ok: false, error: '只接受 application/json' })
          let body
          try {
            body = await readBody(req)
          } catch (e) {
            return json(res, 400, { ok: false, error: '请求体解析失败：' + String(e?.message || e) })
          }
          if (sub === '/config') {
            const r = applyConfigPatch(body?.patch || {})
            log('面板改配置：' + JSON.stringify(r.applied))
            return json(res, r.ok ? 200 : 400, r)
          }
          if (sub === '/room-config') {
            const room = String(body?.room || '').replace(/^group:/, '')
            if (!room) return json(res, 400, { ok: false, error: '缺少 room' })
            if (!isAllowedGroup(room) && !rooms.has(room) && !groupNames.has(room)) {
              return json(res, 400, { ok: false, error: `未知群：${room}（先加进白名单，或等群里来条消息）` })
            }
            if (body?.reset) {
              const r = resetRoomOverride(room)
              log(`每群性格：${room} 已恢复跟随全局`)
              return json(res, 200, { ok: true, ...r })
            }
            const r = setRoomOverride(room, body?.overrides || {})
            log(`每群性格：${room} 覆盖 ${Object.keys(r.applied).length} 项`)
            return json(res, r.ok ? 200 : 400, r)
          }
          if (sub === '/import') {
            if (body?.confirm !== 'import') return json(res, 400, { ok: false, error: '导入需要 confirm:"import"' })
            const r = applyConfigPatch(body?.config || {})
            log('面板导入配置：' + JSON.stringify(Object.keys(body?.config || {})))
            return json(res, r.ok ? 200 : 400, r)
          }
          if (sub !== '/action') return json(res, 404, { ok: false, error: '未知接口' })

          const op = String(body?.op || '')
          const args = body?.args || {}
          const roomOf = (v) => String(v || '').replace(/^group:/, '').trim()

          switch (op) {
            case 'rereadConfig': {
              const r = rereadConfigFromDisk()
              log('重读配置：' + (r.changed.length ? r.changed.join(',') : '无变化'))
              return json(res, 200, { ok: true, result: r })
            }
            case 'reloadPlugin': {
              const r = reloadSelf(800)
              if (!r.ok) return json(res, 400, { ok: false, error: r.error })
              log('面板触发重载插件（约 0.8s 后）')
              return json(res, 200, { ok: true, result: { reloading: true, inMs: r.inMs } })
            }
            case 'reconnect': {
              await ob.start({
                homeDir: config.snowlumaHome,
                httpUrl: config.httpUrl,
                wsUrl: config.wsUrl,
                accessToken: config.accessToken,
              })
              return json(res, 200, { ok: true, result: { connection: ob.status } })
            }
            case 'usage':
              return json(res, 200, { ok: true, result: usageView() })
            case 'outbox':
              return json(res, 200, {
                ok: true,
                result: { count: outbox.count, items: outbox.list({ limit: 20 }) },
              })
            case 'flushOutbox':
              await flushOutbox()
              return json(res, 200, { ok: true, result: { count: outbox.count } })
            case 'selftest': {
              const roomId = roomOf(args.room)
              assertGroupAllowed(roomId)
              const data = await ob.call('get_group_msg_history', { group_id: roomId, count: 20 }, 8000)
              const self = String(ob.status.self?.user_id ?? '')
              let ev = null
              for (const m of data?.messages || []) {
                const cand = normalizeEvent(m, self)
                if (!cand.roomId || !cand.text) continue
                if (String(m?.user_id ?? '') === self) continue
                if (!ev || cand.ts >= ev.ts) ev = cand
              }
              if (!ev) return json(res, 400, { ok: false, error: '历史里没有别人发的文本消息可回放' })
              const r0 = roomState(roomId)
              r0.seen.delete(ev.id)
              const before = stats.replies
              const t0 = Date.now()
              void onEvent(ev).catch((e) => log('消息处理失败：' + String(e?.message || e)))
              for (let i = 0; i < 60; i++) {
                if (stats.replies > before) break
                await sleep(500)
              }
              return json(res, 200, {
                ok: true,
                result: {
                  replied: stats.replies > before,
                  totalMs: Date.now() - t0,
                  from: `${ev.senderName}: ${String(ev.text).slice(0, 60)}`,
                  firstTokenMs: stats.lastFirstTokenMs,
                  modelMs: stats.lastLatencyMs,
                },
              })
            }
            case 'selfcheck':
              return json(res, 200, { ok: true, result: await selfcheck() })
            case 'say':
            case 'sendText': {
              const roomId = roomOf(args.room)
              assertGroupAllowed(roomId)
              const text = String(args.text || '').trim()
              if (!text) return json(res, 400, { ok: false, error: 'text 为空' })
              if (config.dryRun) return json(res, 200, { ok: true, result: { dryRun: true } })
              const sayRes = await sendWithRetry(roomId, true, 'text', text)
              if (sayRes.queued) return json(res, 200, { ok: true, result: { queued: true, error: sayRes.error } })
              stats.sends += 1
              return json(res, 200, { ok: true, result: { sent: text } })
            }
            case 'ask': {
              const roomId = roomOf(args.room)
              assertGroupAllowed(roomId)
              const r0 = roomState(roomId)
              const rc = cfgFor(roomId)
              const prompt = String(args.prompt || '').trim() || r0.msgs[r0.msgs.length - 1]?.text || '在吗'
              const user = [
                buildTranscript(r0, Number(rc.contextMessages) || 20),
                '',
                `现在有人对你说：「${prompt}」`,
                '自然地回一句。',
              ].join('\n')
              const t0 = Date.now()
              const out = await generate({ system: systemPrompt(r0), user })
              const sent = await sendReply(r0, { text: out.text, priority: 'at', atUser: args.user })
              return json(res, 200, {
                ok: true,
                result: { firstTokenMs: out.firstTokenMs, totalMs: Date.now() - t0, sent },
              })
            }
            case 'clearRoom': {
              const r0 = rooms.get(roomOf(args.room))
              if (r0) {
                r0.msgs.length = 0
                r0.replyTimes.length = 0
                r0.lastReplyAt = 0
                r0.repliedTexts = []
              }
              return json(res, 200, { ok: true, result: { cleared: true } })
            }
            case 'rooms':
              return json(res, 200, {
                ok: true,
                result: [...rooms.values()].map((r) => ({
                  roomId: r.roomId,
                  name: r.roomName || groupNames.get(r.roomId) || r.roomId,
                  allowed: allowedHere(r),
                  msgs: r.msgs.length,
                })),
              })
            case 'history': {
              const r0 = roomState(roomOf(args.room))
              const n = Math.max(1, Math.min(100, Number(args.limit) || 30))
              return json(res, 200, {
                ok: true,
                result: r0.msgs.slice(-n).map((m) => ({
                  ts: m.ts,
                  who: m.isSelf ? '我' : m.senderName,
                  text: m.text,
                })),
              })
            }
            case 'searchMessages': {
              const roomId = roomOf(args.room)
              // 只允许翻白名单群的历史：其它群一律不碰（读也不行）
              assertGroupAllowed(roomId)
              const q = String(args.query || '').trim()
              if (!q) return json(res, 400, { ok: false, error: 'query 为空' })
              const data = await ob.call('get_group_msg_history', { group_id: roomId, count: 200 }, 10000)
              const hits = []
              for (const m of data?.messages || []) {
                const ev = normalizeEvent(m, ob.status.self?.user_id)
                if (!ev.text || !ev.text.includes(q)) continue
                hits.push({ ts: ev.ts, who: ev.senderName, text: ev.text })
              }
              return json(res, 200, { ok: true, result: hits.slice(-50) })
            }
            case 'memory.list':
              return json(res, 200, {
                ok: true,
                result: { room: roomOf(args.room), facts: factsOf(roomOf(args.room)) },
              })
            case 'memory.add': {
              const ok = addFact(roomOf(args.room), args.add)
              return json(res, 200, { ok: true, result: { added: ok, facts: factsOf(roomOf(args.room)) } })
            }
            case 'memory.del': {
              const ok = delFact(roomOf(args.room), args.text)
              return json(res, 200, { ok: true, result: { deleted: ok, facts: factsOf(roomOf(args.room)) } })
            }
            case 'autostart.get':
              return json(res, 200, {
                ok: true,
                result: {
                  enabled: isAutostartEnabled(),
                  file: autostartFile(),
                  dir: startupDir(),
                  snowlumaHome: config.snowlumaHome,
                },
              })
            case 'autostart.set': {
              const want = args.enabled === true || args.enabled === 'true' || args.enabled === 1
              try {
                const r = setAutostart(want, config.snowlumaHome)
                log('开机自启：' + (r.enabled ? '已开启' : '已关闭') + '（' + r.file + '）')
                return json(res, 200, { ok: true, result: r })
              } catch (e) {
                return json(res, 400, { ok: false, error: String(e?.message || e) })
              }
            }
            case 'backup.now': {
              try {
                return json(res, 200, { ok: true, result: backupNow() })
              } catch (e) {
                return json(res, 500, { ok: false, error: String(e?.message || e) })
              }
            }
            case 'backup.list':
              return json(res, 200, { ok: true, result: { names: backupList() } })
            case 'backup.restore': {
              try {
                return json(res, 200, { ok: true, result: { ...backupRestore(String(args.name || '')), reloaded: true } })
              } catch (e) {
                return json(res, 400, { ok: false, error: String(e?.message || e) })
              }
            }
            case 'curve.get': {
              const rid = roomOf(args.room)
              const r0 = roomState(rid)
              const f = getFeatures().curvePathFor(r0)
              const data = r0.curve || (f ? readJson(f, {}) : {})
              const days = Object.keys(data).sort().slice(-14).map((d) => ({
                day: d,
                m: data[d]?.m || {},
                bond: Number(data[d]?.bond) || 0,
                msgs: Number(data[d]?.msgs) || 0,
              }))
              return json(res, 200, { ok: true, result: { days, moods: Object.keys(MOODS) } })
            }
            case 'memory.update': {
              // 单条记忆就地修改：内容可改，创建时间保留，另记 editedAt
              const rid = roomOf(args.room)
              if (!isManagedRoom(rid)) return json(res, 400, { ok: false, error: '该会话未纳入记忆托管' })
              const oldText = String(args.old || '')
              const newText = String(args.text || '').trim()
              if (!newText) return json(res, 400, { ok: false, error: '内容不能为空' })
              const list = loadFacts(rid)
              const normOld = factNorm(oldText)
              const idx = list.findIndex((x) => factNorm(x.text) === normOld)
              if (idx < 0) return json(res, 404, { ok: false, error: '没找到这条记忆（可能已被删除）' })
              const normNew = factNorm(newText)
              if (list.some((x, i) => i !== idx && factNorm(x.text) === normNew)) {
                return json(res, 400, { ok: false, error: '已经有一条一样的了' })
              }
              list[idx] = { ...list[idx], text: newText, editedAt: Date.now() }
              facts[rid] = list
              writeRoomFacts(memDirOf(rid), list, { keep: 60 })
              log(`记忆已修改：${rid}`)
              return json(res, 200, { ok: true, result: { facts: list } })
            }
            case 'memory.clear': {
              const rid = roomOf(args.room)
              facts[rid] = []
              writeRoomFacts(memDirOf(rid), [], { keep: 60 })
              return json(res, 200, { ok: true, result: { facts: [] } })
            }
            case 'memory.extract': {
              const r = await extractFacts(roomOf(args.room))
              return json(res, 200, { ok: true, result: r })
            }
            case 'memory.profile': {
              const rid = roomOf(args.room)
              const dir = memDirOf(rid)
              if (!dir) return json(res, 400, { ok: false, error: '该会话未纳入记忆托管名单' })
              const t = readRoomText(dir)
              const meta = readRoomMemory(dir).meta || {}
              return json(res, 200, { ok: true, result: { dir, profile: t.profile, summary: t.summary, relations: t.relations, meta } })
            }
            case 'memory.regenProfile': {
              const res2 = await updateProfile(roomState(roomOf(args.room)))
              return json(res, res2.ok ? 200 : 400, { ok: res2.ok, result: res2 })
            }
            case 'memory.regenSummary': {
              const res2 = await updateSummary(roomState(roomOf(args.room)))
              return json(res, res2.ok ? 200 : 400, { ok: res2.ok, result: res2 })
            }
            case 'memory.regenRelations': {
              const res2 = await updateRelations(roomState(roomOf(args.room)))
              return json(res, res2.ok ? 200 : 400, { ok: res2.ok, result: res2 })
            }
            case 'memory.export': {
              const out = exportMemory(roomOf(args.room))
              return json(res, out.ok ? 200 : 400, { ok: out.ok, result: out })
            }
            case 'memory.graph': {
              const rid = roomOf(args.room)
              const dir = memDirOf(rid)
              if (!dir) return json(res, 400, { ok: false, error: '该会话未纳入记忆托管名单' })
              const g = readJson(graphPath(dir), null)
              return json(res, 200, { ok: true, result: g })
            }
            case 'memory.search': {
              const rid = roomOf(args.room)
              const q = String(args.query || '').trim()
              if (!q) return json(res, 400, { ok: false, error: 'query 为空' })
              return json(res, 200, { ok: true, result: searchMemory(rid, q, 10) })
            }
            case 'members': {
              const roomId = roomOf(args.room)
              // 和 searchMessages 一致：只读也限定在白名单群
              assertGroupAllowed(roomId)
              const list = await ob.groupMembers(roomId)
              const r0 = roomState(roomId)
              for (const m of list) {
                const nm = String(m.card || m.nickname || '').trim()
                if (nm) r0.nameCache.set(String(m.user_id), nm)
              }
              return json(res, 200, {
                ok: true,
                result: list.map((m) => ({
                  uid: String(m.user_id),
                  name: String(m.card || m.nickname || m.user_id),
                  role: m.role || '',
                })),
              })
            }
            case 'names.set': {
              const rid = roomOf(args.room)
              const r0 = roomState(rid)
              const uid = String(args.uid || '')
              const nm = String(args.name || '')
              if (uid) {
                r0.nameCache.set(uid, nm)
                savedNames[rid] = savedNames[rid] || {}
                if (nm) savedNames[rid][uid] = nm
                else delete savedNames[rid][uid]
                writeJson(NAMES_FILE, savedNames)
              }
              return json(res, 200, { ok: true })
            }
            case 'names.save': {
              // 面板「群成员」里一次保存多个昵称
              const rid = roomOf(args.room)
              const r0 = roomState(rid)
              const list = Array.isArray(args.list) ? args.list : []
              savedNames[rid] = savedNames[rid] || {}
              let n = 0
              for (const item of list) {
                const uid = String(item?.uid || '')
                if (!uid) continue
                const nm = String(item?.name || '').trim()
                r0.nameCache.set(uid, nm)
                if (nm) savedNames[rid][uid] = nm
                else delete savedNames[rid][uid]
                n += 1
              }
              writeJson(NAMES_FILE, savedNames)
              return json(res, 200, { ok: true, result: { count: n, names: savedNames[rid] } })
            }
            case 'names.add': {
              // 只补显示名（没有 QQ 号时按顺序贴，仅影响面板展示）
              const r0 = roomState(roomOf(args.room))
              let i = 0
              for (const nm of String(args.names || '').split(/[,，、\s]+/).filter(Boolean)) {
                r0.nameCache.set(`manual:${i++}`, nm)
              }
              return json(res, 200, { ok: true, result: { count: r0.nameCache.size } })
            }
            case 'stickers': {
              const limit = Math.max(1, Math.min(200, Number(args.limit) || 80))
              return json(res, 200, {
                ok: true,
                result: Object.entries(stickers)
                  .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
                  .slice(0, limit)
                  .map(([id, s]) => ({
                    id,
                    url: s.url,
                    from: s.from || '',
                    uses: s.uses || 0,
                    subType: s.subType || 0,
                    bad: !!s.bad,
                    favorite: !!s.emojiId,
                    hasFile: !!(s.file && existsSync(s.file)),
                  })),
              })
            }
            case 'pickSticker': {
              const keys = Object.keys(stickers).filter((k) => !stickers[k].bad)
              if (!keys.length) return json(res, 200, { ok: true, result: null })
              const k = keys[Math.floor(Math.random() * keys.length)]
              return json(res, 200, { ok: true, result: { id: k, url: stickers[k].url } })
            }
            case 'sendSticker': {
              const roomId = roomOf(args.room)
              assertGroupAllowed(roomId)
              const s = stickers[String(args.stickerId || '')]
              if (!s) return json(res, 400, { ok: false, error: '图库里没有这张' })
              if (s.bad) return json(res, 400, { ok: false, error: '这张已失效（QQ 图片链接过期），换一张吧' })
              if (config.dryRun) return json(res, 200, { ok: true, result: { dryRun: true } })
              const stRes = await sendStickerTo(roomId, s, String(args.stickerId || ''))
              if (!stRes.ok) return json(res, stRes.bad ? 400 : 500, { ok: false, error: stRes.error })
              if (stRes.queued) return json(res, 200, { ok: true, result: { queued: true, error: stRes.error } })
              return json(res, 200, { ok: true })
            }
            default:
              return json(res, 400, { ok: false, error: '未知操作：' + op })
          }
        }
        return json(res, 405, { ok: false, error: 'method not allowed' })
      } catch (e) {
        return json(res, 500, { ok: false, error: String(e?.message || e) })
      }
    }

    mount()
  })()

  // ── 启动 ──────────────────────────────────────────────
  let disposed = false
  ctx.effect(() => () => {
    disposed = true
  }, 'dsh-qq-bot: disposed flag')
  ob.onEvent((ev) => {
    void onEvent(ev).catch((e) => log('事件处理失败：' + String(e?.message || e)))
  })

  // 轮询兜底：本机实测 SnowLuma 的 WS 只推心跳、不推群消息，所以白名单群改用
  // get_group_msg_history 对齐。启动时先建基线（只记录、不回旧消息），之后才处理新消息。
  let polling = false

  /**
   * 历史消息 → 事件。私聊必须传 peerId：
   * 私聊历史里机器人自己发的那条，user_id 是机器人自己，直接归一化会把房间建成"我自己的号"。
   */
  function ingestHistory(messages, peerId) {
    const out = []
    const selfId = String(ob.status.self?.user_id ?? '')
    for (const m of messages || []) {
      try {
        const ev = normalizeEvent(m, selfId)
        if (peerId && String(m?.message_type) === 'private') {
          ev.roomId = String(peerId)
          ev.isGroup = false
          ev.sender = String(m?.user_id ?? '')
          if (ev.sender === selfId) ev.isSelf = true
        }
        if (ev.roomId) out.push(ev)
      } catch {
        /* 单条坏了跳过 */
      }
    }
    return out
  }

  async function primeAllowed() {
    // 只把「冷消息」当基线吞掉：插件重载/短暂离线期间进来的消息仍然算新消息，
    // 否则用户刚发的「在」会被静默错过（实测踩过）。
    const cutoff = Date.now() - Math.max(60000, (Number(config.pollMs) || 3000) * 3)

    function absorb(r, messages, peerId) {
      let fresh = 0
      for (const ev of ingestHistory(messages, peerId)) {
        const isFresh = ev.ts >= cutoff
        if (typeof ev.isGroup === 'boolean') r.isGroup = ev.isGroup
        if (ev.id && !isFresh) r.seen.add(ev.id)
        if (isFresh) fresh += 1
        r.msgs.push({
          id: ev.id,
          ts: ev.ts,
          sender: ev.sender,
          senderName: ev.senderName || ev.sender,
          isSelf: ev.isSelf,
          isAtMe: ev.isAtMe,
          text: ev.text,
          images: ev.images,
        })
      }
      if (r.msgs.length > 200) r.msgs.splice(0, r.msgs.length - 200)
      r.lastActivityAt = r.msgs.length ? r.msgs[r.msgs.length - 1].ts : 0
      return fresh
    }

    for (const gid of config.allowGroups) {
      try {
        const data = await ob.call('get_group_msg_history', { group_id: gid, count: 10 }, 8000)
        const r = roomState(gid)
        r.isGroup = true
        const fresh = absorb(r, data?.messages)
        log(`基线：群 ${gid} 已有 ${r.msgs.length} 条（吞掉旧消息，保留 ${fresh} 条待处理）`)
      } catch (e) {
        log(`基线读取失败 ${gid}：${String(e?.message || e)}`)
      }
    }
    // 私聊没有 WS 推送，必须靠轮询；这里先建基线，避免一启动就回一堆旧消息
    for (const uid of privateTargets()) {
      try {
        const data = await ob.call('get_friend_msg_history', { user_id: uid, count: 10 }, 8000)
        const r = roomState(uid)
        r.isGroup = false
        const fresh = absorb(r, data?.messages, uid)
        log(`基线：私聊 ${uid} 已有 ${r.msgs.length} 条（保留 ${fresh} 条待处理）`)
      } catch (e) {
        log(`私聊基线读取失败 ${uid}：${String(e?.message || e)}`)
      }
    }
  }

  /** 私聊轮询目标：白名单 + 管理员。 */
  function privateTargets() {
    return [...new Set([...config.allowPrivate, ...config.adminQQ].map(String).filter(Boolean))]
  }

  // ── 轮询兜底（推送可用时它只是保险）────────────────────
  let pollTimer = null
  function startPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      timers.delete(pollTimer)
      pollTimer = null
    }
    const ms = Number(config.pollMs) || 0
    if (!(ms > 0)) {
      log('轮询已关闭（pollMs=0）：只靠 HTTP 推送')
      return
    }
    pollTimer = setInterval(safeTick('轮询', () => pollOnce()), Math.max(200, ms))
    if (pollTimer.unref) pollTimer.unref()
    timers.add(pollTimer)
    log(
      `轮询兜底已开：每 ${ms}ms 拉一次（群 ${config.allowGroups.join(',') || '无'}｜私聊 ${privateTargets().join(',') || '无'}）`,
    )
  }

  async function pollOnce() {
    if (polling || !config.pollMs) return
    if (!config.allowGroups.length && !privateTargets().length) return
    polling = true
    try {
      // 3 个群 + 1 个私聊并行拉，别串行等四次往返
      await Promise.all([
        ...config.allowGroups.map(async (gid) => {
          try {
            const data = await ob.call('get_group_msg_history', { group_id: gid, count: 10 }, 8000)
            for (const ev of ingestHistory(data?.messages)) {
              void onEvent(ev).catch((e) => log('消息处理失败：' + String(e?.message || e)))
            }
          } catch {
            /* 单群失败不影响其它 */
          }
        }),
        ...privateTargets().map(async (uid) => {
          try {
            const data = await ob.call('get_friend_msg_history', { user_id: uid, count: 10 }, 8000)
            for (const ev of ingestHistory(data?.messages, uid)) {
              void onEvent(ev).catch((e) => log('私聊消息处理失败：' + String(e?.message || e)))
            }
          } catch {
            /* 单个私聊失败不影响其它 */
          }
        }),
      ])
    } finally {
      polling = false
    }
  }

  // ── HTTP 推送（SnowLuma httpClients → 这里），比轮询快 0~3 秒 ──
  let pushServer = null
  function stopPushServer() {
    if (!pushServer) return
    try {
      pushServer.close()
    } catch {
      /* ignore */
    }
    pushServer = null
  }
  function startPushServer() {
    stopPushServer()
    if (!config.pushEnabled) return
    const port = Math.max(1024, Math.min(65535, Number(config.pushPort) || 3101))
    const secret = String(config.pushSecret || '')
    const server = createServer((req, res) => {
      stats.pushHits = (stats.pushHits || 0) + 1
      if (req.method !== 'POST') {
        res.writeHead(405)
        res.end()
        return
      }
      const ra = String(req.socket.remoteAddress || '')
      if (!/^(::1$|::ffff:127\.|127\.)/.test(ra)) {
        res.writeHead(403)
        res.end()
        return
      }
      if (secret && String(req.headers.authorization || '') !== `Bearer ${secret}`) {
        res.writeHead(401)
        res.end()
        return
      }
      let body = ''
      let tooBig = false
      req.on('data', (c) => {
        body += c
        if (body.length > 2_000_000) {
          tooBig = true
          try {
            req.destroy()
          } catch {
            /* ignore */
          }
        }
      })
      req.on('end', () => {
        res.writeHead(204)
        res.end()
        if (tooBig) return
        try {
          const parsed = JSON.parse(body)
          const list = Array.isArray(parsed) ? parsed : [parsed]
          let n = 0
          for (const raw of list) {
            if (!raw || raw.post_type !== 'message') continue
            const peerId = raw.message_type === 'private' ? String(raw.user_id || '') : ''
            for (const ev of ingestHistory([raw], peerId)) {
              if (!ev.roomId) continue
              void onEvent(ev).catch((e) => log('推送处理失败：' + String(e?.message || e)))
              n += 1
            }
          }
          if (n) stats.pushed = (stats.pushed || 0) + n
        } catch (e) {
          log('推送解析失败：' + String(e?.message || e))
        }
      })
    })
    server.on('error', (e) => log(`推送端口 ${port} 监听失败：${String(e?.message || e)}`))
    server.listen(port, '127.0.0.1', () => log(`HTTP 推送已监听 127.0.0.1:${port}（SnowLuma httpClients → /qq-bot/push）`))
    pushServer = server
  }

  ctx.effect(() => () => {
    stopPushServer()
  }, 'dsh-qq-bot: push server')

  ctx.effect(() => () => {
    flushStateNow() // 退出前把攒着的 replied/usage 落盘
    flushStickersNow() // 表情库同理
    ob.stop()
    for (const t of timers) clearTimeout(t)
    timers.clear()
  }, 'dsh-qq-bot: lifecycle')

  void (async () => {
    try {
      const d = await ob.start({
        homeDir: config.snowlumaHome,
        httpUrl: config.httpUrl,
        wsUrl: config.wsUrl,
        accessToken: config.accessToken,
      })
      if (d.ok) {
        if (disposed) {
          ob.stop()
          return
        }
        log(`已接入 SnowLuma：${d.http.url}｜账号 ${d.self?.nickname}（${d.self?.user_id}）｜WS ${d.ws?.url || '未配置'}`)
        // 群名缓存（只读）
        try {
          const gs = await ob.groups()
          for (const g of gs) {
            const rid = String(g.group_id ?? '')
            if (rid) groupNames.set(rid, String(g.group_name || ''))
          }
          log(`已读到 ${gs.length} 个群（授权群：${gs.filter((g) => isAllowedGroup(g.group_id)).map((g) => g.group_name).join('、') || '无'}）`)
        } catch (e) {
          log('读群列表失败：' + String(e?.message || e))
        }
        // 旧版"一个 facts.json 装所有群" → 每个会话一个文件夹
        try {
          const mig = migrateLegacy(
            MEMORY_DIR,
            FACTS_FILE,
            (id) => groupNames.has(String(id)) || config.allowGroups.includes(String(id)),
          )
          if (mig.migrated) {
            log(`记忆迁移：${mig.rooms} 个会话 / ${mig.migrated} 条 → ${MEMORY_DIR}`)
            try {
              renameSync(FACTS_FILE, FACTS_FILE + '.legacy')
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          log('记忆迁移失败：' + String(e?.message || e))
        }
        pruneUnmanagedMemory()
        await primeAllowed()
        startPushServer()
        // 自检必须在连上之后跑，否则会把"还没连上"误报成异常
        void selfcheck().catch(() => {})
        if (Number(config.pollMs) > 0) {
          startPolling()
        } else {
          log('轮询已关闭（pollMs=0）：只靠 WS 推送')
        }
        // 图库本地化：把还没存到本地的图刷一遍（QQ 链接会过期）
        void sweepStickerLibrary().catch((e) => log('图库本地化失败：' + String(e?.message || e)))
        // 重发队列：连上后先清一次，之后每 15 秒扫一遍
        void flushOutbox()
        const obTimer = setInterval(safeTick('重发队列', () => flushOutbox()), 15000)
        if (obTimer.unref) obTimer.unref()
        timers.add(obTimer)
        if (outbox.count) log(`重发队列里有 ${outbox.count} 条待发`)
      } else {
        log('接入失败：' + (d.error || '未知'))
      }
    } catch (e) {
      log('启动异常：' + String(e?.message || e))
    }
  })()

  // 定时任务统一兜底：回调里抛异常只记日志，绝不让未捕获异常把 DSH 宿主带崩
  function safeTick(name, fn) { return () => {
    try {
      const r = fn()
      if (r && typeof r.catch === 'function') r.catch((e) => log('定时任务失败（' + name + '）：' + String(e?.message || e)))
    } catch (e) {
      log('定时任务失败（' + name + '）：' + String(e?.message || e))
    }
  } }
  const pt = setInterval(safeTick('主动找人', proactiveTick), 5 * 60_000)
  // 提醒到点检查（每 30 秒）
  reminderTimer = setInterval(safeTick('提醒检查', () => getFeatures().checkReminders()), 30000)
  if (reminderTimer.unref) reminderTimer.unref()
  // 每日日记：每 10 分钟看一次是不是该写了
  const diaryTimer = setInterval(safeTick('每日日记', () => getFeatures().maybeDiary()), 10 * 60_000)
  const backupTimer = setInterval(safeTick('每日备份', () => backupTick()), 60 * 60_000)
  if (backupTimer.unref) backupTimer.unref()
  const bondTimer = setInterval(safeTick('亲密度/曲线落盘', () => {
    for (const rr of rooms.values()) if (rr.bondDirty) getFeatures().saveBond(rr)
    getFeatures().flushCurves()
  }), 60_000)
  if (diaryTimer.unref) diaryTimer.unref()
  if (pt.unref) pt.unref()
  timers.add(pt)

  // 定期自检，让面板上的「健康」不是一直"未检查"
  const healthTimer = setInterval(
    safeTick('自检', () => selfcheck()),
    Math.max(30000, Number(config.healthCheckMs) || 300000),
  )
  if (healthTimer.unref) healthTimer.unref()
  timers.add(healthTimer)

  log(
    `插件已启动 v${version}｜开关=${config.enabled ? '开' : '关'}｜白名单群=${config.allowGroups.join(',')}｜` +
      `闲聊概率=${config.replyProbability}｜冷却=${Math.round(config.minReplyGapMs / 1000)}s｜配置=${CONFIG_FILE}`,
  )
}

// 便于单测/诊断：把内部使用的解析函数暴露出去（不影响插件装配）
export const _internal = { DEFAULT_CONFIG }

