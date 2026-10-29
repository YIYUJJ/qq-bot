/**
 * 配置子系统：默认值 → 文件 → row config 的合并、校验、持久化、热重读、补丁应用。
 *
 * 从 index.js 抽出。副作用（重启推送/轮询、重建安静时段、缓存失效）通过 hooks 注入，
 * 这样配置逻辑本身可以单测。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 改了这些键要重新预热语义检索（加载/换模型、补向量） */
export const SEMANTIC_KEYS = ['semanticSearch', 'semanticModel', 'semanticSource', 'semanticMirror', 'semanticThreads']

export function createConfigStore(opts) {
  const {
    file,
    defaults,
    validateConfig,
    keys,
    booleanSet,
    numericSet,
    listSet,
    meta,
    log = () => {},
    hooks = {},
  } = opts

  const config = { ...defaults }
  const warnings = []

  function normalizeLists() {
    for (const k of listSet) {
      const v = config[k]
      if (typeof v === 'string') config[k] = v.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
      else if (!Array.isArray(v)) config[k] = []
      else config[k] = v.map((s) => String(s).trim()).filter(Boolean)
    }
    config.allowGroups = config.allowGroups.map((s) => s.replace(/^group:/, ''))
  }

  function saveConfig() {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8')
      return true
    } catch (e) {
      log('保存配置失败：' + String(e?.message || e))
      return false
    }
  }

  /** 从文件 + row config 加载（只跑一次，apply 时调用）。 */
  function load(rawConfig) {
    try {
      if (existsSync(file)) {
        const saved = JSON.parse(readFileSync(file, 'utf8')) || {}
        // 兼容老版本：visionMaxBytes（字节）→ visionMaxMB（MB）
        if (saved.visionMaxBytes && !('visionMaxMB' in saved)) {
          saved.visionMaxMB = Math.max(1, Math.round(Number(saved.visionMaxBytes) / 1048576))
        }
        const checked = validateConfig(saved)
        Object.assign(config, checked.config)
        warnings.push(...checked.warnings)
        // 迁移/清理后的配置写回一次（未知键会被丢掉）
        try {
          writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8')
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* 文件坏了就用默认值，不要因此起不来 */
    }
    if (rawConfig && typeof rawConfig === 'object') {
      const checked = validateConfig({ ...config, ...rawConfig })
      Object.assign(config, checked.config)
      warnings.push(...checked.warnings)
    }
    normalizeLists()
    return { config, warnings }
  }

  /** 面板/工具改配置的唯一入口。 */
  function applyConfigPatch(patch) {
    const applied = {}
    const rejected = {}
    for (const [k, raw] of Object.entries(patch || {})) {
      if (!keys.includes(k)) {
        rejected[k] = '未知配置项'
        continue
      }
      let v = raw
      if (booleanSet.has(k)) {
        v = raw === true || raw === 'true' || raw === 1 || raw === '1'
      } else if (numericSet.has(k)) {
        v = Number(raw)
        if (!Number.isFinite(v)) {
          rejected[k] = '需要数字'
          continue
        }
        const m = meta[k]
        if (m && typeof m.min === 'number' && v < m.min) v = m.min
        if (m && typeof m.max === 'number' && v > m.max) v = m.max
      } else if (listSet.has(k)) {
        v = Array.isArray(raw)
          ? raw.map((s) => String(s).trim()).filter(Boolean)
          : String(raw ?? '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
        if (k === 'allowGroups') v = v.map((s) => s.replace(/^group:/, ''))
      }
      config[k] = v
      applied[k] = v
    }
    if (Object.keys(applied).length) {
      if ('visionProvider' in applied || 'visionModel' in applied) hooks.onVisionRouteDirty?.()
      normalizeLists()
      saveConfig()
      if ('pushEnabled' in applied || 'pushPort' in applied || 'pushSecret' in applied) hooks.onPushRestart?.()
      if ('pollMs' in applied) hooks.onPollRestart?.()
      if (SEMANTIC_KEYS.some((k) => k in applied)) hooks.onSemanticChanged?.()
      hooks.onQuietChanged?.(config.quietHours)
      hooks.bumpCfg?.()
    }
    return { ok: Object.keys(applied).length > 0 || !Object.keys(patch || {}).length, applied, rejected, rejectedReason: rejected }
  }

  /** 从磁盘重读 config.json 与 rooms.json（外部改文件后不用重载插件）。 */
  function rereadConfigFromDisk() {
    const changed = []
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) || {}
      for (const [k, v] of Object.entries(saved)) {
        if (keys.includes(k) && JSON.stringify(config[k]) !== JSON.stringify(v)) {
          config[k] = v
          changed.push(k)
        }
      }
    } catch {
      /* 文件不存在/坏了就用当前值 */
    }
    hooks.reloadRoomOverrides?.()
    normalizeLists()
    hooks.onQuietChanged?.(config.quietHours)
    hooks.onVisionRouteDirty?.()
    if (changed.some((k) => SEMANTIC_KEYS.includes(k))) hooks.onSemanticChanged?.()
    hooks.bumpCfg?.()
    return { ok: true, changed }
  }

  return { config, warnings, normalizeLists, saveConfig, applyConfigPatch, rereadConfigFromDisk, load }
}
