import { readFileSync, writeFileSync } from 'node:fs'

const p = 'lib/index.js'
let L = readFileSync(p, 'utf8').split(/\r?\n/)

// 1) 找到并删除原块：ROOMS_FILE 起 → resetRoomOverride 结束
const start = L.findIndex((l) => l.includes("const ROOMS_FILE = join(DATA_DIR, 'rooms.json')"))
if (start < 0) throw new Error('找不到 ROOMS_FILE')
const resetIdx = L.findIndex((l, i) => i > start && l.includes('function resetRoomOverride(roomId)'))
if (resetIdx < 0) throw new Error('找不到 resetRoomOverride')
let end = resetIdx
let depth = 0
let started = false
for (let i = resetIdx; i < L.length; i++) {
  for (const ch of L[i]) {
    if (ch === '{') {
      depth++
      started = true
    } else if (ch === '}') depth--
  }
  if (started && depth === 0) {
    end = i
    break
  }
}

const block = [
  '  // 每群配置运行时交给 lib/room-config.mjs',
  '  const roomCfg = createRoomConfig({',
  '    config, countOverrides, filterRoomOverride, mergeRoomConfig, parseQuietWindows, readJson,',
  '    roomsFile: ROOMS_FILE, writeJson,',
  '  })',
  '  const { cfgFor, bumpCfg, quietWindowsFor, roomOverrideOf, setRoomOverride, resetRoomOverride } = roomCfg',
  '',
  '  /** 外部改过 rooms.json 后重读（config-store 的 hook 用）。 */',
  '  function applyRoomOverridesFromDisk() {',
  '    try {',
  '      const ro = JSON.parse(readFileSync(ROOMS_FILE, "utf8"))',
  '      roomCfg.replaceRoomOverrides(ro)',
  '    } catch {',
  '      /* ignore */',
  '    }',
  '  }',
]
L.splice(start, end - start + 1, ...block)

let s = L.join('\n')

// 2) 保留 ROOMS_FILE 常量的早期定义（hook 与模块都要用）
if (!s.includes("const ROOMS_FILE = join(DATA_DIR, 'rooms.json')")) {
  const anchor = "const BACKUP_STATE_FILE = join(DATA_DIR, 'backup-state.json')"
  s = s.replace(anchor, anchor + "\n  const ROOMS_FILE = join(DATA_DIR, 'rooms.json')")
}

// 3) config-store 的 roomOverrides hook 改走 disk 重读
s = s.replace(
  `      reloadRoomOverrides: () => {
        try {
          const ro = JSON.parse(readFileSync(ROOMS_FILE, "utf8"))
          roomOverrides = ro && typeof ro === "object" && !Array.isArray(ro) ? ro : {}
        } catch { /* ignore */ }
      },`,
  '      reloadRoomOverrides: () => applyRoomOverridesFromDisk(),',
)

// 4) 其余引用：roomOverrides → roomCfg.getRoomOverrides()
s = s.replace('    setRoomOverrides: (o) => { roomOverrides = o },', '    setRoomOverrides: (o) => roomCfg.replaceRoomOverrides(o),')
s = s.replace('    roomOverrides, roomState,', '    roomOverrides: roomCfg.getRoomOverrides(), roomState,')

// 5) import
if (!s.includes("from './room-config.mjs'")) {
  const a = s.indexOf("import { createStateInit } from './state-init.mjs'")
  const i = s.indexOf('\n', a) + 1
  s = s.slice(0, i) + "import { createRoomConfig } from './room-config.mjs'\n" + s.slice(i)
}

writeFileSync(p, s, 'utf8')
console.log('room-config 抽取完成')
