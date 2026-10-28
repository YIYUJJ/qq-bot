/**
 * 工具注册：把各 tools-*.mjs 工厂产出的工具挂到 ctx 上。
 *
 * 纯装配，不含业务逻辑；依赖通过 d 传入。
 */
import { statusTools } from './tools-status.mjs'
import { diagnosticTools } from './tools-diagnostics.mjs'
import { readTools } from './tools-read.mjs'
import { inspectTools } from './tools-inspect.mjs'
import { stickerTools } from './tools-stickers.mjs'
import { actionTools } from './tools-actions.mjs'
import { configTools } from './tools-config.mjs'
import { contentTools } from './tools-content.mjs'
import { videoTools } from './tools-media.mjs'
import { simulateTools } from './tools-simulate.mjs'
import { opsTools } from './tools-ops.mjs'
import { replyTools } from './tools-reply.mjs'
import { miscTools } from './tools-misc.mjs'
import { selftestTools } from './tools-selftest.mjs'
import { memoryTools } from './tools-memory.mjs'
import { panelTools } from './tools-panel.mjs'

export function registerAllTools(ctx, safeRegister, d) {
  const { BACKUP_STATE_FILE, CONFIG_KEYS, LOG_FILE, REMINDERS_FILE, STICKERS_FILE, STICKER_DIR, addFact, allowedHere, applyConfigPatch, assertGroupAllowed, autostartFile, backupList, backupNow, backupRestore, backupTick, buildSearchNote, buildTranscript, buildVideoLinkNote, cfgFor, config, connectInfo, decide, delFact, describeAdminAction, describeImage, describeVideo, detectTrigger, discover, existsSync, exportMemory, extractFacts, extractSearchQuery, factNorm, facts, factsOf, flushOutbox, generate, getFeatures, graphPath, groupNames, isAutostartEnabled, isManagedRoom, loadFacts, log, markStickersDirty, memDirOf, moodName, mustReply, normText, normalizeEvent, normalizePlannedActions, ob, onEvent, outbox, panelState, parseAdminCommand, pickCanned, pickLineTarget, pickVideoLinks, planAdminCommand, push, readDiary, readJson, readRoomText, readSelf, reloadSelf, rememberVideo, reminders, rereadConfigFromDisk, resetRoomOverride, resolveVisionRoute, restartDsh, rmSync, roomOverrideOf, roomState, rooms, searchHistory, searchMemory, selfcheck, sendReply, sendStickerTo, sendWithRetry, sensitiveQuery, setAutostart, setRoomOverride, sleep, stats, stickers, sweepStickerLibrary, systemPrompt, tailLines, textOut, updateProfile, updateRelations, updateSummary, usageView, webSearch, writeJson, writeRoomFacts } = d
  // 只读诊断工具交给 lib/tools-status.mjs
  for (const tool of statusTools({
    connectInfo, stats, config, push, rooms, groupNames, allowedHere, mustReply, factsOf, cfgFor, textOut,
  })) {
    ctx.effect(() => safeRegister(tool))
  }


  // 诊断工具（模型路由/图库）交给 lib/tools-diagnostics.mjs
  for (const tool of diagnosticTools({ getLlm: () => ctx.get?.('llm'), stickers, existsSync, textOut, ob, discover, config })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 只读查看工具（历史/重发队列）交给 lib/tools-read.mjs
  for (const tool of readTools({ rooms, outbox, flushOutbox, textOut })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 调试查看工具（系统提示词/提醒）交给 lib/tools-inspect.mjs
  for (const tool of inspectTools({
    roomState, systemPrompt, factsOf, isManagedRoom, cfgFor, moodName, pickLineTarget, textOut,
    reminders, getFeatures, writeJson, remindersFile: REMINDERS_FILE,
  })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 图库维护工具交给 lib/tools-stickers.mjs
  for (const tool of stickerTools({
    stickers, writeJson, stickersFile: STICKERS_FILE, markStickersDirty, log, rmSync, existsSync,
    sweepStickerLibrary, stickerDir: STICKER_DIR, textOut,
  })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 轻量动作工具（拍一拍/联网搜索）交给 lib/tools-actions.mjs
  for (const tool of actionTools({ assertGroupAllowed, config, ob, sensitiveQuery, webSearch, textOut })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 配置类工具（每群覆盖/管理员指令预览）交给 lib/tools-config.mjs
  for (const tool of configTools({
    resetRoomOverride, setRoomOverride, roomOverrideOf, cfgFor,
    parseAdminCommand, describeAdminAction, planAdminCommand, normalizePlannedActions, config, textOut,
  })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 内容类工具（日记/识图）交给 lib/tools-content.mjs
  for (const tool of contentTools({
    getFeatures, isManagedRoom, memDirOf, readDiary, readSelf, rooms,
    describeImage, config, assertGroupAllowed, roomState, textOut,
  })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 视频工具交给 lib/tools-media.mjs
  for (const tool of videoTools({
    assertGroupAllowed, cfgFor, config, pickVideoLinks, buildVideoLinkNote,
    rememberVideo, roomState, describeVideo, rmSync, textOut,
  })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 调试注入工具交给 lib/tools-simulate.mjs
  for (const tool of simulateTools({ config, assertGroupAllowed, onEvent, textOut })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 运维工具（配置/重载/自启/重启）交给 lib/tools-ops.mjs
  for (const tool of opsTools({
    config, applyConfigPatch, log, rereadConfigFromDisk, reloadSelf,
    setAutostart, isAutostartEnabled, autostartFile, restartDsh, textOut,
  })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 发送类工具（say/ask）交给 lib/tools-reply.mjs
  for (const tool of replyTools({
    assertGroupAllowed, roomState, config, sendWithRetry, stats,
    buildSearchNote, buildTranscript, generate, systemPrompt, sendReply, log, textOut,
  })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 杂项工具（发表情/备份）交给 lib/tools-misc.mjs
  for (const tool of miscTools({
    assertGroupAllowed, stickers, config, sendStickerTo,
    backupTick, readJson, backupStateFile: BACKUP_STATE_FILE, backupNow, backupRestore, backupList, textOut,
  })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 自检类工具（链路自测/自检明细）交给 lib/tools-selftest.mjs
  for (const tool of selftestTools({
    assertGroupAllowed, ob, normalizeEvent, roomState, stats, onEvent, log, sleep, cfgFor, config, selfcheck, textOut,
  })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 长期记忆工具交给 lib/tools-memory.mjs
  for (const tool of memoryTools({
    config, isManagedRoom, cfgFor, roomState, facts, factsOf, loadFacts, factNorm,
    addFact, delFact, writeRoomFacts, memDirOf, readRoomText, readJson, graphPath,
    updateProfile, updateSummary, updateRelations, extractFacts, searchMemory, exportMemory, textOut,
  })) {
    ctx.effect(() => safeRegister(tool))
  }

  // 面板/底层自测工具交给 lib/tools-panel.mjs
  for (const tool of panelTools({
    panelState, pickCanned, normText, detectTrigger, config, decide, selfcheck, usageView,
    isManagedRoom, memDirOf, addFact, factsOf, facts, rmSync, searchHistory, extractSearchQuery,
    sensitiveQuery, resolveVisionRoute, ob, stickers, tailLines, logFile: LOG_FILE, configKeys: CONFIG_KEYS,
    applyConfigPatch, textOut,
  })) {
    ctx.effect(() => safeRegister(tool))
  }
}
