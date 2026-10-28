/**
 * 面板元数据：分组、功能开关、每个配置项的中文标签/类型/范围。
 *
 * 单独成文件的理由和微信插件同一套：面板是数据驱动的，
 * 加一个开关只改这里，不用碰 UI 代码。面板通过 /qq-bot/api/state 拿到它。
 */

/** 左侧导航的分组。order 决定参数页里小节的顺序。 */
export const GROUPS = [
  { id: 'reply', title: '回复节奏', icon: '💬', desc: '什么时候回、回多快、一次聊多久' },
  { id: 'speed', title: '速度', icon: '⚡', desc: '推送、合批与流式发送' },
  { id: 'proactive', title: '主动行为', icon: '🌱', desc: '没人说话时自己冒泡、睡前问安' },
  { id: 'style', title: '说话方式', icon: '🗣', desc: '拆句、@、延迟、字数' },
  { id: 'sticker', title: '表情包', icon: '😄', desc: '文字后补一张群里的图' },
  { id: 'vision', title: '识图', icon: '🖼', desc: '图片、表情包看得懂' },
  { id: 'video', title: '视频', icon: '🎬', desc: '群里的视频看一眼、链接抓标题字幕、看过的记进记忆' },
  { id: 'search', title: '联网', icon: '🌐', desc: '让它查的时候才查' },
  { id: 'extras', title: '更多玩法', icon: '🎲', desc: '小游戏、提醒、网页摘要、文档、亲密度、日记' },
  { id: 'memory', title: '记忆与检索', icon: '🧠', desc: '上下文、长期记忆、历史查询' },
  { id: 'identity', title: '群与人', icon: '👥', desc: '白名单、昵称、成员名字' },
  { id: 'admin', title: '管理员', icon: '🛡', desc: '私聊管理员、遥控指令与 token 预算' },
  { id: 'model', title: '人设与模型', icon: '🐟', desc: '人格、模型、温度、长度' },
  { id: 'health', title: '健康与运维', icon: '❤️', desc: '自检、日志、轮询' },
  { id: 'advanced', title: '高级/接入', icon: '🔧', desc: 'SnowLuma 地址、token、路径' },
]

/** 每个配置项：label 是面板上的名字，type 决定控件形态。 */
export const CONFIG_META = {
  // ── 回复节奏 ──
  replyProbability: {
    group: 'reply', label: '闲聊插话概率', type: 'number', min: 0, max: 1, step: 0.01,
    help: '群里普通聊天时，它插一句的概率。被 @ 或叫名字不受这个限制。',
  },
  alwaysReply: {
    group: 'reply', label: '必回（不看概率）', type: 'bool',
    help: '打开后这个群无论说什么都回。全局这里是默认值，按群设置请去「每群性格」。',
  },
  debounceMs: {
    group: 'reply', label: '攒消息窗口', type: 'number', min: 0, max: 10000, step: 100, unit: 'ms',
    help: '等一小会儿把连着的几条一起看，避免打断别人说话。',
  },
  minReplyGapMs: {
    group: 'reply', label: '同群最小回复间隔', type: 'number', min: 0, max: 600000, step: 500, unit: 'ms',
  },
  maxRepliesPer10Min: {
    group: 'reply', label: '10 分钟回复上限', type: 'number', min: 0, max: 200, step: 1, unit: '条',
  },
  quietHours: {
    group: 'reply', label: '安静时段', type: 'quiet',
    help: '如 23:00-08:00；留空=不设。安静时段里只有 @ 会回。',
  },
  quietAllowAt: {
    group: 'reply', label: '安静时段仍回 @', type: 'bool',
  },
  cannedChance: {
    group: 'reply', label: '敷衍回复概率', type: 'number', min: 0, max: 1, step: 0.01,
    help: '偶尔只回「哈哈」「确实」这种低信息量短句，比每句都聪明更像人。',
  },
  repeatWindowMs: {
    group: 'reply', label: '同句防重复窗口', type: 'number', min: 0, max: 86400000, step: 60000, unit: 'ms',
  },
  conversationWindowMs: {
    group: 'reply', label: '对话延续窗口', type: 'number', min: 0, max: 86400000, step: 60000, unit: 'ms',
    help: '刚跟某人聊过，他接着说就当作对话延续，更容易接话。',
  },
  continuationChance: {
    group: 'reply', label: '对话延续接话概率', type: 'number', min: 0, max: 1, step: 0.05,
  },
  questionChance: {
    group: 'reply', label: '被提问时接话概率', type: 'number', min: 0, max: 1, step: 0.05,
    advanced: true,
  },
  nameChance: {
    group: 'reply', label: '被叫名字时接话概率', type: 'number', min: 0, max: 1, step: 0.05,
  },
  atChance: {
    group: 'reply', label: '被 @ 时必回', type: 'number', min: 0, max: 1, step: 0.05,
  },

  // ── 主动行为 ──
  proactive: { group: 'proactive', label: '主动找话题', type: 'bool' },
  proactiveIdleMs: {
    group: 'proactive', label: '安静多久才考虑', type: 'number', min: 60000, max: 86400000, step: 60000, unit: 'ms',
  },
  proactiveMinGapMs: {
    group: 'proactive', label: '同群主动最小间隔', type: 'number', min: 60000, max: 86400000, step: 60000, unit: 'ms',
  },
  proactiveChance: {
    group: 'proactive', label: '每次检查触发概率', type: 'number', min: 0, max: 1, step: 0.05,
  },
  proactiveHours: { group: 'proactive', label: '允许主动的时段', type: 'quiet' },

  // ── 说话方式 ──
  delayScale: {
    group: 'style', label: '拟人延迟倍率', type: 'number', min: 0, max: 3, step: 0.05,
    help: '0=秒发，1=像真人打字，0.35 是"快但不像机器"的折中。',
  },
  splitChance: { group: 'style', label: '拆成两条发的概率', type: 'number', min: 0, max: 1, step: 0.01 },
  maxLines: { group: 'style', label: '一条回复最多拆几条', type: 'number', min: 1, max: 10, step: 1, unit: '条' },
  maxReplyChars: { group: 'style', label: '单条字数上限', type: 'number', min: 10, max: 2000, step: 10, unit: '字' },
  allowAt: { group: 'style', label: '允许真 @ 人', type: 'bool' },
  atMentionChance: { group: 'style', label: '回复里带 @ 的概率', type: 'number', min: 0, max: 1, step: 0.05 },
  humanize: {
    group: 'style', label: '去 AI 味后处理', type: 'bool',
    help: '把「首先/其次/此外/综上所述」这类连接词换口语、删掉「希望对你有帮助」这类模板结尾、分号破折号换成人话。只改语气，不改事实。',
  },
  humanizeDropPeriod: {
    group: 'style', label: '句末句号被吃掉的概率', type: 'number', min: 0, max: 1, step: 0.05,
    help: '真人打字常常不打句号；设 0 就保留所有句号。',
  },
  lengthSpread: {    group: 'style', label: '长度浮动（多数只回一句）', type: 'bool',
    help: '开：70% 回一句、25% 两句、5% 三句；关：每次都按「最多几条」的上限来。',
  },
  moodEnabled: {
    group: 'style', label: '情绪状态', type: 'bool',
    help: '按内容和时间推断心情（困/馋/得意/委屈…），传给它并影响说话长短。',
  },
  pokeOnMe: {
    group: 'style', label: '被拍一拍时当"叫我"', type: 'bool',
    help: '有人拍你，就按被 @ 的优先级回一句。',
  },
  pokeBack: { group: 'style', label: '被拍时拍回去', type: 'bool' },
  pokeChance: { group: 'style', label: '拍回去的概率', type: 'number', min: 0, max: 1, step: 0.05 },
  pokeOnReply: {
    group: 'style', label: '回复时顺手拍对方', type: 'number', min: 0, max: 1, step: 0.05,
    help: '聊得热络时真人会顺手拍一下。0=从不。',
  },

  // ── 识图 ──
  visionOnImage: { group: 'vision', label: '收到图片时识图', type: 'bool' },
  visionOnEmoticon: { group: 'vision', label: '表情包也识图', type: 'bool' },
  games: { group: 'extras', label: '小游戏', type: 'bool', help: '掷骰子、猜拳、抽签、猜谜。' },
  polls: { group: 'extras', label: '投票', type: 'bool', help: '“发起投票：问题 / 选项1 / 选项2”。' },
  reminders: { group: 'extras', label: '定时提醒', type: 'bool', help: '“10 分钟后提醒我…”到点主动发一条。' },
  recallCmd: { group: 'extras', label: '允许管理员撤回', type: 'bool', help: '管理员说“撤回”就撤回机器人上一条消息。' },
  linkSummary: { group: 'extras', label: '普通网页链接摘要', type: 'bool', help: '发网页链接时抓标题和正文，让它说一句。' },
  docOnFile: { group: 'extras', label: '读取群里的文档', type: 'bool', help: 'PDF/Word/Excel/txt 读正文并摘要。' },
  docMaxMB: { group: 'extras', label: '文档大小上限', type: 'number', min: 1, max: 100, step: 1, unit: 'MB', advanced: true },
  docChars: { group: 'extras', label: '文档最多读多少字', type: 'number', min: 300, max: 20000, step: 100, unit: '字', advanced: true },
  bondEnabled: { group: 'extras', label: '亲密度', type: 'bool', help: '互动越多越亲近，语气会跟着变。' },
  diaryEnabled: { group: 'extras', label: '每日日记 + 自述', type: 'bool', help: '每晚写一篇当天日记，并更新“我是谁”。' },
  backupDaily: { group: 'health', label: '每天自动备份', type: 'bool', help: '每天到点把配置和记忆备份一份。' },
  backupHour: { group: 'health', label: '备份时间', type: 'number', min: 0, max: 23, step: 1, unit: '点', advanced: true },
  backupKeep: { group: 'health', label: '保留几份备份', type: 'number', min: 1, max: 30, step: 1, unit: '份', advanced: true },
  curveEnabled: { group: 'extras', label: '情绪/亲密度曲线', type: 'bool', help: '每天记一格心情分布和亲密度，面板里画成曲线。' },
  diaryHour: { group: 'extras', label: '几点写日记', type: 'number', min: 18, max: 23, step: 1, unit: '点', advanced: true },
  videoOnMessage: {
    group: 'video', label: '群里发视频也看一眼', type: 'bool',
    help: '下载视频 → 抽 6 帧拼图 → 视觉模型看图 → 当上下文。会多花几秒和 token。',
  },
  videoRemember: {
    group: 'video', label: '看过的视频记下来', type: 'bool',
    help: '把视频内容提炼成一条长期记忆，以后聊到能想起来（只留最近几条）。',
  },
  videoRememberMax: { group: 'video', label: '最多留几条视频记忆', type: 'number', min: 1, max: 30, step: 1, unit: '条', advanced: true },
  linkVideo: {
    group: 'video', label: '消息里有视频链接就解析', type: 'bool',
    help: 'B站/抖音/YouTube 链接用 yt-dlp 抓标题、时长、简介、字幕，再让它用自己的口气说。',
  },
  videoFrames: { group: 'video', label: '视频抽几帧', type: 'number', min: 2, max: 12, step: 1, unit: '帧', advanced: true },
  videoSheetWidth: {
    group: 'video', label: '拼图每格宽度', type: 'number', min: 240, max: 720, step: 40, unit: 'px', advanced: true,
    help: '越小视觉模型越快，但画面细节越少；默认 480。',
  },
  videoMaxSeconds: { group: 'video', label: '视频最长看多少秒', type: 'number', min: 10, max: 3600, step: 10, unit: '秒', advanced: true },
  videoWaitMs: { group: 'video', label: '回复前最多等视频多久', type: 'number', min: 1000, max: 30000, step: 500, unit: 'ms', advanced: true },
  videoMaxMB: { group: 'video', label: '视频大小上限', type: 'number', min: 1, max: 500, step: 1, unit: 'MB', advanced: true },
  linkVideoTimeoutMs: { group: 'video', label: '链接解析超时', type: 'number', min: 3000, max: 60000, step: 1000, unit: 'ms', advanced: true },
  linkVideoChars: { group: 'video', label: '字幕最多带多少字', type: 'number', min: 100, max: 5000, step: 100, unit: '字', advanced: true },
  ffmpegPath: { group: 'video', label: 'ffmpeg 路径', type: 'text', advanced: true, help: '留空用 PATH 里的 ffmpeg。' },
  ytdlpPath: { group: 'video', label: 'yt-dlp 路径', type: 'text', advanced: true, help: '留空自动找 pip 装的那个。' },
  visionProvider: {
    group: 'vision', label: '视觉模型 provider', type: 'text', advanced: true,
    help: '留空会失败；可填 opencodego-extra 这类支持图片的 provider。',
  },
  visionModel: { group: 'vision', label: '视觉模型 id', type: 'text', advanced: true },
  visionMaxImages: { group: 'vision', label: '一条消息最多看几张图', type: 'number', min: 1, max: 9, step: 1, unit: '张', advanced: true, help: '每张图一次视觉调用，调大更贵更慢。' },
  visionMaxWidth: { group: 'vision', label: '图片最多多宽', type: 'number', min: 480, max: 2048, step: 20, unit: 'px', advanced: true, help: '大图先压到这个宽度再送视觉，省 token 也更快。' },
  visionWaitMs: { group: 'vision', label: '回复前最多等识图', type: 'number', min: 1000, max: 20000, step: 500, unit: 'ms', advanced: true, help: '视觉一次通常 4~6 秒；等太短会回复“看不清”。' },
  visionMaxTokens: {
    group: 'vision', label: '识图 token 预算', type: 'number', min: 128, max: 4096, step: 64, advanced: true,
    help: '带思考的视觉模型需要留够，给小了会只思考不出字。',
  },
  visionMaxMB: { group: 'vision', label: '单张图大小上限', type: 'number', min: 1, max: 50, step: 1, unit: 'MB', advanced: true, help: '超过这个大小会先用 ffmpeg 压到 visionMaxWidth 宽再识图。' },
  visionCacheMax: {
    group: 'vision', label: '识图缓存条数', type: 'number', min: 20, max: 5000, step: 10, unit: '条', advanced: true,
  },

  // ── 联网 ──
  webSearch: {
    group: 'search', label: '允许联网搜索', type: 'bool',
    help: '消息里出现「你去搜一下 / 帮我查查」这类话时，先搜再回。平时闲聊不联网。',
  },
  searchDirective: {
    group: 'search', label: '允许模型自己决定要不要查', type: 'bool',
    help: '模型不确定时会输出 [搜索:关键词]，插件替它搜一次再让它说。',
  },
  searchMaxResults: { group: 'search', label: '最多看几条结果', type: 'number', min: 1, max: 10, step: 1, unit: '条' },
  searchCooldownMs: {
    group: 'search', label: '同群搜索冷却', type: 'number', min: 0, max: 600000, step: 5000, unit: 'ms',
  },
  searchTimeoutMs: {
    group: 'search', label: '搜索超时', type: 'number', min: 2000, max: 30000, step: 1000, unit: 'ms', advanced: true,
  },
  searchFetchTop: {
    group: 'search', label: '抓第一条结果的正文', type: 'bool',
    help: '搜索常常只给标题；打开后会抓第一条网页正文摘一段，天气/价格/比分这类才答得准。',
  },
  searchFetchChars: {
    group: 'search', label: '正文摘录长度', type: 'number', min: 200, max: 4000, step: 100, unit: '字', advanced: true,
  },

  // ── 表情包 ──
  stickerChance: {
    group: 'sticker', label: '文字后补表情包概率', type: 'number', min: 0, max: 1, step: 0.01,
  },
  stickerLibraryMax: {
    group: 'sticker', label: '图库最多存几张', type: 'number', min: 0, max: 2000, step: 10, unit: '张', advanced: true,
  },
  stickerFavorite: {
    group: 'sticker', label: '收进 QQ 收藏表情', type: 'bool',
    help: '群里收到的表情会加进账号的收藏表情（服务端持久化，链接过期也不丢），发出去是正常表情气泡而不是图片。',
  },
  stickerFavoriteMax: {
    group: 'sticker', label: '收藏上限', type: 'number', min: 0, max: 500, step: 10, unit: '张', advanced: true,
  },
  stickerCooldownMs: {
    group: 'sticker', label: '补图冷却', type: 'number', min: 0, max: 300000, step: 5000, unit: 'ms',
    help: '同一个群两次补图的最小间隔，避免一次回复里连发好几张（默认 15 秒）。',
  },

  // ── 速度 ──
  pushEnabled: {
    group: 'speed', label: 'HTTP 推送（推荐）', type: 'bool',
    help: '让 SnowLuma 把消息直接 POST 给插件，省掉 0~3 秒轮询等待。端口只监听 127.0.0.1。',
  },
  pushPort: {
    group: 'speed', label: '推送监听端口', type: 'number', min: 1024, max: 65535, step: 1, unit: '端口',
    help: 'SnowLuma 的 httpClients 要指向 http://127.0.0.1:<这个端口>/qq-bot/push',
  },
  pushSecret: {
    group: 'speed', label: '推送密钥', type: 'text',
    help: '可选。填了之后只接受 Authorization: Bearer <密钥> 的推送。', advanced: true,
  },
  fastDebounceMs: {
    group: 'speed', label: '@ / 私聊的合批窗口', type: 'number', min: 150, max: 3000, step: 50, unit: 'ms',
    help: '被 @、私聊、必回群用这个更短的等待；普通闲聊仍用「回复节奏」里的合批窗口。',
  },
  streamSend: {
    group: 'speed', label: '流式发送（先说第一句）', type: 'bool',
    help: '生成到第一个句号就先发出去，剩下的生成完再补发。感知快 0.5~1.5 秒，但可能把一段话拆成两条。',
  },
  contextMessages: { group: 'memory', label: '每次带多少条上下文', type: 'number', min: 4, max: 100, step: 1, unit: '条' },
  memoryExtract: {
    group: 'memory', label: '自动提炼长期记忆', type: 'bool',
    help: '每个群独立：攒够一批消息后让模型提炼 1~3 条事实（人物关系、偏好、约定），下次聊天会带上。',
  },
  memoryExtractEvery: {
    group: 'memory', label: '每多少条消息提炼一次', type: 'number', min: 5, max: 200, step: 5, unit: '条',
  },
  memoryExtractCooldownMs: {
    group: 'memory', label: '同群提炼冷却', type: 'number', min: 600000, max: 86400000, step: 600000, unit: 'ms', advanced: true,
  },
  factsLimit: {
    group: 'memory', label: '每次带几条记忆', type: 'number', min: 1, max: 30, step: 1, unit: '条',
    help: '按"和最近聊天是否相关"挑，不是简单取最新的。',
  },
  memoryRooms: {
    group: 'memory', label: '维护记忆的会话', type: 'csv',
    help: '只有这里列出的群/私聊会存记忆（facts / 画像 / 摘要），其它会话完全不记。填群号或私聊 QQ 号。',
  },
  memorySummaryEvery: {
    group: 'memory', label: '每多少条消息更新摘要', type: 'number', min: 20, max: 500, step: 10, unit: '条',
    help: '把旧摘要和最近对话滚动合并成一段，长期保留"之前聊过什么"。',
  },
  profileEvery: {
    group: 'memory', label: '每多少条消息自动重生成画像', type: 'number', min: 0, max: 1000, step: 10, unit: '条',
    help: '0 = 不自动（默认）。设成 60 就是每攒 60 条消息重写一次画像，至少隔 1 小时。可以只在某个群单独开。',
  },
  relationsEvery: {
    group: 'memory', label: '每多少条消息刷新关系', type: 'number', min: 50, max: 2000, step: 50, unit: '条',
    help: '群内关系分析（谁和谁常互动）的刷新频率；只在托管群里跑。',
  },
  relationsCooldownMs: {
    group: 'memory', label: '关系分析冷却', type: 'number', min: 3600000, max: 2592000000, step: 3600000, unit: 'ms', advanced: true,
    help: '两次关系分析的最小间隔，默认 7 天。',
  },
  historyLookup: {
    group: 'memory', label: '提起往事时查历史', type: 'bool',
    help: '消息里出现「上次/之前/那天」时去翻群历史，命中就塞进上下文（不花额外 token 也能答）。',
  },
  historyLimit: { group: 'memory', label: '历史最多带几条', type: 'number', min: 0, max: 20, step: 1, unit: '条', advanced: true },

  // ── 群与人 ──
  allowGroups: { group: 'identity', label: '群白名单', type: 'csv', help: '只有这里的群会被回复；这是硬约束。' },
  allowPrivate: { group: 'identity', label: '允许私聊的 QQ', type: 'csv' },
  adminQQ: {
    group: 'admin', label: '私聊管理员 QQ', type: 'csv', risk: 'warn',
    help: '这些人在私聊里无论问什么都会回（不看概率、不看安静时段、不敷衍）。自动视为允许私聊。',
  },
  adminCommands: {
    group: 'admin', label: '允许管理员遥控群聊', type: 'bool', risk: 'warn',
    help: '管理员私聊说「让X群安静30分钟 / 在X群说：… / 把X群人设改成…」时，会先在私聊回一份待确认，确认后才执行。',
  },
  adminNL: {
    group: 'admin', label: '允许自然语言指令', type: 'bool',
    help: '固定句式没命中时，让模型把你的话翻译成动作（只提案，仍然要你确认才执行）。',
  },
  adminPlanTokens: {
    group: 'admin', label: '指令解析 token 预算', type: 'number', min: 200, max: 8000, step: 100, unit: 'token',
    help: '解析自然语言命令时给模型的预算。带思考的模型给小了会把 JSON 截断，表现为"没解析出动作"。',
  },
  adminComposeTokens: {
    group: 'admin', label: '指令生成 token 预算', type: 'number', min: 80, max: 2000, step: 20, unit: 'token',
    help: '命令里"按人设生成一句话"（compose）的预算。',
  },
  adminPlanReasoning: {
    group: 'admin', label: '指令解析推理档', type: 'enum', options: ['', 'low', 'medium', 'high'],
    help: '解析时压低推理档能省 token、避免输出被截断；某些模型不认低档会自动回退默认。',
  },
  adminMaxActions: {
    group: 'admin', label: '一条指令最多几个动作', type: 'number', min: 1, max: 5, step: 1, unit: '个', advanced: true,
  },
  adminConfirmTtlMs: {
    group: 'admin', label: '确认有效期', type: 'number', min: 30000, max: 600000, step: 10000, unit: 'ms', advanced: true,
  },
  botName: { group: 'identity', label: '机器人群昵称', type: 'text' },
  aliases: { group: 'identity', label: '别名/简称', type: 'csv' },
  masterName: { group: 'identity', label: '唯一可叫「主人」的人', type: 'text', advanced: true },
  useDbMembers: { group: 'identity', label: '用群成员真实昵称', type: 'bool' },

  // ── 人设与模型 ──
  persona: { group: 'model', label: '人设', type: 'textarea' },
  provider: { group: 'model', label: '模型 provider（留空=跟随 DSH 默认）', type: 'text' },
  model: { group: 'model', label: '模型 id（留空=跟随 DSH 默认）', type: 'text' },
  temperature: { group: 'model', label: 'temperature', type: 'number', min: 0, max: 2, step: 0.05 },
  maxTokens: { group: 'model', label: '输出 token 上限', type: 'number', min: 64, max: 8192, step: 64 },
  reasoningEffort: { group: 'model', label: '推理档位', type: 'enum', options: ['', 'low', 'medium', 'high'] },

  // ── 健康与运维 ──
  pollMs: {
    group: 'health', label: '轮询间隔', type: 'number', min: 0, max: 60000, step: 500, unit: 'ms',
    help: 'SnowLuma 的 WS 不一定推消息，所以定时拉白名单群的历史；0=只靠 WS。',
  },
  healthCheckMs: { group: 'health', label: '自检间隔', type: 'number', min: 30000, max: 3600000, step: 30000, unit: 'ms', advanced: true },
  logMaxBytes: { group: 'health', label: '日志文件上限', type: 'number', min: 1048576, max: 104857600, step: 1048576, unit: '字节', advanced: true },

  // ── 高级 ──
  snowlumaHome: { group: 'advanced', label: 'SnowLuma 主目录', type: 'text', help: '用来读 config/onebot_<uin>.json 自动发现 token。' },
  httpUrl: { group: 'advanced', label: 'OneBot HTTP（留空=自动）', type: 'text' },
  wsUrl: { group: 'advanced', label: 'OneBot WS（留空=自动）', type: 'text' },
  accessToken: { group: 'advanced', label: '显式 token（留空=自动）', type: 'text' },
}

/** 功能开关卡片。key 指向 config 里的开关；kind=chance 时把概率当开关。 */
export const FEATURES = [
  { id: 'split', icon: '✂️', title: '拆句', key: 'splitChance', kind: 'chance', defaultChance: 0.3, desc: '像真人一样分两三条发' },
  { id: 'canned', icon: '💤', title: '敷衍回复', key: 'cannedChance', kind: 'chance', defaultChance: 0.1, desc: '少量「哈哈/确实/6」短句' },
  { id: 'proactive', icon: '🌱', title: '主动找话题', key: 'proactive', kind: 'bool', desc: '群里安静久了主动冒泡' },
  { id: 'memory', icon: '🧠', title: '长期记忆', key: 'memoryExtract', kind: 'bool', desc: '定期从群聊提炼事实并记住' },
  { id: 'history', icon: '🕰', title: '历史检索', key: 'historyLookup', kind: 'bool', desc: '提起往事时翻群历史' },
  { id: 'sticker', icon: '😄', title: '补表情包', key: 'stickerChance', kind: 'chance', defaultChance: 0.15, desc: '文字后补一张群里的图' },
  { id: 'visionImage', icon: '🖼', title: '识图', key: 'visionOnImage', kind: 'bool', desc: '群里发图 → 看懂 → 当上下文' },
  { id: 'visionEmoticon', icon: '😶', title: '识表情包', key: 'visionOnEmoticon', kind: 'bool', desc: '表情包也识别内容与情绪' },
  { id: 'poke', icon: '👉', title: '拍一拍', key: 'pokeOnMe', kind: 'bool', desc: '被拍就当叫我；还能拍回去' },
  { id: 'web', icon: '🌐', title: '联网搜索', key: 'webSearch', kind: 'bool', desc: '叫它查的时候才去查，平时不联网' },
  { id: 'at', icon: '@', title: '真 @ 人', key: 'allowAt', kind: 'bool', desc: '@ 到 QQ 号，对方收到红点提醒' },
  { id: 'quiet', icon: '🌙', title: '安静时段', key: 'quietHours', kind: 'bool', desc: '到点只回 @，其余不说话' },
  { id: 'dbMembers', icon: '👥', title: '真实群昵称', key: 'useDbMembers', kind: 'bool', desc: '用群名片代替 QQ 号' },
]

/** 面板顶部开关 / 导航需要的小工具。 */
let PUBLIC_META = null

export function publicMeta() {
  if (PUBLIC_META) return PUBLIC_META
  const out = {}
  for (const [k, v] of Object.entries(CONFIG_META)) {
    out[k] = {
      label: v.label,
      type: v.type,
      group: v.group,
      ...(v.min !== undefined ? { min: v.min } : {}),
      ...(v.max !== undefined ? { max: v.max } : {}),
      ...(v.step !== undefined ? { step: v.step } : {}),
      ...(v.unit ? { unit: v.unit } : {}),
      ...(v.options ? { options: v.options } : {}),
      ...(v.help ? { help: v.help } : {}),
      ...(v.advanced ? { advanced: true } : {}),
    }
  }
  PUBLIC_META = out
  return out
}
