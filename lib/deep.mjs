/**
 * 记忆深化：把 8 项功能装在一起（方案：qqbot-docs/design/记忆深化方案.md）。
 *
 *   story        4 我们之间的故事          deep-story.mjs
 *   links        5 联想                    deep-links.mjs
 *   insights     1 反思归纳                deep-insights.mjs
 *   consolidate  6 每晚整理                deep-consolidate.mjs
 *   recall       8 偶尔主动想起往事        deep-recall.mjs
 * 2 变化线 / 3 情绪权重 / 7 来源和把握度 是事实本身的字段，在 memory-store.mjs；提炼格式升级在 memory-ai.mjs。
 *
 * 每晚任务（每个会话每天一次）：consolidateHour:30 每晚整理 + 全量重算联想 → reflectHour:00 反思归纳。
 * 每项都有独立开关（meta.mjs 的「记忆深度」分组），关掉就完全不跑、不花钱；只读实例（另一个实例在跑时）一律不写。
 */
import { readRoomMemory, patchMeta } from './memory.mjs'
import { createStory } from './deep-story.mjs'
import { createLinks } from './deep-links.mjs'
import { createInsights } from './deep-insights.mjs'
import { createConsolidate } from './deep-consolidate.mjs'
import { createRecall } from './deep-recall.mjs'
import { localDay, clampInt } from './memory-deep.mjs'

export const MEMDEEP_DEPS = ['config', 'log', 'generate', 'store', 'rooms', 'getEmbedder', 'getMemPlus']

export function createMemDeep(deps) {
  const missing = MEMDEEP_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('记忆深化缺少依赖：' + missing.join(', '))
  const { config, log, generate, store, rooms, getEmbedder, getMemPlus } = deps
  const isReadOnly = typeof deps.isReadOnly === 'function' ? deps.isReadOnly : () => false
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()

  const readMeta = (roomId) => {
    const dir = store.memDirOf(roomId)
    return dir ? readRoomMemory(dir).meta || {} : {}
  }
  const story = createStory({ config, log, memDirOf: store.memDirOf, isManagedRoom: store.isManagedRoom, isReadOnly, now })
  const insights = createInsights({ config, log, generate, store, rooms, getMemPlus, isReadOnly, now, readMeta, patchMeta })
  const links = createLinks({
    config, log, store, getEmbedder, isReadOnly,
    insightsOf: (rid) => (config.reflectEnabled !== false ? insights.activeOf(rid) : []),
  })
  const consolidate = createConsolidate({ config, log, generate, store, getMemPlus, getEmbedder, insights, story, rooms, isReadOnly, now, patchMeta })
  const recall = createRecall({ config, log, store, insights, story, getEmbedder, isReadOnly, now, ...(deps.random ? { random: deps.random } : {}) })
  // 挑记忆时的联想（memory-store.pickFacts 调用）
  store.setAssociator((rid, seeds, chosen, n) => links.associate(rid, seeds, chosen, n))

  /** 记忆有增删改（写入钩子）：认识的依据变了 → 待复核；向量补好后只算新记忆那一行联想 */
  function onFactsChanged(roomId) {
    if (isReadOnly() || !store.isManagedRoom(roomId)) return
    try {
      insights.markReview(roomId)
    } catch (e) {
      log('认识复核标记失败：' + String(e?.message || e))
    }
    if (!config.assocEnabled) return
    const mp = getMemPlus()
    Promise.resolve(mp?.indexMemory ? mp.indexMemory(roomId) : null)
      .catch(() => null)
      .then(() => links.update(roomId))
      .catch((e) => log('联想更新失败：' + String(e?.message || e)))
  }

  /** 要建向量的额外文本：有效的认识（翻旧账、联想、想起往事用）+ 故事节点（想起往事判断相关度用） */
  function extraTexts(roomId) {
    const out = []
    if (config.reflectEnabled !== false) for (const x of insights.activeOf(roomId)) out.push(x.text)
    if (config.storyEnabled !== false) for (const m of story.allMilestones(roomId)) out.push(m.text)
    return out
  }

  /**
   * 系统提示词片段：「你对这里的人的理解」+「你和 TA 之间的经历」
   * @param {{preview?: boolean}} [opts] preview：面板预览，不计入认识的"被用到"次数
   */
  function promptParts(r, { preview = false } = {}) {
    if (!r || !store.isManagedRoom(r.roomId)) return { insights: '', story: '' }
    const mp = getMemPlus()
    let ins = ''
    if (config.reflectEnabled !== false) {
      const semScores = r.semVec && mp?.semScores ? (texts) => mp.semScores(r.roomId, r.semVec, texts) : null
      ins = insights.promptBlock(r, { semScores, touch: !preview })
    }
    return { insights: ins, story: story.promptLine(r) }
  }

  /**
   * 每晚任务（每 10 分钟看一次）：
   *   过了 consolidateHour:30 → 每晚整理 + 全量重算联想（先等昨天的每日摘要写完）
   *   过了 reflectHour:00     → 反思归纳（同一次检查里两样都到点时，先整理再反思）
   */
  let busy = false
  async function nightlyTick() {
    if (busy || isReadOnly()) return { skipped: true }
    busy = true
    const done = []
    try {
      const d = new Date(now())
      const today = localDay(d)
      const minutes = d.getHours() * 60 + d.getMinutes()
      const consDue = minutes >= clampInt(config.consolidateHour ?? 4, 0, 23, 4) * 60 + 30
      const refDue = minutes >= clampInt(config.reflectHour ?? 5, 0, 23, 5) * 60
      if (!consDue && !refDue) return { done }
      // 每晚整理和反思都要用到昨天的每日摘要：先让它写完
      try {
        await getMemPlus()?.dailyTick?.()
      } catch {
        /* 摘要失败不影响整理 */
      }
      for (const roomId of config.memoryRooms) {
        const k = String(roomId)
        const dir = store.memDirOf(k)
        if (!dir) continue
        const meta = readMeta(k)
        if (consDue && meta.nightlyDay !== today) {
          // 先记下"今天跑过了"：失败也不会每 10 分钟重试一次、反复花钱
          patchMeta(dir, { nightlyDay: today })
          if (config.consolidateEnabled !== false) {
            try {
              done.push({ room: k, task: '每晚整理', ...(await consolidate.run(k)) })
            } catch (e) {
              log('每晚整理失败：' + String(e?.message || e))
            }
          }
          if (config.assocEnabled) {
            try {
              links.rebuild(k)
            } catch (e) {
              log('联想全量重算失败：' + String(e?.message || e))
            }
          }
        }
        if (refDue && meta.reflectDay !== today) {
          patchMeta(dir, { reflectDay: today })
          if (config.reflectEnabled !== false) {
            try {
              done.push({ room: k, task: '反思归纳', ...(await insights.reflect(k)) })
            } catch (e) {
              log('反思归纳失败：' + String(e?.message || e))
            }
          }
        }
      }
      return { done }
    } finally {
      busy = false
    }
  }

  /** 统计 / 计数落盘（故事的"聊过几天"、认识的使用次数），和亲密度一起每分钟一次 */
  function flush() {
    let n = 0
    try {
      n += story.flush()
    } catch (e) {
      log('故事落盘失败：' + String(e?.message || e))
    }
    try {
      n += insights.flush()
    } catch (e) {
      log('认识落盘失败：' + String(e?.message || e))
    }
    return n
  }

  /** 面板状态 */
  function status(roomId) {
    if (!roomId || !store.isManagedRoom(roomId)) return null
    const ins = insights.load(roomId)
    const entries = consolidate.list(roomId, 1000)
    const meta = readMeta(roomId)
    const linkCounts = Object.values(links.counts(roomId))
    return {
      insights: { active: ins.filter((x) => x.status === '有效').length, review: ins.filter((x) => x.status === '待复核').length, retired: ins.filter((x) => x.status === '已撤回').length },
      stories: story.people(roomId).filter((p) => p.milestones).length,
      links: linkCounts.reduce((s, n) => s + n, 0),
      consolidation: { pending: entries.filter((e) => e.status === '待确认').length, done: entries.filter((e) => e.status === '已执行').length, lastAt: Number(meta.consolidatedAt) || 0 },
      lastReflectAt: Number(meta.lastReflectAt) || 0,
      recall: { said: recall.history(roomId).filter((x) => x.said).length, offered: recall.history(roomId).length },
    }
  }

  return { story, insights, links, consolidate, recall, onFactsChanged, extraTexts, promptParts, nightlyTick, flush, status, readMeta }
}
