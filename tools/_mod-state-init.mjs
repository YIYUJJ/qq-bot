import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const L = readFileSync(p, 'utf8').split(/\r?\n/)

const start = L.findIndex((l) => l.includes('// ── 持久化：长期记忆 / 表情包库 / 用量'))
if (start < 0) throw new Error('找不到持久化块起点')
const end = L.findIndex((l, i) => i > start && l.includes('// ── 识图（图片 / 表情包）'))
if (end < 0) throw new Error('找不到识图块起点')

const block = [
  '  // 状态容器（持久化对象）交给 lib/state-init.mjs',
  '  const stateInit = createStateInit({',
  '    DATA_DIR, config, isAllowedGroup, log, mediaKey, ob, shouldRetrySend, stats, writeJson,',
  '  })',
  '  const {',
  '    readJson, hashStr, FACTS_FILE, STICKERS_FILE, USAGE_FILE, REPLIED_FILE, NAMES_FILE,',
  '    MEMORY_DIR, STICKER_DIR, OUTBOX_FILE, facts, stickers, stickerStore, markStickersDirty,',
  '    flushStickersNow, rememberSticker, usage, replied, savedNames, stateStore, flushStateNow,',
  '    markStateDirty, recordReplied, alreadyReplied, noteUsage, usageView, outbox, sendWithRetry,',
  '    enqueueSend, deliverOutboxItem, flushOutbox,',
  '  } = stateInit',
  '',
]
L.splice(start, end - start, ...block)

let out = L.join('\n')
if (!out.includes("from './state-init.mjs'")) {
  const a = out.indexOf("import { createStateStore } from './state-store.mjs'")
  const i = out.indexOf('\n', a) + 1
  out = out.slice(0, i) + "import { createStateInit } from './state-init.mjs'\n" + out.slice(i)
}
writeFileSync(p, out, 'utf8')
console.log('state-init 抽取完成')
