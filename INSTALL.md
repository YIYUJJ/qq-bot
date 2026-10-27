# 安装

> 目标：**你只负责装两个软件 + 扫一次码，剩下的交给 AI。**

## 你需要准备什么

| # | 事项 | 说明 |
|---|---|---|
| 1 | **DSH 桌面版** | 插件跑在它里面（[下载](https://github.com/deepseek-ai)） |
| 2 | **SnowLuma** | 用来登录 QQ、把消息转成 OneBot v11 |
| 3 | **一个 QQ 号** | 在 SnowLuma 里**扫码登录**（必须人来扫） |
| 4 | **群号 + 管理员 QQ** | 装的时候要填，别填错群 |
| 5 | **可用的模型** | DSH 里已登录的 provider；识图需要支持图片的模型 |

## 三步安装

### 第 1 步：装 DSH 和 SnowLuma

- 装好 DSH 并能正常打开
- 装好 SnowLuma，**扫码登录 QQ**
- 打开 SnowLuma 设置，确认 OneBot v11 的 **HTTP（3000）** 和 **WebSocket（3001）** 已开启

### 第 2 步：把仓库交给 AI

把本仓库 clone 或下载到本地，然后对你 DSH 里的 AI 说：

```
读一下 <仓库路径>/AGENTS.md，按里面的步骤把这个 QQ 机器人装好并连上。
我的群号是 <群号>，管理员 QQ 是 <你的QQ>。
```

AI 会自己检查环境、装插件、生成配置、改 SnowLuma 配置、重启、跑体检。
**它会在动手前问你 5 个问题**（profile 路径、SnowLuma 路径、群号、管理员 QQ、是否同意重启 SnowLuma）。

### 第 3 步：验收

AI 装完后会跑：

```bash
node scripts/doctor.mjs
```

全部 ✅ 之后，你打开面板 `http://127.0.0.1:3101/qq-bot`，把**总开关**打开，然后在群里发一句「在吗」。
机器人回了 → 装好了。

---

## 注意事项（请务必读）

### 隐私

- 群消息会发送给**模型提供商**用于生成回复
- 长期记忆（事实/画像/日记）**只存在你本机** `~/.dsh/qq-bot/`
- 不要把 `~/.dsh/qq-bot/config.json` 提交到任何仓库（里面有 OneBot token）

### 合规

- QQ 机器人可能违反腾讯的用户协议，**风险自负**
- SnowLuma 通过 hook 本机 QQ 客户端工作，属于非官方方式
- 建议只在自己的小群里用，不要拿去加陌生人或商用

### 安全默认值

- 装完 `enabled` 默认是**关**的，`allowGroups` 默认**空** → 不会自己说话
- 只有白名单里的群会收到回复，其它群一律不碰
- 面板和推送只监听 `127.0.0.1`，外网访问不到

### 这些事 AI 做不了

- 扫码登录 QQ
- 同意 SnowLuma 的 EULA
- 安装 DSH / SnowLuma 本身
- 知道你的群号和管理员 QQ

---

## 手动安装（不用 AI）

```powershell
# 1. link 到 DSH profile
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add link:<仓库绝对路径>

# 2. 生成配置（会交互提问）
node <仓库>\scripts\setup.mjs

# 3. 改 SnowLuma 配置：http 3000 / ws 3001 / httpClients → http://127.0.0.1:3101/qq-bot/push
#    改完重启 SnowLuma

# 4. 在 DSH 插件列表里启用 dsh-qq-bot

# 5. 体检
node <仓库>\scripts\doctor.mjs
```

---

## 常见问题

| 现象 | 处理 |
|---|---|
| `doctor` 说端口 3000 连不上 | SnowLuma 没启动，或 OneBot HTTP 没开 |
| `doctor` 说 QQ 未登录 | 打开 SnowLuma 重新扫码 |
| 有日志但群里不回 | `allowGroups` 没填 / 总开关没开 |
| 改了 SnowLuma 配置没反应 | **必须重启 SnowLuma**，配置不会热加载 |
| 识图报 `max-tokens` | 换一个支持图片的模型，配 `visionProvider` / `visionModel` |
| 插件工具全部消失 | 插件加载失败；在 DSH 插件管理里看状态并重新启用 |

更完整的排查方法见 [`docs/TESTING.md`](./docs/TESTING.md)。

---

## License

MIT
