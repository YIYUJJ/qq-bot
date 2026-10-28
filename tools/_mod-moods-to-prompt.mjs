import { readFileSync, writeFileSync } from 'node:fs'

// 1) 把 MOODS / MOOD_TTL_MS / setMood 从 index 摘出来，塞进 prompt.mjs
let L = readFileSync('lib/index.js', 'utf8').split(/\r?\n/)

function grabFn(name) {
  const s = L.findIndex((l) => new RegExp('^(  )(async )?function ' + name + '\\(').test(l))
  if (s < 0) return []
  let depth = 0
  let started = false
  let end = s
  for (let i = s; i < L.length; i++) {
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
  const lines = L.slice(s, end + 1)
  L.splice(s, end - s + 1)
  return lines
}

const moodsStart = L.findIndex((l) => l.trim().startsWith('const MOODS = {'))
let moods = []
if (moodsStart >= 0) {
  let depth = 0
  let end = moodsStart
  for (let i = moodsStart; i < L.length; i++) {
    for (const ch of L[i]) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    if (depth === 0) {
      end = i
      break
    }
  }
  moods = L.slice(moodsStart, end + 1)
  L.splice(moodsStart, end - moodsStart + 1)
}
const ttlIdx = L.findIndex((l) => l.trim().startsWith('const MOOD_TTL_MS'))
let ttl = []
if (ttlIdx >= 0) {
  ttl = [L[ttlIdx]]
  L.splice(ttlIdx, 1)
}
const setMood = grabFn('setMood')

let p = readFileSync('lib/prompt.mjs', 'utf8')
p = p.replace('export const PROMPT_DEPS = ', moods.join('\n') + '\n' + ttl.join('\n') + '\n\nexport const PROMPT_DEPS = ')
p = p.replace('  return { moodName, inferMood, buildTranscript, systemPrompt }', setMood.join('\n') + '\n\n  return { moodName, inferMood, buildTranscript, systemPrompt, setMood }')
// 模块内不再从 deps 取 MOODS/MOOD_TTL_MS
p = p.replace(/const \{ MOODS, MOOD_TTL_MS, /, 'const { ')
p = p.replace(/"MOODS","MOOD_TTL_MS",/, '')
writeFileSync('lib/prompt.mjs', p, 'utf8')

let out = L.join('\n')
out = out.replace('const { moodName, inferMood, buildTranscript, systemPrompt } = prompt', 'const { moodName, inferMood, buildTranscript, systemPrompt, setMood } = prompt')
// prompt 工厂调用里的 MOODS/MOOD_TTL_MS 依赖去掉
out = out.replace(/const prompt = createPrompt\(\{\n[\s\S]*?\n  \}\)/, (m) => m.replace(/^\s*MOODS.*\n/gm, '').replace(/^\s*MOOD_TTL_MS.*\n/gm, ''))
writeFileSync('lib/index.js', out, 'utf8')
console.log('MOODS / setMood 已并入 prompt.mjs')
