/** video-files.mjs 回归测试：临时目录清理、ffmpeg/ffprobe 路径推导。 运行：node lib/test-video-files.mjs */
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { VIDEO_FILES_DEPS, createVideoFiles } from './media.mjs'

let pass = 0
const fails = []
const ok = (c, n) => {
  if (c) {
    pass += 1
    console.log('  PASS  ' + n)
  } else {
    fails.push(n)
    console.log('  FAIL  ' + n)
  }
}

let threw = ''
try {
  createVideoFiles({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(VIDEO_FILES_DEPS.includes('DATA_DIR'), '依赖清单')

const dir = mkdtempSync(join(tmpdir(), 'qqbot-videofiles-'))
try {
  const videoDir = join(dir, 'video-tmp')
  mkdirSync(videoDir, { recursive: true })
  writeFileSync(join(videoDir, 'old.mp4'), 'x')
  writeFileSync(join(videoDir, 'new.mp4'), 'x')
  const old = new Date(Date.now() - 3 * 3600 * 1000)
  utimesSync(join(videoDir, 'old.mp4'), old, old)

  const logs = []
  const vf = createVideoFiles({ DATA_DIR: dir, config: {}, log: (m) => logs.push(m) })
  ok(vf.VIDEO_DIR === videoDir, 'VIDEO_DIR 指向 data/video-tmp')
  ok(!existsSync(join(videoDir, 'old.mp4')), '过期临时文件已清理')
  ok(existsSync(join(videoDir, 'new.mp4')), '新文件保留')
  ok(logs.some((l) => l.includes('清理视频临时文件')), '清理有日志')

  // 再清一次：没有过期文件就不动
  const removed = vf.cleanupTmp()
  ok(removed === 0, '没有过期文件时返回 0')

  // ffmpeg 路径
  ok(vf.ffmpegBin() === 'ffmpeg', '默认 ffmpeg')
  ok(vf.ffprobeBin() === 'ffprobe', '默认 ffprobe')

  const vf2 = createVideoFiles({ DATA_DIR: dir, config: { ffmpegPath: 'C:/tools/ffmpeg.exe' }, log: () => {} })
  ok(vf2.ffmpegBin() === 'C:/tools/ffmpeg.exe', '自定义 ffmpeg 路径')
  ok(vf2.ffprobeBin() === 'C:/tools/ffprobe.exe', '自动推导 ffprobe 路径')
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

console.log('')
if (fails.length) {
  console.log(`❌ test-video-files.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-video-files.mjs 通过 ${pass} 项，失败 0 项`)
