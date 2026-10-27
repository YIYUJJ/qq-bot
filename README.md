# dsh-qq-bot

QQ 群拟人聊天机器人，**Cordis 插件形态**（不是外挂进程）。

## 为什么做它

`qq-bridge` 那条链路是"消息 → DSH 会话 → agent 组装 → 多轮工具调用 → 发送"，
一次回复要 2~4 次模型请求，每次还带约 30 个 MCP 工具 schema，端到端十几秒。

本插件把微信机器人（`dsh-wechat-bot`）的快路径搬到 QQ：

```
QQ 消息 → 房间状态 → 策略判定 → 一次 ctx.llm.stream → 一条 HTTP POST 发出去
```

没有 session、没有工具 schema、没有 MCP 往返、没有"沉睡前观察"闸门。

## 实测（2026-10-26 00:36，群 975427049）

| 路径 | 首字 | 端到端 |
|---|---|---|
| qq-bridge（旧） | — | **≈14s** |
| 本插件 | **691ms**（真实入站）/ 647ms（手动 ask） | **1.8s** / 1.6s |

- 桥的证据（它自己的日志）：`23:29:37 计划唤醒（@）→ 23:29:45 真唤醒 → 23:29:51 发出`。
- 插件的证据（`~/.dsh/qq-bot/bot.log`）：`回复 大肥鱼｜ambient｜首字 691ms 总 1789ms`——
  这是**真实入站**：群里那条消息被轮询收到 → 判定 → 一次 `ctx.llm.stream` → 发送。
- 1.8s 里还包含 `debounceMs 2500` 的攒消息窗口与 `delayScale 0.35` 的拟人延迟（都在预算内，
  所以"首字 691ms"才是模型与传输的真实开销）。

`qqbot_selftest` 会把白名单群里最新一条**别人发的**消息重新注入真实管线，用于没有新消息时验证
收消息链路。它会真的发出去，别对着有人的群反复跑。

## 连接方式

- 收事件：SnowLuma OneBot v11 的 **WebSocket**（默认 `ws://127.0.0.1:3001/`）
- 发动作：**HTTP**（默认 `http://127.0.0.1:3000`，`send_group_msg` 等）
- token **自动发现**：读 `<SnowLuma>/config/onebot_<uin>.json`，HTTP 与 WS 的 token 是两个不同的值。
  换 QQ 账号不用改配置——插件拿候选真去问一次 `get_login_info`。

### 实测：WS 只推心跳，不推群消息

本机抓包 120 秒，WS 上只有 `meta_event` 心跳，`post_type=message` 一条都没有，
而 `get_group_msg_history` 同时能读到真实消息。所以**收消息不能只靠 WS 推送**：

- 主路径仍是 WS（未来推送恢复就自动生效）；
- 兜底：每 `pollMs`（默认 3000ms）对**白名单群**调 `get_group_msg_history`；
- 启动时先建基线（只记录、不回旧消息），之后按 `message_id` 去重，
  所以 WS 与轮询同时来同一条也只处理一次。

## 安全约束（硬编码）

| 约束 | 行为 |
|---|---|
| `allowGroups` | 只有列出的群会被自动回复；`qqbot_say` / `qqbot_ask` / 面板手动发送同样过闸，其它群直接抛错 |
| `enabled: false` | 装完默认只读：收消息、记状态、面板可见，但不说话 |
| `dryRun` | 照常调模型，只把结果写日志，不发出去 |

当前部署的 `allowGroups` 是 **`975427049`**（用户授权只在此群测试）。

## 工具

| 工具 | 作用 |
|---|---|
| `qqbot_status` | 连接、账号、计数、延迟、各群节流与上次决策 |
| `qqbot_rooms` | 见过的群/私聊及是否授权 |
| `qqbot_history` | 某群最近消息（只读） |
| `qqbot_config` | 读/改运行参数，立即生效并落盘 |
| `qqbot_say` | 以机器人身份直接发文本（不走模型） |
| `qqbot_ask` | 强制生成并发送，返回首字/总耗时（可带 `at` 验 @） |
| `qqbot_send_sticker` | 从图库发一张图（验图片段） |
| `qqbot_selftest` | 回放最新一条别人的消息，走完整「收→判定→生成→发送」 |
| `qqbot_selftest_ops` | 逐项跑面板与拟人功能的底层实现（不往群里发消息） |
| `qqbot_panel` | 面板数据自检：检查 `/qq-bot/api/state` 字段是否齐全 |
| `qqbot_search` | 用 DSH 的联网搜索查一条（只读，不发群消息） |
| `qqbot_vision` | 识图：给 URL 或看最近一条带图消息 |
| `qqbot_poke` | 拍一拍群里的人（`send_poke`） |
| `qqbot_llm_models` | 列出可用 provider/model，并标出哪些支持图片 |
| `qqbot_health` | 探测 HTTP/WS/账号 + 列候选端点 |

## 已实测（不是"应该能用"）

- 真实入站 → 判定 → 一次模型调用 → 发送：`首字 647~958ms`，桥是 `≈14s`。
- 真 @ 到 QQ 号：群历史里能看到 `at(2237116031) + text(...)` 段。
- 引用回复：`reply + text(...)` 段。
- 图片段：图库 URL 直接发出，历史里是 `image` 段。
- 面板数据：`16` 个字段齐全，`49` 项参数、`9` 组、`10` 个功能开关。
- 底层自测：敷衍/归一/优先级/防重复/自检/用量/记忆/历史检索/成员/图库/日志/导入导出 全绿。

> 已知：面板的**视觉呈现**没有浏览器控制，只能验证到"槽位注册 + 数据齐全"，像素级效果需要你打开看一眼。


## 控制台

- DSH 侧栏「QQ 机器人」：微信插件同款布局（左侧导航 / 顶部状态灯 / 参数表单 / 表格 / 日志框）
- 导航：总览、功能开关、回复节奏、主动行为、说话方式、表情包、记忆、群与人、人设模型、诊断、运维日志、手动操作
- 同一个面板也能独立打开：`你的 DSH 地址/qq-bot`
- 接口：`GET /qq-bot/api/state`、`POST /qq-bot/api/config`、`POST /qq-bot/api/action`、`GET /qq-bot/api/logs`、`GET /qq-bot/api/export`

改面板的流程：改 `panel/index.html`（或 `panel/panel.css`）→ `node build-client.mjs` → 重新装配插件。

## 功能对照（微信插件 → QQ 插件）

| 微信插件的能力 | QQ 插件 | 备注 |
|---|---|---|
| 拟人节奏：概率/冷却/限流/安静时段/攒消息 | ✅ | 直接复用微信那份 `policy.mjs` |
| 敷衍短句（cannedChance） | ✅ | 短路，不花 token |
| 对话延续、同句防重复 | ✅ | `continuation` 优先级 + `repeatWindowMs` |
| 拆句分条、说话方式 | ✅ | `splitMessage` |
| 真 @ 人 | ✅ | OneBot `at` 段 |
| 主动找话题、允许时段 | ✅ | `proactive*` |
| 长期记忆（提炼事实） | ✅ | `facts.json` + 面板「让模型提炼」 |
| 历史检索（提往事时翻记录） | ✅ | `get_group_msg_history` |
| 群成员真实昵称 | ✅ | `get_group_member_list` |
| 表情包库 | ⚠️ 部分 | 能收群里图片并按 URL 发回；不是 QQ 原生「收藏表情」 |
| Token 用量统计 | ✅ | `usage.json`，面板总览 |
| 自检 / 诊断 | ✅ | HTTP、WS、账号、白名单、模型、日志 |
| 日志查看 / 配置导入导出 | ✅ | `/logs`、`/export`、`/import` |
| 识图（图片/表情包理解） | ✅ | 下载 → `attachments.saveImages` → 视觉模型 → 描述进上下文，7 天缓存 |
| 语音识别 / 语音发送 | ❌ 待做 | 需要 STT / TTS 服务 |
| 拍一拍 | ✅ | 被拍 → 拍回去 + 当"叫我"回一句；回复时也能顺手拍 |
| 链接视频、抖音分享 | ❌ 待做 | 需要下载 + 抽帧 |
| 桌宠联动、客户端自愈 | ❌ 不适用 | QQ 侧对应物是 SnowLuma，不是微信客户端 |


## 配置

`~/.dsh/qq-bot/config.json`（面板改的就是它），也可在 `cordis.patch.yml` 的 row config 里覆盖默认值。

关键项：

```jsonc
{
  "enabled": false,        // 自动回复总开关
  "dryRun": false,         // 演练：只生成不发
  "allowGroups": ["975427049"],
  "botName": "蓝色大肥鱼",
  "aliases": ["大肥鱼", "肥鱼", "蓝鱼", "小鲸鱼", "鲸鱼"],
  "replyProbability": 0.35, // 闲聊插话概率
  "minReplyGapMs": 9000,    // 同群冷却
  "maxRepliesPer10Min": 20,
  "debounceMs": 2500,       // 攒一小段再回
  "delayScale": 1,           // 拟人延迟倍率：0=秒发，0.35≈快，1=像真人
  "pollMs": 3000,            // 轮询兜底间隔（只轮询白名单群），0=只用 WS
  "quietHours": "",         // 如 "01:00-07:30"
  "contextMessages": 20,
  "temperature": 0.95
}
```

## 与 qq-bridge 的关系

两者可以同时连 SnowLuma（WS 允许并发客户端，已实测），但**同时开会双回复**。
接管步骤：

1. 本插件面板里点「开启自动回复」，用 `qqbot_ask` 在授权群测一轮延迟；
2. 确认可用后停掉 bridge（`state/bridge.lock` 对应的进程），避免双回；
3. 需要回滚就重新启 bridge、关本插件开关。

## 速度

| 手段 | 默认 | 说明 |
|---|---|---|
| HTTP 推送 | 开 | 插件在 `127.0.0.1:3101/qq-bot/push` 监听；SnowLuma 的 `networks.httpClients` 指向它，省掉 0~3 秒轮询等待 |
| 轮询兜底 | 1000ms | 推送没到时的保险；`pollMs=0` 可关 |
| 快车道合批 | 400ms | 被 @ / 私聊 / 必回群用这个窗口；普通闲聊仍走 `debounceMs`(2500ms) |
| 流式发送 | 关 | 打开后生成到第一个句末就先发前半句，剩下生成完补发 |

SnowLuma 侧配置（改完要重启 SnowLuma）：

```json
"networks": {
  "httpClients": [
    { "name": "dsh-qq-bot-push", "url": "http://127.0.0.1:3101/qq-bot/push",
      "enabled": true, "messageFormat": "array", "reportSelfMessage": false, "timeoutMs": 5000 }
  ]
}
```

## 表情包

- **存**：群里收到的表情（`sub_type=1`）会立刻 `add_custom_face` 收进账号的 QQ 收藏表情（服务端持久化），同时下载一份到 `~/.dsh/qq-bot/stickers/`；
- **发**：优先 `send_custom_face`（QQ 原生表情气泡），失败才退本地文件 / 原 URL，并带 `summary: "[动画表情]"`；
- 为什么不用 URL：QQ 的图片链接几小时就过期，纯 URL 方案必然失效（之前 40 张全过期就是这个原因）；
- 开关：`stickerFavorite`（默认开）、`stickerFavoriteMax`（默认 60 张）。

## 自刷新

面板右上角 **🔄 刷新**：重载插件本体（走 DSH 的 `hmr.reconcileProfile`，与插件管理器开关同一套机制），
应用磁盘上的代码改动；页面会在 4 秒后自动刷新，不用再按 Ctrl+F5。

- 只改了 `config.json` / `rooms.json` → 用「运维日志」页的 **重读配置**，不重启连接；
- 没改文件时点刷新是空转（HMR 发现文件没变就不重启），这是正常行为；
- 命令行/对话里也能用：`qqbot_reload`（`configOnly=true` 只重读配置）。

## 测试

```bash
npm run test:policy   # 拟人策略回归（82 项，来自微信插件的那套断言）
npm run test:outbox   # 重试队列回归（19 项：退避/放弃/持久化/容量）
```

重试队列的逻辑在 `lib/outbox.mjs`，发送器与时钟都可注入，所以不掐网络也能把
"5 次重试、10 分钟过期、永久失败丢弃"这些分支跑全。真实链路另做过一次集成验证：
前两次故意打到不存在的端口（真·连接被拒），第三次恢复后经 OneBot 补发成功。

## 已知边界

- 暂不支持：语音识别 / 语音合成、群视频与链接解析、抖音分享、转发消息解析、撤回/入群事件。
- 表情包按 QQ 的 `image + sub_type` 发送（客户端显示为动画表情，不是图片气泡）；
  `mface` 段在实测的群里从没出现过，真遇到会退化成普通图片。
- 历史检索受 OneBot `get_group_msg_history` 限制（约 80 条），不是 MySQL 那种任意翻。
- 面板是可读可写的控制台，不是聊天窗口。

