#!/usr/bin/env node
/**
 * setup.mjs —— 生成/更新插件配置（交互式，也可以非交互跑）。
 *
 * 交互：node scripts/setup.mjs
 * 非交互：node scripts/setup.mjs --groups=123,456 --admin=10001 --snowluma=C:/SnowLuma --dry-run
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const HOME = process.env.USERPROFILE || process.env.HOME || ''
const DATA = join(HOME, '.dsh', 'qq-bot')
const CONFIG = join(DATA, 'config.json')

const argv = process.argv.slice(2)
const arg = (k) => {
  const hit = argv.find((a) => a.startsWith('--' + k + '='))
  return hit ? hit.slice(k.length + 3) : ''
}
const DRY = argv.includes('--dry-run')
const NON_INTERACTIVE = argv.includes('--non-interactive') || DRY

function readExisting() {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'))
  } catch {
    return {}
  }
}
function ids(s) {
  return String(s || '')
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter((x) => /^\d{5,12}$/.test(x))
}

async function main() {
  const cur = readExisting()
  const answers = {
    snowlumaHome: arg('snowluma') || cur.snowlumaHome || 'C:/SnowLuma',
    groups: arg('groups') || (Array.isArray(cur.allowGroups) ? cur.allowGroups.join(',') : ''),
    admin: arg('admin') || (Array.isArray(cur.adminQQ) ? cur.adminQQ.join(',') : ''),
    pushPort: arg('pushport') || String(cur.pushPort || 3101),
  }

  if (!NON_INTERACTIVE) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const ask = async (q, def) => {
      const a = (await rl.question(`${q}${def ? '（默认 ' + def + '）' : ''}：`)).trim()
      return a || def || ''
    }
    console.log('生成 QQ 机器人配置（回车用括号里的默认值）\n')
    answers.snowlumaHome = await ask('SnowLuma 安装目录', answers.snowlumaHome)
    answers.groups = await ask('允许说话的群号（多个用逗号分隔）', answers.groups)
    answers.admin = await ask('管理员 QQ（可私聊遥控、撤回）', answers.admin)
    answers.pushPort = await ask('推送端口', answers.pushPort)
    rl.close()
  }

  const groups = ids(answers.groups)
  const admins = ids(answers.admin)
  const pushPort = Number(answers.pushPort) || 3101

  if (!groups.length) {
    console.error('\n❌ 至少需要一个群号（allowGroups 为空 = 机器人谁都不回）')
    process.exit(1)
  }
  if (!existsSync(answers.snowlumaHome)) {
    console.error('\n⚠️  SnowLuma 目录不存在：' + answers.snowlumaHome + '（先确认路径，配置仍会写入）')
  }

  const next = {
    ...cur,
    enabled: cur.enabled === true, // 不在这里打开，交给面板
    snowlumaHome: answers.snowlumaHome,
    allowGroups: groups,
    adminQQ: admins,
    memoryRooms: [...new Set([...groups, ...admins])],
    pushPort,
  }

  console.log('\n将写入：' + CONFIG)
  const show = {
    enabled: next.enabled,
    snowlumaHome: next.snowlumaHome,
    allowGroups: next.allowGroups,
    adminQQ: next.adminQQ,
    memoryRooms: next.memoryRooms,
    pushPort: next.pushPort,
  }
  console.log(JSON.stringify(show, null, 2))

  if (DRY) {
    console.log('\n（--dry-run，未写入）')
    return
  }
  mkdirSync(DATA, { recursive: true })
  writeFileSync(CONFIG, JSON.stringify(next, null, 2) + '\n', 'utf8')
  console.log(`
✅ 已写入

下一步：
  1. 重启（或重载）插件让配置生效
  2. node scripts/doctor.mjs 体检
  3. 打开 http://127.0.0.1:${pushPort}/qq-bot 把「总开关」打开
  4. 在群里发一句「在吗」验收
`)
}

main().catch((e) => {
  console.error('失败：' + (e?.message || e))
  process.exit(1)
})
