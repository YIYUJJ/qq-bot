/**
 * 视频临时目录与外部工具路径：启动时清残留 + ffmpeg/ffprobe 定位。
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const VIDEO_FILES_DEPS = ['DATA_DIR', 'config', 'log']

export function createVideoFiles(deps) {
  const missing = VIDEO_FILES_DEPS.filter((k) => deps[k] === undefined)
  if (missing.length) throw new Error('视频文件工具缺少依赖：' + missing.join(', '))
  const { DATA_DIR, config, log } = deps

  const VIDEO_DIR = join(DATA_DIR, 'video-tmp')

  /** 启动时清掉残留（正常流程回复完会自己删；这里兜底异常退出留下的）。 */
  function cleanupTmp(maxAgeMs = 2 * 3600 * 1000) {
    let removed = 0
    try {
      if (!existsSync(VIDEO_DIR)) return 0
      for (const n of readdirSync(VIDEO_DIR)) {
        const fp = join(VIDEO_DIR, n)
        try {
          if (Date.now() - statSync(fp).mtimeMs > maxAgeMs) {
            rmSync(fp, { force: true, recursive: true })
            removed += 1
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
    if (removed) log(`已清理视频临时文件 ${removed} 个`)
    return removed
  }

  function ffmpegBin() {
    return String(config.ffmpegPath || 'ffmpeg')
  }

  function ffprobeBin() {
    if (config.ffmpegPath) {
      return String(config.ffmpegPath).replace(/ffmpeg(\.exe)?$/i, (m) => m.replace(/ffmpeg/i, 'ffprobe'))
    }
    return 'ffprobe'
  }

  cleanupTmp()

  return { VIDEO_DIR, ffmpegBin, ffprobeBin, cleanupTmp }
}
