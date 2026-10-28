import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
const raw = readFileSync(p, 'utf8')
const crlf = raw.includes('\r\n')
let lines = raw.split(/\r?\n/)

const start = lines.findIndex((l) => l.includes('// 配置优先级：面板/文件 > cordis.patch.yml'))
const end = lines.findIndex((l, i) => i > start && l.trim() === 'normalizeLists()')
if (start < 0 || end < 0) throw new Error('找不到配置块边界')

const block = [
  '  // 配置优先级：文件 > cordis.patch.yml 的 row config > 默认值（schema 唯一真相）',
  '  let config = { ...DEFAULT_CONFIG }',
  '  let configWarnings = []',
  '  try {',
  '    if (existsSync(CONFIG_FILE)) {',
  '      const saved = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) || {}',
  '      // 兼容老版本：visionMaxBytes（字节）→ visionMaxMB（MB）',
  '      if (saved.visionMaxBytes && !("visionMaxMB" in saved)) {',
  '        saved.visionMaxMB = Math.max(1, Math.round(Number(saved.visionMaxBytes) / 1048576))',
  '      }',
  '      const checked = validateConfig(saved)',
  '      config = checked.config',
  '      configWarnings = checked.warnings',
  '      // 迁移/清理后的配置写回一次（未知键会被丢掉）',
  '      try {',
  '        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\\n", "utf8")',
  '      } catch {',
  '        /* ignore */',
  '      }',
  '    }',
  '  } catch (e) {',
  '    /* 文件坏了就用默认值，不要因此起不来 */',
  '  }',
  '  if (rawConfig && typeof rawConfig === "object") {',
  '    const checked = validateConfig({ ...config, ...rawConfig })',
  '    config = checked.config',
  '    configWarnings = configWarnings.concat(checked.warnings)',
  '  }',
]

lines.splice(start, end - start + 1, ...block)
writeFileSync(p, lines.join(crlf ? '\r\n' : '\n'), 'utf8')
console.log('配置加载改用 validateConfig')
