import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('scripts/smoke.mjs', 'utf8')
if (!s.includes('check-module-deps')) {
  const anchor = "await checkAsync('模块导出齐全'"
  const block = `check('模块依赖注入完整', () => {
  try {
    execFileSync(process.execPath, [join(ROOT, 'tools', 'check-module-deps.mjs')], { encoding: 'utf8' })
    return '没有未声明的注入名字'
  } catch (e) {
    const out = String(e?.stdout || '')
    const bad = out.split('\\n').filter((l) => l.includes('⚠️')).map((l) => l.trim().replace('⚠️', '')).slice(0, 4)
    throw new Error(bad.join('；') || '依赖审计未通过（跑 node tools/check-module-deps.mjs 看详情）')
  }
})

`
  const idx = s.indexOf(anchor)
  if (idx < 0) throw new Error('找不到 smoke 锚点')
  s = s.slice(0, idx) + block + s.slice(idx)
  writeFileSync('scripts/smoke.mjs', s, 'utf8')
  console.log('smoke 已接入依赖审计')
}
