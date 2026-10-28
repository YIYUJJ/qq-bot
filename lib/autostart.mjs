/**
 * Windows 开机自启管理（给面板开关用）。
 *
 * 做法：在「启动」文件夹里放一个 .cmd，登录时启动 SnowLuma。
 * 不写注册表、不建计划任务，用户可以在任务管理器里直接看到/禁用。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE_NAME = 'qqbot-snowluma.cmd'

export function startupDir() {
  const appData = process.env.APPDATA || ''
  if (!appData) return ''
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
}

export function autostartFile() {
  const dir = startupDir()
  return dir ? join(dir, FILE_NAME) : ''
}

export function isAutostartEnabled() {
  const f = autostartFile()
  return !!(f && existsSync(f))
}

function toWinPath(p) {
  return String(p || '').replace(/\//g, '\\').replace(/\\+$/, '')
}

/**
 * 开/关自启。
 * @param {boolean} enabled
 * @param {string} snowlumaHome 例如 C:/SnowLuma
 * @returns {{enabled:boolean, file:string, target:string}}
 */
export function setAutostart(enabled, snowlumaHome) {
  const dir = startupDir()
  const file = autostartFile()
  const home = toWinPath(snowlumaHome || 'C:/SnowLuma')
  const target = home + '\\launcher.bat'
  if (!dir || !file) throw new Error('拿不到 Windows 启动文件夹（APPDATA 为空）')
  if (enabled) {
    if (!existsSync(target)) throw new Error('找不到 SnowLuma 启动器：' + target)
    mkdirSync(dir, { recursive: true })
    const content = [
      '@echo off',
      'rem 由 qq-bot 面板生成：登录后启动 SnowLuma（QQ 网关）',
      'start "" "' + target + '"',
      '',
    ].join('\r\n')
    writeFileSync(file, content, 'utf8')
    return { enabled: true, file, target }
  }
  if (existsSync(file)) rmSync(file, { force: true })
  return { enabled: false, file, target }
}

/** 读出自启脚本内容（面板展示用，出错返回空串） */
export function readAutostartScript() {
  const f = autostartFile()
  if (!f || !existsSync(f)) return ''
  try {
    return readFileSync(f, 'utf8')
  } catch {
    return ''
  }
}
