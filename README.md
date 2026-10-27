# qq-bot

> 项目名 **qq-bot**（DSH 插件包名：`@dsh-external/dsh-qq-bot`）。给 [DSH（DeepSeek Harness）](https://github.com/deepseek-ai) 用的 QQ 群拟人聊天机器人：直连 SnowLuma OneBot v11，进程内流式调用模型，自带 Web 控制台和长期记忆。

它不是"关键词问答机"：有人设、有情绪、会记事儿、看得懂图、能看视频、会发表情包，也会在没人说话时自己冒个泡——但**只在白名单群里**，其它群一律不碰。

```
QQ 群 ──▶ SnowLuma (OneBot v11) ──▶ 插件
                                    ├─ 房间状态 / 策略（概率、冷却、安静时段）
                                    ├─ 上下文（最近消息 + 长期记忆 + 情绪 + 关系）
                                    ├─ 一次流式调用 ctx.llm.stream
                                    └─ 拟人化处理（拆句 / 去 AI 味 / 长度浮动）──▶ 发送
```

一次回复默认只走**一轮**模型调用，不经过 agent 会话，首字通常 0.8~1.5 秒。

## 特性

| 类别 | 能力 |
|---|---|
| 对话 | 人设、情绪状态、长度浮动、拆句、去 AI 味、@ 与引用回复、防重复 |
| 记忆 | 长期事实（相似度去重 + 归档）、画像、摘要、群内关系、每日日记 + 自述、亲密度 |
| 多模态 | 识图（含表情包）、视频抽帧 + 画面描述、视频链接解析、文档读取（txt/docx/xlsx/pdf）、合并转发解析、网页摘要 |
| 互动 | 小游戏（骰子/猜拳/抽签/猜谜）、投票、定时提醒、撤回、拍一拍 |
| 运维 | 面板（参数/每群性格/记忆/表情库/曲线/日志）、备份恢复、每日自动备份、用量统计、健康自检 |
| 安全 | 白名单硬约束、默认关闭、只监听 127.0.0.1、管理员遥控需二次确认 |

> **第一次装？看 [INSTALL.md](./INSTALL.md)** —— 你只负责装 DSH + SnowLuma 并扫码，剩下的交给 AI（读 [AGENTS.md](./AGENTS.md) 自动完成）。

## 安装

### 1. 前置

- 已安装 DSH Desktop（或能运行 DSH）
- 已安装 SnowLuma 并登录 QQ，开启 OneBot v11 的 HTTP + WebSocket
- 一个支持图片的模型（识图需要；纯文本模型也能跑）

### 2. 装插件

```bash
# 假设 clone 到 D:\dpswork\packages\dsh-qq-bot
cd <DSH profile 目录>
pnpm add link:../path/to/dsh-qq-bot
```

重启 DSH，在插件列表里启用 `dsh-qq-bot`。

### 3. 配置 SnowLuma

`onebot_<QQ号>.json` 里需要：

```jsonc
{
  "http":  { "enable": true, "host": "127.0.0.1", "port": 3000, "token": "你的token" },
  "ws":    { "enable": true, "host": "127.0.0.1", "port": 3001 },
  "httpClients": [{
    "enable": true,
    "url": "http://127.0.0.1:3101/qq-bot/push",
    "secret": "",
    "message": true, "notice": true, "request": false, "meta_event": false
  }]
}
```

改完**手动重启 SnowLuma**（改配置不会热生效）。

### 4. 第一次配置

打开面板（`http://127.0.0.1:3101/qq-bot`），至少填：

| 配置 | 说明 |
|---|---|
| `enabled` | 总开关，默认关 |
| `allowGroups` | 允许回复的群号，**默认空 = 谁都不回** |
| `adminQQ` | 管理员 QQ：可私聊遥控、可让它撤回 |
| `memoryRooms` | 要维护长期记忆的群/私聊 |
| `snBase` / `snToken` | SnowLuma 的 HTTP 地址与 token |

配置保存在 `~/.dsh/qq-bot/config.json`（Windows：`C:\Users\<你>\.dsh\qq-bot\`）。

## 配置

- **全局**：面板参数页，或直接改 `config.json`
- **每群性格**：面板「每群性格」页，只允许覆盖表达层参数；白名单、模型路由、接入地址不可按群覆盖
- **模型**：`provider` / `model` 留空会用 DSH 当前默认模型；识图可单独指定 `visionProvider` / `visionModel`

所有配置项的中文说明集中在 `lib/meta.mjs`，面板直接读它渲染。

## 开发与测试

```bash
npm test                 # 5 组单测
npm run smoke            # 冒烟：语法 → 单测 → 配置一致性 → 插件存活 → 网关/端口
npm run smoke -- --quick # 跳过单测
npm run scan:static      # 静态扫描：配置键拼写、重复函数、未 await、面板 action 对不上…
node build-client.mjs    # 改完 panel/index.html 必须重跑
```

## 目录

```
lib/
  index.js      插件入口：消息接入、flush 主流程、面板 API
  features.mjs  小游戏 / 投票 / 提醒 / 亲密度 / 曲线 / 日记
  extras.mjs    纯工具：骰子、提醒解析、网页抓取、文档取文本
  policy.mjs    拆句、截断、节流
  humanize.mjs  去 AI 味
  memory.mjs    事实/画像/摘要/日记的读写
  onebot.mjs    OneBot v11 客户端（HTTP + WS）
  video.mjs     视频抽帧、yt-dlp
  outbox.mjs    发送失败重试队列
  meta.mjs      配置元数据（面板唯一来源）
  roomcfg.mjs   每群覆盖
panel/          面板源码（构建产物 lib/client.js）
scripts/        smoke.mjs、run-tests.mjs
tools/          static-scan.cjs（开发用）
```

## 已知限制

- 只在 **Windows** 上验证过；路径与进程调用按 Windows 写，Linux/macOS 需要小改
- docx/xlsx 依赖本机 Python；PDF 需要 `pypdf`，第一次读时自动装到数据目录
- 视频链接依赖 `yt-dlp`，抽帧依赖 `ffmpeg`
- 还不支持语音条（没有 ASR）
- 没有并发压测；设计目标是情侣/小群，不是大群

## 安全边界

- 只有 `allowGroups` / `allowPrivate` 里的会话会被回复
- `enabled` 默认 `false`
- HTTP 服务只绑 `127.0.0.1`
- 管理员指令需要二次确认
- **不要提交** `~/.dsh/qq-bot/config.json`（里面有 token）

## License

MIT
