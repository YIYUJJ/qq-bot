/**
 * 统一错误边界。
 *
 * 目标：**任何一个局部异常都不应该带走整个 DSH 宿主**。
 * 三件事：
 *   1. safe(label, fn) / safeAsync(label, fn) —— 同步/异步包装，异常只上报不抛出
 *   2. errorRing —— 最近错误环形缓冲（面板/诊断可查）
 *   3. installProcessGuards —— 最后一道防线：uncaughtException / unhandledRejection
 *      只记录、不退出（避免"一个定时器写错 → 整个应用重启"）
 */

const RING_MAX = 50

/** 最近错误（进程级，重载后仍保留，方便诊断） */
export const errorRing = globalThis.__qqbotErrorRing || (globalThis.__qqbotErrorRing = [])

/** 全局兜底只装一次：热重载时重复监听会叠加日志 */
const GUARD_FLAG = '__qqbotProcessGuardsInstalled'

let reporter = (label, err) => {
  // 还没接日志时写 stderr，至少不静默
  try {
    console.error('[qq-bot][' + label + '] ' + (err?.stack || err?.message || err))
  } catch {
    /* ignore */
  }
}

function record(label, err) {
  const item = {
    at: Date.now(),
    label: String(label || 'unknown'),
    message: String(err?.message || err || '').slice(0, 500),
    stack: String(err?.stack || '').slice(0, 2000),
  }
  errorRing.push(item)
  if (errorRing.length > RING_MAX) errorRing.splice(0, errorRing.length - RING_MAX)
  try {
    reporter(item.label, err)
  } catch {
    /* 日志本身失败也不能再抛 */
  }
  return item
}

/** 只上报，不抛出。用于事件回调、HTTP、工具执行。 */
export function safe(label, fn) {
  return (...args) => {
    try {
      const r = fn(...args)
      if (r && typeof r.then === 'function') {
        return r.catch((e) => {
          record(label, e)
          return undefined
        })
      }
      return r
    } catch (e) {
      record(label, e)
      return undefined
    }
  }
}

/** async 版本：调用方可以 await，永远不会 reject。 */
export async function safeAsync(label, fn) {
  try {
    return await fn()
  } catch (e) {
    record(label, e)
    return undefined
  }
}

/**
 * 包装工具定义：execute 抛错时返回一句人话，而不是把异常抛给宿主。
 * 不改变正常返回值。
 */
export function wrapTool(def, log) {
  if (!def || typeof def.execute !== 'function') return def
  const orig = def.execute
  return {
    ...def,
    async execute(...args) {
      try {
        return await orig(...args)
      } catch (e) {
        const item = record('tool:' + (def.name || '?'), e)
        try {
          log?.(`工具 ${def.name} 执行失败：${item.message}`)
        } catch {
          /* ignore */
        }
        return `执行失败：${item.message}`
      }
    },
  }
}

/**
 * 最后一道防线。只装一次（热重载不会叠加）。
 * 返回 true 表示这次安装了，false 表示之前已装。
 */
export function installProcessGuards(log) {
  if (log) {
    reporter = (label, err) => {
      try {
        log('异常已隔离（' + label + '）：' + String(err?.message || err))
      } catch {
        /* ignore */
      }
    }
  }
  if (globalThis[GUARD_FLAG]) return false
  globalThis[GUARD_FLAG] = true

  process.on('uncaughtException', (err) => {
    record('uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    record('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)))
  })
  return true
}

/** 诊断用：最近 N 条错误 */
export function recentErrors(n = 10) {
  return errorRing.slice(-Math.max(1, Math.min(RING_MAX, n)))
}
