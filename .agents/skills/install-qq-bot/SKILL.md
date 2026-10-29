---
name: install-qq-bot
description: 安装、更新或卸载 qq-bot —— DSH 的 QQ 群拟人聊天机器人插件（仓库 https://github.com/YIYUJJ/qq-bot ，插件包名 @dsh-external/dsh-qq-bot，经 SnowLuma / OneBot v11 接入 QQ）。用户说「安装 / 更新 / 卸载 QQ 机器人」「装个 QQ 群机器人」，或者给出这个仓库地址时使用。
---

# 安装 / 更新 / 卸载 qq-bot

这份技能只负责把你带到正确的说明书。**完整步骤、风险清单、全自动模式的条件都在仓库根目录的 `AGENTS.md` 里**，以你下载到的最新那一份为准，不要凭记忆操作。

## 1. 拿到最新代码（默认 `main` 分支）

```powershell
$dir = "$env:USERPROFILE\dsh-plugins\qq-bot"     # 用户指定了别的目录就换；不要放进 %USERPROFILE%\.dsh 里
if (Test-Path "$dir\.git") { git -C $dir pull --ff-only } else { git clone --depth 1 https://github.com/YIYUJJ/qq-bot.git $dir }
```

- 没有 git：下载 <https://github.com/YIYUJJ/qq-bot/archive/refs/heads/main.zip> 解压到 `$dir`。
- 目录已存在但不是这个仓库、或本地有改动导致 `pull` 失败：停下问用户，不要覆盖、不要 `reset`。

## 2. 读 `$dir\AGENTS.md`，从第 0 节开始严格照做

要点（细节以 AGENTS.md 为准）：

- 先判断**标准模式**还是**全自动模式**（AGENTS.md 第 1、2 节）。
- **风险清单（第 3 节）每次都要完整展示**。标准模式展示后停下等用户同意；全自动模式只有在用户第一条消息里明确同意了风险时才不停。
- 扫码登录 QQ、安装 DSH / SnowLuma、在群里发消息验收，这些只能用户做，碰到就停。
- 用 `plugin_manager install_bundle` 安装，不要手改 DSH profile。

## 更新 / 卸载

- 更新：第 1 步拉最新代码，然后按 AGENTS.md「升级 / 卸载」一节重载插件并体检。
- 卸载：按 AGENTS.md「升级 / 卸载」一节操作；用户的配置和记忆（`%USERPROFILE%\.dsh\qq-bot\`）只有用户明确要求时才删。
