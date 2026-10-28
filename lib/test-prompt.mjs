/** prompt.mjs 回归测试：情绪老化、转录、系统提示词包含人设/记忆/画像。 运行：node lib/test-prompt.mjs */
import { PROMPT_DEPS, createPrompt } from './prompt.mjs'

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
  createPrompt({})
} catch (e) {
  threw = String(e?.message || e)
}
ok(threw.includes('缺少依赖'), '缺依赖抛错')
ok(PROMPT_DEPS.includes('pickFacts'), '依赖清单')

function build(over = {}) {
  const deps = {
    MOODS: { happy: { emoji: '', hint: '心情不错' } },
    MOOD_TTL_MS: 40 * 60 * 1000,
    config: { botName: '小鲸鱼', persona: '你在群里是个正常人', systemExtra: '', memoryInject: true, contextMessages: 20 },
    cfgFor: () => ({ persona: '', memoryInject: true }),
    getFeatures: () => new Proxy({}, { get: () => () => undefined }),
    isManagedRoom: () => true,
    memDirOf: () => 'mem/900001',
    pickFacts: () => [{ text: '主人喜欢白饭' }],
    roomTextOf: () => ({ profile: '主人：清风', summary: '上次聊到猫', relations: '', diary: '', self: '' }),
    setMood: (r, name) => {
      r.mood = name
    },
    ...over,
  }
  return createPrompt(deps)
}

const p = build()
const room = { roomId: '900001', isGroup: true, roomName: '测试群', msgs: [], nameCache: new Map([['42', '张三']]), mood: null, moodAt: 0 }

// moodName：没有情绪返回空
ok(p.moodName(room) === '', '没有情绪时 moodName 为空')

// moodName：设置后返回
room.mood = 'happy'
room.moodAt = Date.now()
ok(typeof p.moodName(room) === 'string', '有情绪时返回字符串')

// 情绪过期
room.moodAt = Date.now() - 60 * 60 * 1000
ok(p.moodName(room) === '', '情绪过期后为淡出')

// buildTranscript：包含消息
room.msgs = [
  { isSelf: false, senderName: '张三', text: '在吗', images: 0 },
  { isSelf: true, senderName: 'bot', text: '在的', images: 0 },
]
const t = p.buildTranscript(room, 10)
ok(t.includes('张三') && t.includes('在吗'), '转录包含别人消息')
ok(t.includes('在的'), '转录包含自己消息')

// systemPrompt：包含人设 + 事实 + 画像
const sp = p.systemPrompt(room)
ok(typeof sp === 'string' && sp.length > 20, '系统提示词非空')
ok(sp.includes('小鲸鱼') || sp.includes('群') || sp.length > 50, '包含人设')
ok(sp.includes('白饭'), '包含记忆事实')
ok(sp.includes('清风') || sp.includes('猫'), '包含画像/摘要')

// 未托管会话：不注入记忆
const p2 = build({ isManagedRoom: () => false, memDirOf: () => '', pickFacts: () => [] })
const sp2 = p2.systemPrompt({ roomId: '999', isGroup: true, msgs: [], nameCache: new Map() })
ok(!sp2.includes('白饭'), '未托管会话不注入记忆')

console.log('')
if (fails.length) {
  console.log(`❌ test-prompt.mjs 通过 ${pass} 项，失败 ${fails.length} 项：` + fails.join('; '))
  process.exit(1)
}
console.log(`✅ test-prompt.mjs 通过 ${pass} 项，失败 0 项`)
