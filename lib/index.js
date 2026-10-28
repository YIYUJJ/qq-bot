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
import { spawn } from 'node:child_process'
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
import { installProcessGuards, safe, safeAsync, wrapTool, recentErrors } from './safe.mjs'
import { atomicWriteJson, acquireInstanceLock } from './store.mjs'
import { createMetrics, newTraceId } from './metrics.mjs'
import { createRuntime } from './runtime.mjs'
import { createStickerStore } from './sticker-store.mjs'
import { createStateStore } from './state-store.mjs'
import { createStateInit } from './state-init.mjs'
import { createRoomConfig } from './rooms.mjs'
import { createRoomState } from './rooms.mjs'
import { createAccess } from './rooms.mjs'
import { createMediaCache } from './media.mjs'
import { openStateDb } from './state-store.mjs'
import { createVisionCache } from './vision-cache.mjs'
import { createAdminCommands } from './admin-commands.mjs'
import { createNoticeHandler } from './notices.mjs'
import { createPushServer } from './push-server.mjs'
import { createIngest } from './ingest.mjs'
import { createApiHandler } from './http-api.mjs'
import { createPanelState } from './panel.mjs'
import { createRoomSnapshot } from './panel.mjs'
import { createSelfcheck } from './selfcheck.mjs'
import { createFlush } from './flush.mjs'
import { createOnEvent } from './on-event.mjs'
import { createPolling } from './polling.mjs'
import { createScheduler } from './scheduler.mjs'
import { registerAllTools } from './register-tools.mjs'
import { createStartup } from './startup.mjs'
import { createBackup } from './ops.mjs'
import { createMemoryStore } from './memory-store.mjs'
import { createMemoryAi } from './memory-ai.mjs'
import { createModel } from './model.mjs'
import { createModelRoute } from './model.mjs'
import { createNotes } from './notes.mjs'
import { createDecision } from './decision.mjs'
import { createPrompt, MOODS } from './prompt.mjs'
import { createConfigStore } from './config-store.mjs'
import { createOps } from './ops.mjs'
import { createStickerNet } from './sticker-net.mjs'
import { createAdminFlow } from './admin-flow.mjs'
import { createVisionChain } from './vision.mjs'
import { createVideoChain } from './video-chain.mjs'
import { createVideoFiles } from './media.mjs'
import { createPanelMount } from './panel-mount.mjs'
import { createMaybeAutoExtract } from './memory-auto.mjs'
import { createSendReply } from './send-reply.mjs'
import { startTimers } from './timers.mjs'
import { DEFAULT_CONFIG, CONFIG_KEYS, BOOLEAN, NUMERIC, LIST, validateConfig } from './schema.mjs'
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

export function apply(ctx, rawConfig) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const CONFIG_FILE = join(dshHome, 'qq-bot', 'config.json')
  const DATA_DIR = join(dshHome, 'qq-bot')
  const LOG_FILE = join(DATA_DIR, 'bot.log')
  const BACKUP_DIR = join(DATA_DIR, 'backups')
  const BACKUP_STATE_FILE = join(DATA_DIR, 'backup-state.json')
  const ROOMS_FILE = join(DATA_DIR, 'rooms.json')
  // 指标 + 结构化事件（事件日志单独一个文件，方便排查单条消息链路）
  const metrics = createMetrics({ version, logFile: join(DATA_DIR, 'events.jsonl') })

  mkdirSync(DATA_DIR, { recursive: true })

  // 运行时状态集中管理（rooms/stats/timers/groupNames）
  const runtime = createRuntime()

  const { rooms, stats, timers, groupNames } = runtime

  // 定时器兜底（poll 等直接建定时器的地方也用它）
  const safeTick = (name, fn) => safe('timer:' + name, fn)
  // 最后一道防线：未捕获异常只记录、不带崩 DSH（热重载不会重复安装）
  installProcessGuards(log)

  // 配置子系统交给 lib/config-store.mjs（副作用用 hooks 注入）
  const configStore = createConfigStore({
    file: CONFIG_FILE, defaults: DEFAULT_CONFIG, validateConfig,
    keys: CONFIG_KEYS, booleanSet: BOOLEAN, numericSet: NUMERIC, listSet: LIST, meta: CONFIG_META,
    log,
    hooks: {
      onVisionRouteDirty: () => { visionRoute = null },
      onPushRestart: () => { try { startPushServer() } catch { /* ignore */ } },
      onPollRestart: () => { try { startPolling() } catch { /* ignore */ } },
      onQuietChanged: (q) => { quietWindows = parseQuietWindows(q) },
      bumpCfg: () => bumpCfg(),
      reloadRoomOverrides: () => applyRoomOverridesFromDisk(),
    },
  })
  configStore.load(rawConfig)
  const config = configStore.config
  const { saveConfig, applyConfigPatch, rereadConfigFromDisk } = configStore
  for (const w of configStore.warnings) log("配置校验：" + w)

  // 运维工具交给 lib/ops.mjs
  const ops = createOps({
    BACKUP_DIR, DATA_DIR, config, getKeywords: () => keywordsOf, log,
    getOb: () => ob,
    version, getSoftReload: () => softReload,
  })
  const { backupRestore, searchHistory, tailLines, writeJson, connectInfo } = ops

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



  // 模型路由交给 lib/model-route.mjs
  const modelRoute = createModelRoute({
    config, ctx, log,
    getVisionRoute: () => visionRoute,
    setVisionRoute: (v) => { visionRoute = v },
  })
  const { resolveModel, resolveVisionRoute } = modelRoute

  // 状态容器（持久化对象）交给 lib/state-init.mjs
  const stateInit = createStateInit({
    DATA_DIR, config, getIsAllowedGroup: () => isAllowedGroup, log, mediaKey: (u) => mediaKey(u), getOb: () => ob, shouldRetrySend, stats, writeJson,
  })
  const {
    readJson, hashStr, FACTS_FILE, STICKERS_FILE, USAGE_FILE, REPLIED_FILE, NAMES_FILE,
    MEMORY_DIR, STICKER_DIR, OUTBOX_FILE, facts, stickers, stickerStore, markStickersDirty,
    flushStickersNow, rememberSticker, usage, replied, savedNames, stateStore, flushStateNow,
    markStateDirty, recordReplied, alreadyReplied, noteUsage, usageView, outbox, sendWithRetry,
    enqueueSend, deliverOutboxItem, flushOutbox,
  } = stateInit

  // ── 每群性格覆盖（稀疏覆盖，未覆盖的键跟全局走）────────
  // 会话状态（lib/rooms.mjs）
  const roomStateApi = createRoomState({ groupNames, replied, rooms, savedNames })
  const { roomState } = roomStateApi

  // 每群配置运行时（lib/rooms.mjs）
  const roomCfg = createRoomConfig({
    config, countOverrides, filterRoomOverride, mergeRoomConfig, parseQuietWindows, readJson,
    roomsFile: ROOMS_FILE, writeJson,
  })
  const { cfgFor, bumpCfg, quietWindowsFor, roomOverrideOf, setRoomOverride, resetRoomOverride } = roomCfg

  /** 外部改过 rooms.json 后重读（config-store 的 hook 用）。 */
  function applyRoomOverridesFromDisk() {
    try {
      const ro = JSON.parse(readFileSync(ROOMS_FILE, "utf8"))
      roomCfg.replaceRoomOverrides(ro)
    } catch {
      /* ignore */
    }
  }


  /** 延迟重载本插件（走 hmr 的 profile 重组，跟插件管理器开关是同一套机制）。 */
  function reloadSelf(delayMs = 500) {
    // 没有代码变化时 hmr 只会做一次空重组（进程不重启），内存里的画像/事实缓存就不会刷新。
    // 所以这里主动清缓存：手改过 memory/ 下的 md/json 也能立刻读到。
    try {
      memoryStore.clearRoomTextCache()
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

  // 访问控制（白名单闸，lib/rooms.mjs）
  const access = createAccess({ config, getCfgFor: () => cfgFor })
  const { isAllowedGroup, assertGroupAllowed, allowedHere, mustReply } = access

  // ── 运行时状态 ────────────────────────────────────────
  let quietWindows = parseQuietWindows(config.quietHours)
  // 管理员指令的规则解析/描述/归一化交给 lib/admin-commands.mjs
  const adminCommands = createAdminCommands({ rooms, groupNames, config })
  const { findRoomByText, detectIntents, parseAdminCommand, describeAdminAction, normalizePlannedActions } = adminCommands



  // 识图缓存 / 媒体 key（lib/media.mjs）
  const media = createMediaCache({ DATA_DIR, config, log, readJson, writeJson })
  const { vision, visionCache, visionKey, trimVisionCache, mediaKey, guessMediaType } = media
  let visionBroken = '' // 同类失败只记一次日志，避免每条图都刷屏

  /** 解析视觉路由：配置优先；配的不可用就自动挑一个支持图片的模型。 */
  let visionRoute = null

  /** 一次视觉请求。返回纯文本描述。 */

  /** 图 URL → 一句描述（带 7 天磁盘缓存；失败返回 ''，不抛）。 */

  /** 给一条消息补上图片描述（就地改 text，供上下文使用）。 */


  // ── 更多玩法：提醒 / 网页摘要 / 文档 ─────────────────────
  /** 软重载：把磁盘上的配置/覆盖/记忆/提醒/投票重新读进内存（不重启插件） */

  /** 立即备份：配置 + 记忆（跳过临时/表情/依赖目录） */
  /** 只保留最近 N 份备份 */
  /**
   * 重启 DSH：写一个独立脚本，由它延迟 2 秒后结束 DSH 再拉起来。
   * 为什么绕一层：直接在本进程里 kill 会把脚本自己也带走，没人负责重启。
   */

  const REMINDERS_FILE = join(DATA_DIR, 'reminders.json')
  const reminders = readJson(REMINDERS_FILE, []) // [{id, roomId, at, text}]
  const docLibDir = join(DATA_DIR, 'pylib')
  let reminderTimer = null

  // ── 视频：抽帧拼图 + 链接取信息 ───────────────────────────
  const VIDEO_CACHE_FILE = join(DATA_DIR, 'video-cache.json')
  const videoCache = readJson(VIDEO_CACHE_FILE, {})

  /** 同一条视频的稳定 key：URL 去掉 query（QQ 的 CDN token 每次都变），本地文件用 路径+大小+时间 */
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

  // 视频临时目录 / ffmpeg 路径（lib/media.mjs）
  const videoFiles = createVideoFiles({ DATA_DIR, config, log })
  const { VIDEO_DIR, ffmpegBin, ffprobeBin } = videoFiles

  /** 把一段图片数据丢给视觉模型，返回一句描述 */

  /** 群里的视频：下载 → 抽 6 帧拼图 → 视觉模型看一眼 → 一句话描述 */


  const POLLS_FILE = join(DATA_DIR, 'polls.json')
  const polls = readJson(POLLS_FILE, {}) // roomId -> { q, options: [], votes: {sender: idx}, at }

  // 备份/重启交给 lib/backup.mjs
  const backupMod = createBackup({
    BACKUP_DIR, BACKUP_STATE_FILE, CONFIG_FILE, CONFIG_KEYS, DATA_DIR,
    POLLS_FILE, REMINDERS_FILE, ROOMS_FILE, bumpCfg, config,
    facts, log, polls, readJson, reminders,
    roomTextCache: { clear: () => memoryStore.clearRoomTextCache() }, writeJson,
    setRoomOverrides: (o) => roomCfg.replaceRoomOverrides(o),
    getSleep: () => sleep,
  })
  const { softReload, backupNow, pruneBackups, restartDsh, backupTick, backupList } = backupMod

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

  /**
   * 把"看过的视频"提炼成一条长期记忆（只留最近几条，别把记忆撑爆）。
   * info 有标题时用标题，否则用画面描述。
   */

  /** 消息里的视频链接：yt-dlp 抓标题/时长/简介/字幕，拼成一段上下文 */

  // ── 联网搜索（用户明确让它查时才查）────────────────────

  /** 认出"让我去搜"的意图并抽出查询词；没有就返回 ''。 */

  /** 不把隐私/链接发给搜索引擎。（@我 / @昵称 是归一化占位，不算账号） */




  /** 给一次回复准备搜索材料：冷却 + 隐私 + 超时 + 失败降级。 */

  const track = (t) => {
    timers.add(t)
    return t
  }
  const untrack = (t) => {
    timers.delete(t)
    clearTimeout(t)
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // 测试接缝：集成测试可以注入假 OneBot / 假 LLM（生产环境永远走真实实现）
  const testHooks = (rawConfig && rawConfig.__test) || null
  const ob = (testHooks && testHooks.onebot) || new OneBot({ log })
  const llm = (testHooks && testHooks.llm) || ctx.llm
  // 模型调用封装交给 lib/model.mjs
  const HIST_STOP = new Set(['的', '了', '是', '我', '你', '他', '她', '它', '吗', '呢', '吧', '啊', '这', '那', '个', '就', '也', '都', '和', '在'])
  const model = createModel({
    config, createUserMessage, llm, log, metrics,
    noteUsage, resolveModel, stats, track, untrack,
    HIST_STOP,
  })
  const { generate, analyze, keywordsOf, whoHint } = model


  // 原始消息归一化交给 lib/ingest.mjs
  const ingestHistory = createIngest({ normalizeEvent, getSelfId: () => ob.status.self?.user_id })
  // 撤回/拍一拍交给 lib/notices.mjs（副作用通过依赖注入）
  const noticeHandler = createNoticeHandler({
    ob,
    config,
    log,
    roomState,
    cfgFor,
    allowedHere,
    setMood: (r, n, i) => setMood(r, n, i),
    scheduleFlush,
  })
  const { handleNotice } = noticeHandler


  // 群名缓存（只读，来自 get_group_list）；rooms 只装"真的收到过消息"的会话
  let noticeShapes = 0



  /** 这条消息是不是"必须回"：私聊管理员，或该群开了必回。 */





  // 长期记忆存储层交给 lib/memory-store.mjs
  const memoryStore = createMemoryStore({ config, rooms, groupNames, facts, memoryDir: MEMORY_DIR, log, keywordsOf })
  const { isGroupRoom, isManagedRoom, memDirOf, loadFacts, factsOf, factNorm, addFact, delFact, pickFacts, roomTextOf, invalidateRoomText, similarity } = memoryStore

  // 提示词拼装交给 lib/prompt.mjs
  const prompt = createPrompt({
    config, cfgFor, getFeatures, isManagedRoom, memDirOf, pickFacts, roomTextOf,
  })
  const { moodName, inferMood, buildTranscript, systemPrompt, setMood } = prompt

  // ── 管理员私聊遥控（指令 → 确认 → 执行）────────────────
  // 管理员遥控流程交给 lib/admin-flow.mjs
  const adminFlow = createAdminFlow({
    config, describeAdminAction, generate, groupNames, isAllowedGroup,
    log, metrics, normalizePlannedActions, ob, parseAdminCommand,
    roomOverrides: roomCfg.getRoomOverrides(), roomState, sendWithRetry, setRoomOverride, sleep,
    stats, systemPrompt,
  })
  const { handleAdminCommand, executeAdminAction, planAdminCommand, replyAdmin } = adminFlow


  // ── 事件 ──────────────────────────────────────────────
  // 链接/搜索笔记交给 lib/notes.mjs
  const notes = createNotes({ config, log, stats, cfgFor, isManagedRoom, factsOf, addFact, delFact, ctx })
  const { buildWebLinkNote, buildVideoLinkNote, buildSearchNote, extractSearchQuery, sensitiveQuery, webSearch, rememberVideo } = notes


  // 视觉链路交给 lib/vision.mjs
  const visionChain = createVisionChain({
    config, createUserMessage, ctx, guessMediaType, llm,
    log, noteUsage, resolveVisionRoute, track, trimVisionCache,
    untrack, usage, vision, visionCache, visionKey,
    getVisionBroken: () => visionBroken,
    setVisionBroken: (v) => { visionBroken = v },
  })
  const { generateVision, describeBuffer, describeImage, attachVision } = visionChain

  // 视频链路交给 lib/video-chain.mjs
  const videoChain = createVideoChain({
    config, log, describeBuffer, ffmpegBin, ffprobeBin,
    VIDEO_DIR, hashStr, videoCache, VIDEO_CACHE_FILE, writeJson,
  })
  const { describeVideo, videoKey, videoCacheGet, videoCacheSet } = videoChain

  // 表情包网络链路交给 lib/sticker-net.mjs
  const stickerNet = createStickerNet({
    config, log, ob, roomState, sendWithRetry,
    sleep, stats, stickers, STICKER_DIR, hashStr,
    mediaKey, markStickersDirty,
  })
  const { ensureStickerFile, favoriteSticker, sendStickerTo, sweepStickerLibrary } = stickerNet

  // onEvent 交给 lib/on-event.mjs
  const onEvent = createOnEvent({
    VIDEO_DIR, allowedHere, attachVision, cfgFor, config,
    describeVideo, docLibDir, ensureStickerFile, favoriteSticker, getFeatures,
    handleNotice, inferMood, log, metrics, ob,
    rememberSticker, rememberVideo, roomState, scheduleFlush, stats,
    stickers,
  })



  // 回复决策交给 lib/decision.mjs
  const decision = createDecision({ config, cfgFor })
  const { priorityOf, normText, decide } = decision


  // ── 情绪状态（拟人用，纯规则，不花 token）──────────────────
  // 每种心情带一个"说话长度倾向"和一句给模型的状态描述

  /** 从一句话里推断心情：先看内容，再看时间（深夜容易困） */

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



  /** 一次流式调用。返回 { text, firstTokenMs, totalMs, usage }。 */

  /** 启动后把还没本地化的图库条目刷一遍：能下就存，过期就标记作废。 */

  /**
   * 把收到的表情加进账号的收藏表情（服务端持久化）。
   * 这是"存得住"的关键：QQ 的图片 URL 几小时就过期，收藏表情不会。
   */

  /**
   * 发一张图库表情：① 收藏表情（原生气泡）→ ② 本地文件 → ③ 原 URL。
   * 不做"失败再换一种方式重试"——QQ 的失败可能是"其实已送达但回报失败"，重试会发两遍。
   */

  /**
   * 文字之后偶尔补一张群里的图。一次回复最多一张，受冷却约束。
   * 抽出来单独用，是因为流式首段会把整段说完（没有尾段），那时候也要有机会补图。
   */
  async function maybeSendSticker(r, c) {
    if (!r.isGroup) return false
    const cool = Math.max(0, Number(c.stickerCooldownMs) || 0)
    if (Date.now() - (r.lastStickerAt || 0) < cool) return false
    if (Math.random() >= Number(c.stickerChance)) return false
    const keys = Object.keys(stickers).filter((k) => !stickers[k].bad && Number(stickers[k].subType || 0) >= 1)
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
  // sendReply 交给 lib/send-reply.mjs
  const sendReply = createSendReply({
    assertGroupAllowed, cfgFor, cleanReply, config, enqueueSend,
    gapMs, log, maybeSendSticker, metrics, normText,
    ob, shouldRetrySend, sleep, splitMessage, stats,
  })

  // 「提往事」才去翻历史：没这几个词就不查，省一次请求
  const HISTORY_HINT = /(上次|之前|那天|昨天|前天|早说|说过|提过|记得|还记得|历史|上回)/
  // 提到"记得/上次"时，托管会话会先翻自己的长期记忆（facts + 归档 + 摘要 + 关系）
  const RECALL_HINT = /(记得|还记得|上次|上回|之前|以前|那次|说过|提过|我们聊过)/
  // 中文没有空格，整段当一个词会永远搜不到；切成 2 字窗口再匹配。




  // 记忆模型侧交给 lib/memory-ai.mjs
  const memoryAi = createMemoryAi({
    isGroupRoom,
    DATA_DIR, addFact, analyze, buildRelationGraph, config,
    factsOf, generate, graphPath, invalidateRoomText, isManagedRoom,
    keywordsOf, log, memDirOf, normalizeEvent, ob,
    patchMeta, readArchive, relationsPath, roomState, roomTextOf,
    whoHint, writeJson, writeTextSafe,
  })
  const { extractFacts, searchMemory, updateRelations, exportMemory, updateSummary, updateProfile } = memoryAi


  // maybeAutoExtract 交给 lib/memory-auto.mjs
  const maybeAutoExtract = createMaybeAutoExtract({
    memDirOf, readRoomMemory,
    cfgFor, extractFacts, isManagedRoom, log, updateProfile,
    updateRelations, updateSummary,
  })

  // flush 交给 lib/flush.mjs
  const flush = createFlush({
    HISTORY_HINT, RECALL_HINT, buildSearchNote, buildTranscript, buildVideoLinkNote,
    buildWebLinkNote, cfgFor, config, decide, extractSearchQuery,
    generate, getFeatures, handleAdminCommand, humanizeText, isManagedRoom,
    isQuiet, log, maybeAutoExtract, maybeSendSticker, metrics,
    moodName, mustReply, pickCanned, pickLineTarget, pickVideoLinks,
    pickWebLink, priorityOf, quietWindowsFor, recordReplied, rememberVideo,
    rmSync, searchHistory, searchMemory, sendReply, sleep,
    stats, systemPrompt, newTraceId,
  })

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


  // ── 工具 ──────────────────────────────────────────────
  const textOut = {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  }

  function safeRegister(def) {
    // 工具执行抛错时转成错误文本，不把异常抛给宿主
    def = wrapTool(def, log)
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

































  // ── Web 面板 API（挂在 DSH 自己的 webServer 上）──────────
  // ── 自检 ──────────────────────────────────────────────
  let healthCache = null
  // 自检交给 lib/selfcheck.mjs（healthCache 通过 getHealth/setHealth 显式读写）
  const selfcheck = createSelfcheck({
    ob, config, groupNames, resolveModel, getLlm: () => ctx.get?.('llm'), logFile: LOG_FILE,
    getHealth: () => healthCache,
    setHealth: (h) => { healthCache = h },
  })

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

  /** 分析类调用统一走这里：预算给足 + 压低推理档（不支持就回退），空结果要能说清原因。 */

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
  // 面板快照：房间没变化就复用上一次算好的对象（面板每 5 秒拉一次，43 个群时省不少拼接）
  const panelRoomCache = new Map() // roomId -> { sig, obj }
  // 房间快照交给 lib/room-snapshot.mjs
  const roomSnapshot = createRoomSnapshot({
    factsOf, countOverrides, roomOverrideOf, allowedHere, cfgFor, config, panelRoomCache,
  })

  // 面板数据交给 lib/panel-state.mjs
  const panelState = createPanelState({
    version, DEFAULT_CONFIG, publicMeta, GROUPS, FEATURES, ob,
    CONFIG_FILE, LOG_FILE, MEMORY_DIR, STICKERS_FILE, config, facts, features, groupNames, healthCache, log,
    roomSnapshot, rooms, stats, stickers, usage, usageView,
  })

    const getService = (n) => {
    try {
      return (typeof ctx.get === 'function' ? ctx.get(n) : null) ?? ctx[n] ?? null
    } catch {
      return null
    }
  }

const handleRequest = createApiHandler({
    backupRestore, memDirOf,
    DATA_DIR, LOG_FILE, MOODS, NAMES_FILE, STICKERS_FILE, addFact, allowedHere, applyConfigPatch,
    assertGroupAllowed, backupList, backupNow, buildTranscript, cfgFor, config, delFact, exportMemory,
    extractFacts, factNorm, facts, factsOf, flushOutbox, generate, getFeatures, groupNames,
    isAllowedGroup, isManagedRoom, loadFacts, log, markStickersDirty, metrics, ob, onEvent,
    outbox, panelState, readJson, reloadSelf, replied, rereadConfigFromDisk, resetRoomOverride, restartDsh,
    roomOverrideOf, roomState, rooms, savedNames, searchMemory, selfcheck, sendReply, sendStickerTo,
    sendWithRetry, setRoomOverride, sleep, stats, stickers, systemPrompt, tailLines, updateProfile,
    updateRelations, updateSummary, usage, usageView, writeJson,
    getService, memDirOf,
  })

  // 面板挂载（webServer 注册 + 重试）交给 lib/panel-mount.mjs
  createPanelMount({ ctx, log, handler: handleRequest })


  // ── 启动 ──────────────────────────────────────────────
  // 单实例锁：两个 DSH 同时跑会重复回复、互相写坏数据；抢不到锁就退化成只读
  const instanceLock = acquireInstanceLock(join(DATA_DIR, 'instance.lock'), { label: 'dsh-qq-bot' })
  if (!instanceLock.ok) {
    log('⚠️ 另一个实例正在运行（PID ' + (instanceLock.holder?.pid || '?') + '），本实例进入只读模式（不回复、不写数据）')
    config.enabled = false
  }

  let disposed = false
  ctx.effect(() => () => {
    disposed = true
    try { instanceLock.release() } catch { /* ignore */ }
  }, 'dsh-qq-bot: disposed flag')
  ob.onEvent((ev) => {
    void safeAsync('event:' + (ev?.postType || 'message'), () => onEvent(ev))
  })

  // 轮询兜底：本机实测 SnowLuma 的 WS 只推心跳、不推群消息，所以白名单群改用
  // get_group_msg_history 对齐。启动时先建基线（只记录、不回旧消息），之后才处理新消息。

  /**
   * 历史消息 → 事件。私聊必须传 peerId：
   * 私聊历史里机器人自己发的那条，user_id 是机器人自己，直接归一化会把房间建成"我自己的号"。
   */


  /** 私聊轮询目标：白名单 + 管理员。 */

  // ── 轮询兜底（推送可用时它只是保险）────────────────────


  // ── HTTP 推送（SnowLuma httpClients → 这里），比轮询快 0~3 秒 ──

  // 轮询兜底交给 lib/polling.mjs
  const polling = createPolling({ config, ob, ingestHistory, onEvent, roomState, log })
  const { primeAllowed, pollOnce, privateTargets } = polling

  // 运行期调度交给 lib/scheduler.mjs
  const scheduler = createScheduler({
    config, rooms, cfgFor, allowedHere, isQuiet,
    quietWindowsFor, generate, systemPrompt, buildTranscript, humanizeText,
    sendReply, log, safeTick, timers, pollOnce,
    privateTargets,
  })
  const { proactiveTick, inHours, startPolling, stopPolling } = scheduler



  // 推送接收端交给 lib/push-server.mjs（安全边界集中在一处）
  const push = createPushServer({ config, log, stats, onEvent, ingestHistory })
  const startPushServer = () => push.start()
  const stopPushServer = () => push.stop()
  const getPushServer = () => push.server

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

  // 启动序列交给 lib/startup.mjs
  const startup = createStartup({
    ob, config, log, groupNames, isAllowedGroup,
    migrateLegacy, MEMORY_DIR, FACTS_FILE, pruneUnmanagedMemory, primeAllowed,
    startPushServer, selfcheck, startPolling, sweepStickerLibrary, flushOutbox,
    outbox, safeTick, timers,
    getDisposed: () => disposed,
  })
  void startup.run()

  // 后台定时任务交给 lib/timers.mjs（统一 safe 包装 + 统一清理）
  const lifecycle = startTimers({
    safe,
    timers,
    config,
    handlers: {
      proactive: () => proactiveTick(),
      reminders: () => getFeatures().checkReminders(),
      diary: () => getFeatures().maybeDiary(),
      backup: () => backupTick(),
      bond: () => {
        for (const rr of rooms.values()) if (rr.bondDirty) getFeatures().saveBond(rr)
        getFeatures().flushCurves()
      },
      health: () => selfcheck(),
    },
  })
  ctx.effect(() => () => lifecycle.stop(), 'dsh-qq-bot: timers')

  // 工具注册交给 lib/register-tools.mjs
    // 工具注册交给 lib/register-tools.mjs
  registerAllTools(ctx, safeRegister, {
    BACKUP_STATE_FILE, CONFIG_KEYS, LOG_FILE, REMINDERS_FILE, STICKERS_FILE, STICKER_DIR,
    addFact, allowedHere, applyConfigPatch, assertGroupAllowed, autostartFile,
    backupList, backupNow, backupRestore, backupTick, buildSearchNote, buildTranscript,
    buildVideoLinkNote, cfgFor, config, connectInfo,
    decide, delFact, describeAdminAction, describeImage, describeVideo, detectTrigger,
    discover, existsSync, exportMemory, extractFacts, extractSearchQuery,
    factNorm, facts, factsOf, flushOutbox, generate, getFeatures,
    graphPath, groupNames, isAutostartEnabled, isManagedRoom, llm,
    loadFacts, log, markStickersDirty, memDirOf,
    moodName, mustReply, normText, normalizeEvent, normalizePlannedActions, ob,
    onEvent, ops, outbox, panelState,
    parseAdminCommand, pickCanned, pickLineTarget, pickVideoLinks, planAdminCommand, push,
    readDiary, readJson, readRoomText, readSelf, reloadSelf,
    rememberVideo, reminders, rereadConfigFromDisk, resetRoomOverride, resolveVisionRoute,
    restartDsh, rmSync, roomOverrideOf, roomState, rooms, searchHistory,
    searchMemory, selfcheck, sendReply, sendStickerTo, sendWithRetry,
    sensitiveQuery, setAutostart, setRoomOverride, sleep, stats,
    stickers, sweepStickerLibrary, systemPrompt, tailLines,
    textOut, updateProfile, updateRelations, updateSummary, usageView,
    webSearch, writeJson, writeRoomFacts,
  })

  log(
    `插件已启动 v${version}｜开关=${config.enabled ? '开' : '关'}｜白名单群=${config.allowGroups.join(',')}｜` +
      `闲聊概率=${config.replyProbability}｜冷却=${Math.round(config.minReplyGapMs / 1000)}s｜配置=${CONFIG_FILE}`,
  )
}

// 便于单测/诊断：把内部使用的解析函数暴露出去（不影响插件装配）
export const _internal = { DEFAULT_CONFIG }

