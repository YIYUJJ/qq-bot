#!/usr/bin/env node
/**
 * doctor.mjs —— 一键体检：装好了没有、能不能用。
 *
 * 用法：node scripts/doctor.mjs
 * 退出码：0 = 全部通过；1 = 有硬性失败
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const HOME = process.env.USERPROFILE || process.env.HOME || ''
const RESULTS = []

function ok(name, detail) {
  RESULTS.push({ ok: true, name, detail })
}
function bad(name, detail, fix) {
  RESULTS.push({ ok: false, name, detail, fix })
}
function info(name, detail) {
  RESULTS.push({ ok: true, name, detail, soft: true })
}

/* ── 1. 运行环境 ── */
const major = Number(process.versions.node.split('.')[0])
if (major >= 18) ok('Node 版本', process.version)
else bad('Node 版本', process.version + '（需要 >= 18）', '升级 Node.js')

/* ── 2. 仓库文件完整 ── */
for (const f of ['lib/index.js', 'lib/client.js', 'panel/index.html', 'cordis.patch.yml', 'package.json']) {
  if (!existsSync(join(ROOT, f))) bad('仓库文件', f + ' 缺失', '重新 clone 仓库')
}
if (!RESULTS.some((r) => !r.ok)) ok('仓库文件', '完整')

/* ── 3. DSH profile 里有没有 link 这个插件 ── */
function findProfile() {
  const base = join(HOME, '.dsh', 'profiles')
  if (!existsSync(base)) return ''
  if (process.env.DSH_PROFILE) return join(base, process.env.DSH_PROFILE)
  const desktop = join(base, 'desktop')
  if (existsSync(desktop)) return desktop
  const dirs = readdirSync(base).filter((d) => existsSync(join(base, d, 'package.json')))
  return dirs.length ? join(base, dirs[0]) : ''
}
const profile = findProfile()
if (!profile) {
  bad('DSH profile', '找不到 ~/.dsh/profiles/<name>', '确认 DSH 已安装，或设置 DSH_PROFILE 环境变量')
} else {
  const linked = join(profile, 'node_modules', '@dsh-external', 'dsh-qq-bot', 'lib', 'index.js')
  if (existsSync(linked)) ok('插件已 link', profile)
  else bad('插件未安装', '在 ' + profile + ' 里找不到 @dsh-external/dsh-qq-bot', `cd "${profile}" && pnpm add link:${ROOT}`)
}

/* ── 4. 插件配置 ── */
const DATA = join(HOME, '.dsh', 'qq-bot')
const CONFIG = join(DATA, 'config.json')
let cfg = null
if (!existsSync(CONFIG)) {
  bad('配置文件', '不存在：' + CONFIG, '运行 node scripts/setup.mjs 生成')
} else {
  try {
    cfg = JSON.parse(readFileSync(CONFIG, 'utf8'))
    ok('配置文件', Object.keys(cfg).length + ' 个键')
  } catch (e) {
    bad('配置文件', 'JSON 解析失败：' + e.message, '修好 JSON 或用 setup 重新生成')
  }
}
if (cfg) {
  const groups = Array.isArray(cfg.allowGroups) ? cfg.allowGroups.filter(Boolean) : []
  if (groups.length) ok('白名单群', groups.join(', '))
  else bad('白名单群', 'allowGroups 为空 → 机器人不会回复任何群', '在面板或 config.json 里填群号')
  if (Array.isArray(cfg.adminQQ) && cfg.adminQQ.filter(Boolean).length) ok('管理员 QQ', cfg.adminQQ.join(', '))
  else info('管理员 QQ', '未配置（私聊遥控/撤回不可用）')
  info('总开关', cfg.enabled ? '已开启' : '关闭中（体检全过后再开）')
  if (cfg.provider && cfg.model) ok('模型', cfg.provider + '/' + cfg.model)
  else info('模型', '留空 = 用 DSH 当前默认模型')
}

/* ── 5. SnowLuma 配置 ── */
const snow = String(cfg?.snowlumaHome || 'C:/SnowLuma').replace(/\\/g, '/')
let accounts = []
if (!existsSync(snow)) {
  bad('SnowLuma', '目录不存在：' + snow, '确认是否装在别处，改 config.snowlumaHome')
} else {
  const cfgDir = join(snow, 'config')
  accounts = existsSync(cfgDir) ? readdirSync(cfgDir).filter((f) => /^onebot_\d+\.json$/.test(f)) : []
  if (!accounts.length) bad('SnowLuma 配置', 'config/ 下没有 onebot_<uin>.json', '在 SnowLuma 里登录 QQ 并保存配置')
  else ok('SnowLuma 账号配置', accounts.join(', '))
}

/* ── 6. 端口一致性 + 网关可达 ── */
const pushPort = Number(cfg?.pushPort || 3101)
if (accounts.length) {
  try {
    const j = JSON.parse(readFileSync(join(snow, 'config', accounts[0]), 'utf8'))
    const httpPort = j?.networks?.httpServers?.[0]?.port
    const wsPort = j?.networks?.wsServers?.[0]?.port
    const pushUrl = j?.networks?.httpClients?.[0]?.url || ''
    const token = j?.networks?.httpServers?.[0]?.accessToken || ''
    ok('OneBot 端口', `http ${httpPort} / ws ${wsPort}`)
    if (pushUrl.includes(':' + pushPort)) ok('推送地址', pushUrl)
    else bad('推送地址不匹配', `SnowLuma 配的是 ${pushUrl || '(空)'}，插件监听 ${pushPort}`, '把 httpClients[0].url 改成 http://127.0.0.1:' + pushPort + '/qq-bot/push')
    if (!token) bad('OneBot token', 'httpServers[0].accessToken 为空', '在 SnowLuma 里重置 token')
    else {
      try {
        const res = await fetch(`http://127.0.0.1:${httpPort}/get_login_info`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
          body: '{}',
          signal: AbortSignal.timeout(5000),
        })
        const data = await res.json()
        if (data?.status === 'ok') ok('QQ 在线', `${data.data?.nickname || ''}（${data.data?.user_id || ''}）`)
        else bad('QQ 未登录', JSON.stringify(data).slice(0, 120), '打开 SnowLuma 重新扫码登录')
      } catch (e) {
        bad('SnowLuma 不可达', `http://127.0.0.1:${httpPort} 连不上：${e.message}`, '启动 SnowLuma')
      }
    }
  } catch (e) {
    bad('SnowLuma 配置解析', e.message, '检查 onebot_<uin>.json 是否损坏')
  }
}

/* ── 7. 推送端口在监听（插件已经起来） ── */
await new Promise((resolve) => {
  const s = net.connect(pushPort, '127.0.0.1')
  s.setTimeout(2500)
  s.on('connect', () => { s.destroy(); ok('插件推送端口', '127.0.0.1:' + pushPort + ' 可连'); resolve() })
  s.on('timeout', () => { s.destroy(); bad('插件未运行', '推送端口 ' + pushPort + ' 超时', '在 DSH 里启用插件'); resolve() })
  s.on('error', (e) => { bad('插件未运行', '推送端口 ' + pushPort + '：' + e.message, '在 DSH 里启用插件'); resolve() })
})

/* ── 8. 最近启动日志 ── */
const LOG = join(DATA, 'bot.log')
if (existsSync(LOG)) {
  const lines = readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean)
  let last = -1
  for (let i = 0; i < lines.length; i++) if (lines[i].includes('插件已启动')) last = i
  if (last < 0) bad('启动日志', '没找到「插件已启动」', '启用插件后重试')
  else {
    const after = lines.slice(last)
    const fatal = after.filter((l) => /未捕获|ReferenceError|TypeError|Cannot find module/.test(l))
    if (fatal.length) bad('启动后有错误', fatal[0].slice(0, 120), '看 bot.log 并修代码/配置')
    else ok('启动日志', lines[last].slice(1, 20))
  }
} else {
  info('启动日志', '还没有 bot.log（插件没启动过）')
}

/* ── 输出 ── */
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n)
console.log('\nQQ 机器人 体检\n' + '─'.repeat(74))
let hardFail = 0
for (const r of RESULTS) {
  const mark = r.ok ? (r.soft ? 'ℹ️ ' : '✅') : '❌'
  if (!r.ok) hardFail++
  console.log(`${mark} ${pad(r.name, 18)} ${r.detail || ''}`)
  if (!r.ok && r.fix) console.log(`   ${' '.repeat(18)} → ${r.fix}`)
}
console.log('─'.repeat(74))
console.log(hardFail ? `失败 ${hardFail} 项，按上面的建议修` : '全部通过')
process.exit(hardFail ? 1 : 0)
