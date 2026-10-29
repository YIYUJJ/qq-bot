# qq-bot 安装

> 你只需要：装好 DSH 和 SnowLuma、扫码登录 QQ。然后把本仓库地址发给 DSH 里的 DeepSeek，剩下的它来做。
> 默认安装的是 `main` 分支的**最新代码**。

## 先准备好这些

| # | 事项 | 说明 |
|---|---|---|
| 1 | **DSH 桌面版** | 插件跑在它里面；安装要在 DSH 里和 DeepSeek 对话（[下载](https://github.com/deepseek-ai)） |
| 2 | **SnowLuma** | 用来登录 QQ，把消息转成 OneBot v11；装好后**扫码登录 QQ** |
| 3 | **Node.js 22 或更新** | 安装脚本要用（<https://nodejs.org>）；有 git 更好，没有也行 |
| 4 | **群号 + 管理员 QQ** | 机器人只在这些群里说话；管理员可以私聊遥控它 |
| 5 | **可用的模型** | DSH 里已登录的模型；识图需要支持图片的模型 |
| 6 | **网络** | 能访问 GitHub；要语义检索时还要能访问 npm 和 ModelScope |

---

## 方式一：一句话安装（中途会停下问你）

在 DSH 里对 DeepSeek 说：

```
帮我安装这个 QQ 机器人：https://github.com/YIYUJJ/qq-bot
按仓库里 AGENTS.md 的步骤来。群号 <群号>，管理员 QQ <你的QQ>。
```

它会下载最新代码、检查环境，然后**停下来把风险清单列给你**（就是下面「风险」那一节），你回复「同意」后才继续。改 SnowLuma 配置、重启 SnowLuma 之前也会先问你。

---

## 方式二：全自动安装（中途不停）

把下面这段填好（所有 `< >` 都要换成你的内容）发给 DeepSeek：

```
帮我全自动安装这个 QQ 机器人：https://github.com/YIYUJJ/qq-bot ，按仓库里 AGENTS.md 的全自动模式来。
- 群号：<群号，多个用逗号隔开>
- 管理员 QQ：<你的 QQ>
- 允许修改 SnowLuma 配置并重启 SnowLuma：是
- 语义检索：要
- 装完直接打开总开关：否
- 我已阅读并同意 AGENTS.md 第 3 节列出的风险。
```

**前 4 行（群号、管理员 QQ、是否允许重启 SnowLuma、同意风险）必须有**，缺一项它就会退回方式一、停下来问你。其它可以按需改：

| 可选项 | 默认 |
|---|---|
| 代码放在哪：`代码目录：D:\xxx` | `%USERPROFILE%\dsh-plugins\qq-bot` |
| 装哪个版本：`版本：v0.1.0` | `main` 分支最新代码 |
| SnowLuma 在哪：`SnowLuma 目录：D:\xxx` | `C:\SnowLuma` |
| 语义检索：要 / 不要 | 要（多下约 450MB 依赖 + 约 100MB 模型） |
| 装完直接打开总开关：是 / 否 | 否 |

要真正做到全程不用你动手，还需要：

- **DSH 会话开「完全访问（Full access）」**。不开的话，装插件、改配置文件、重启 SnowLuma 时 DSH 会弹窗，等你点批准。
- QQ 已经在 SnowLuma 里**扫码登录**好了。扫码只能你来。

全自动时，AI **仍然会把风险清单完整列出来**，只是不停下等你回复。最后一步「在群里发一句话，看它回不回」也需要你自己来。

---

## 风险（务必先看）

AI 安装时会把这份清单原样列给你：

1. **QQ 账号风险**：SnowLuma 是非官方方式登录 QQ，机器人可能违反腾讯的用户协议，QQ 号有被限制、冻结的可能。建议用小号。
2. **它用你的 QQ 号说话**：回复由模型生成，可能说错话、说不合适的话；群友看到的是这个 QQ 号发的。
3. **隐私**：白名单群里的消息（以及图片、视频的描述）会发给模型提供商用来生成回复。长期记忆（群友的事实、画像、聊天原文归档）只存在本机 `%USERPROFILE%\.dsh\qq-bot\`。
4. **费用**：每条回复都会调用模型、消耗 token；识图、看视频更费。
5. **会修改 SnowLuma 配置并重启它**：改之前会先备份；重启时 QQ 会掉线十几秒。
6. **会从 GitHub 下载代码并在 DSH 里运行**：插件能读写本机文件、能联网。默认装的是 `main` 分支最新代码，不是正式发布版。
7. **语义检索（可选）**：会多下载约 450MB 依赖（包含会执行安装脚本的原生模块）和约 100MB 模型（`Xenova/bge-base-zh-v1.5`，从 ModelScope 下载）。
8. **本机端口**：插件在 `127.0.0.1:3101` 接收 SnowLuma 推送的消息，只有本机能访问。
9. **默认不说话**：装完总开关是关着的；打开以后也只回复白名单里的群。

---

## 装好以后

- **打开面板**：DSH 左侧栏点「QQ 机器人」（小鲸鱼图标）。右上角是**总开关**，打开后在群里发一句「在吗」验收。
- **升级到最新**：跟 DeepSeek 说「更新 QQ 机器人」，它会拉最新代码并重载插件，不用重新配置。
- **卸载**：跟 DeepSeek 说「卸载 QQ 机器人」。配置和记忆（`%USERPROFILE%\.dsh\qq-bot\`）默认保留，你明确要求才会删。

---

## 让 DeepSeek 记住这个技能（可选）

把仓库里的安装技能放进 DSH 的技能目录，以后在任何对话里说「安装 QQ 机器人」「更新 QQ 机器人」，DeepSeek 都能自己找到它。在 PowerShell 里执行：

```powershell
$d = "$env:USERPROFILE\.dsh\skills\install-qq-bot"
New-Item -ItemType Directory -Force $d | Out-Null
Invoke-WebRequest "https://raw.githubusercontent.com/YIYUJJ/qq-bot/main/.agents/skills/install-qq-bot/SKILL.md" -OutFile "$d\SKILL.md"
```

`raw.githubusercontent.com` 连不上的话，直接用上面的方式一或方式二就行，效果一样。

---

## 手动安装（不用 AI）

1. 下载代码：`git clone --depth 1 https://github.com/YIYUJJ/qq-bot.git`（或在 GitHub 页面下载 ZIP 解压）。
2. 要语义检索：在代码目录执行 `npm install --omit=dev`。
3. 装进 DSH：DSH 推荐让它的 AI 用插件管理工具安装（`plugin_manager install_bundle`，目标是代码目录的绝对路径）。不想用 AI 的话，可以在 DSH profile 目录（默认 `%USERPROFILE%\.dsh\profiles\desktop`）执行 `pnpm add link:<代码目录绝对路径>`，再在 DSH 插件列表里启用 `dsh-qq-bot`。
4. 写配置：`node <代码目录>\scripts\setup.mjs`（会问群号、管理员 QQ 等）。
5. 改 SnowLuma 配置（格式见 [AGENTS.md 第 9 步](./AGENTS.md#9-配置并重启-snowluma)），改完**重启 SnowLuma**。
6. 重载插件，体检：`node <代码目录>\scripts\doctor.mjs`，全部 ✅ 后在面板里打开总开关。

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
| 浏览器打开 `127.0.0.1:3101` 报错 | 正常：3101 只接收 SnowLuma 推送，面板在 DSH 左侧栏 |

更完整的排查方法见 [`docs/TESTING.md`](./docs/TESTING.md)。

---

## License

MIT
