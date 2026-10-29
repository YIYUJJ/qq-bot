# AGENTS.md — 给 AI 的安装说明书

> 项目：**qq-bot**（DSH 插件包名 `@dsh-external/dsh-qq-bot`，两者不要混淆）
> 仓库：<https://github.com/YIYUJJ/qq-bot>
>
> 读者：DSH（DeepSeek Harness）里能操作本机终端的 AI。用户可能只给了你上面这个仓库地址。
> 目标：从零把 QQ 机器人装好、连上、体检通过。**默认安装 `main` 分支的最新代码。**
>
> 严格按顺序做，每一步都要验证。不要跳步，不要"假设已经装好"，不要替用户编造没给的值。
> 本文件会随版本更新：**以你刚下载到的那一份为准**，不要凭记忆操作。

---

## 0. 完成标准

1. `node scripts/doctor.mjs` 输出「全部通过」
2. 用户在白名单群里发一句话，机器人回复了（由用户确认）

第 2 条需要先打开总开关，而打开总开关要用户同意（第 2 节第 9 项）。用户没同意打开，就做到第 1 条为止，并告诉用户怎么自己打开。

---

## 1. 两种模式

| 模式 | 什么时候用 | 风险清单（第 3 节） |
|---|---|---|
| **标准**（默认） | 其它所有情况 | 完整列出来，**停下，等用户回复同意**再继续 |
| **全自动** | 用户的第一条消息里给齐了第 2 节「必须提供」的全部 4 项，**并且明确写了同意风险**（例如「我已阅读并同意 AGENTS.md 第 3 节列出的风险」） | 照样**完整列出来**，然后直接继续，不停下 |

- 全自动模式下缺了任何一项必填，就退回标准模式，**一次性**把缺的项问齐，不要一项一项问。
- 第 2 节末尾那几件「只能用户做」的事，任何模式下碰到都要停下。
- DSH 自己的批准弹窗不归你控制：会话不是「完全访问（Full access）」时，`plugin_manager`、写工作区以外的文件、执行命令都可能弹窗等用户点批准。要做到全自动，需要用户事先把会话设成完全访问，或者守在旁边点批准。

---

## 2. 要用户提供的信息

### 必须提供

| # | 项目 | 用途 |
|---|---|---|
| 1 | 允许机器人说话的**群号**（一个或多个，5~12 位数字） | `allowGroups`；为空 = 谁都不回 |
| 2 | **管理员 QQ 号**（可以私聊遥控、让它撤回） | `adminQQ` |
| 3 | **同意第 3 节的风险** | 继续安装的前提；不同意就什么都不改 |
| 4 | **是否允许修改 SnowLuma 配置并重启 SnowLuma**（重启时 QQ 会掉线十几秒） | 第 9 步；不允许 → 只写好配置，请用户自己重启 |

### 可选（没提供就用默认值）

| # | 项目 | 默认值 |
|---|---|---|
| 5 | 代码放在哪 | `%USERPROFILE%\dsh-plugins\qq-bot`（不要放进 `%USERPROFILE%\.dsh` 里面） |
| 6 | 装哪个版本 | `main` 分支最新代码；用户指定了 tag（如 `v0.1.0`）就用那个 |
| 7 | SnowLuma 装在哪 | `C:\SnowLuma` |
| 8 | 要不要语义检索（按意思找记忆，"猫"能搜到"养了只橘子"） | **要**：多下约 450MB 依赖，第一次用时再下约 100MB 模型。不要：只用关键词检索，其它功能不受影响 |
| 9 | 装完是否直接打开总开关 | **不打开**；用户明确说打开才打开 |

QQ 号不用问：从 SnowLuma 的 `config\onebot_<QQ号>.json` 文件名读出来；有多个文件就问用户用哪个。

### 只能用户做的（碰到就停下，告诉用户要做什么）

- 安装 DSH、安装 SnowLuma（包括同意 SnowLuma 的 EULA）
- 在 SnowLuma 里扫码登录 QQ
- 在群里发消息验收
- 点 DSH 的批准弹窗（会话不是完全访问时）

---

## 3. 风险清单（每次安装都要完整展示给用户，一条都不能省）

1. **QQ 账号风险**：SnowLuma 是非官方方式登录 QQ，机器人可能违反腾讯的用户协议，QQ 号有被限制、冻结的可能。建议用小号。
2. **它用你的 QQ 号说话**：回复由模型生成，可能说错话、说不合适的话；群友看到的是这个 QQ 号发的。
3. **隐私**：白名单群里的消息（以及图片、视频的描述）会发给模型提供商用来生成回复。长期记忆（群友的事实、画像、聊天原文归档）只存在本机 `%USERPROFILE%\.dsh\qq-bot\`。
4. **费用**：每条回复都会调用模型、消耗 token；识图、看视频更费。
5. **会修改 SnowLuma 配置并重启它**：改之前会先备份；重启时 QQ 会掉线十几秒。
6. **会从 GitHub 下载代码并在 DSH 里运行**：插件能读写本机文件、能联网。默认装的是 `main` 分支最新代码，不是正式发布版。
7. **语义检索（可选）**：会多下载约 450MB 依赖（包含会执行安装脚本的原生模块）和约 100MB 模型（`Xenova/bge-base-zh-v1.5`，从 ModelScope 下载）。
8. **本机端口**：插件在 `127.0.0.1:3101` 接收 SnowLuma 推送的消息，只有本机能访问。
9. **默认不说话**：装完总开关是关着的；打开以后也只回复白名单里的群。

- 标准模式：展示完停下，用户回复同意才继续。
- 全自动模式：展示完直接继续。
- 用户不同意（任何模式）：停止安装，什么都不改。

---

## 4. 检查环境

```powershell
node -v                                            # 需要 22 或更新
npm -v
git --version                                      # 没有也行，第 5 步可以下载压缩包
Test-Path "C:\SnowLuma\config"                     # SnowLuma 目录（用户给了别的路径就换）
Get-ChildItem "C:\SnowLuma\config\onebot_*.json"   # 能找到 = 这台电脑上的 SnowLuma 登录过 QQ
```

- 没有 Node.js 22+ 或 npm → 停下，请用户安装 Node.js LTS（<https://nodejs.org>），不要自行安装。
- SnowLuma 目录或 `onebot_*.json` 不存在 → 停下，请用户先装 SnowLuma 并扫码登录 QQ。

---

## 5. 下载最新代码

下面用 `$dir` 表示代码目录（默认 `%USERPROFILE%\dsh-plugins\qq-bot`）。

```powershell
$dir = "$env:USERPROFILE\dsh-plugins\qq-bot"
if (Test-Path "$dir\.git") {
  git -C $dir pull --ff-only                                    # 装过：更新到最新
} else {
  git clone --depth 1 https://github.com/YIYUJJ/qq-bot.git $dir  # 第一次装
}
git -C $dir log -1 --format="%h %ci"                            # 记下版本，最后汇报
```

没有 git 时下载压缩包：

```powershell
$zip = "$env:TEMP\qq-bot-main.zip"
Invoke-WebRequest "https://github.com/YIYUJJ/qq-bot/archive/refs/heads/main.zip" -OutFile $zip
Expand-Archive $zip "$env:TEMP\qq-bot-main" -Force
Move-Item "$env:TEMP\qq-bot-main\qq-bot-main" $dir     # 压缩包里多一层 qq-bot-main 目录
```

- 用户指定了版本：`git clone --depth 1 --branch <tag> https://github.com/YIYUJJ/qq-bot.git $dir`
- 目录已经存在但不是这个仓库 → 停下问用户，**不要覆盖**。
- 本地有改动导致 `pull` 失败 → 停下告诉用户，**不要** `reset`、不要删除。
- GitHub 连不上 → 停下，请用户手动下载压缩包，并告诉你放在哪。

验证：`$dir\lib\index.js` 存在，`$dir\package.json` 里的 `name` 是 `@dsh-external/dsh-qq-bot`。

---

## 6. 安装依赖（只有语义检索需要）

```powershell
cd $dir
npm install --omit=dev      # 要语义检索时执行；不要语义检索就跳过这一步
node -e "import('@huggingface/transformers').then(() => console.log('ok'))"   # 输出 ok 才算装好
```

下载失败可以重试一次；还失败就跳过（语义检索会自动退回关键词检索，聊天不受影响），并在汇报里说明。

---

## 7. 把插件装进 DSH

用 DSH 的插件管理工具，**不要**手改 profile 的 `package.json` / `cordis.patch.yml`，也不要在 profile 目录里跑 pnpm（DSH 自带的 `cordis-plugin-development` 说明也是这样要求的）：

```
plugin_manager action=install_bundle target=<$dir 的绝对路径>
```

- 看返回的 `application` 和 `warnings`：
  - `applied` → 已生效
  - `restart-required` → 请用户重启 DSH，重启后接着往下做
  - `failed` → 把完整返回贴给用户，停下
- 返回里有待批准的构建脚本（pending builds）时：标准模式先问用户；全自动模式只有在用户要了语义检索（第 2 节第 8 项）时才传 `approvedBuilds`。
- 已经装过（这次是升级）：不用重新安装，代码目录已经是新代码，**重载插件**即可（第 10 步）。

验证：`plugin_manager action=list_plugins` 里能看到 `dsh-qq-bot`。

---

## 8. 写插件配置

```powershell
node "$dir\scripts\setup.mjs" --non-interactive --groups=<群号，多个用逗号> --admin=<管理员QQ> --snowluma=C:/SnowLuma
```

- 写入 `%USERPROFILE%\.dsh\qq-bot\config.json`；已有的其它配置项会保留，只更新这几项。
- 这个脚本**不会**打开总开关。
- 不要把 `config.json` 的内容贴进对话（里面有 token）。

---

## 9. 配置并重启 SnowLuma

先备份：

```powershell
$cfg = "C:\SnowLuma\config\onebot_<QQ号>.json"
Copy-Item $cfg "$cfg.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
```

保证 `networks` 里有下面三项（字段名以这台电脑上 SnowLuma 的实际文件为准；其它字段和已有的 `accessToken` **原样保留**，已经有同样的项就不要重复加）：

```jsonc
"networks": {
  "httpServers": [{ "name": "http-default", "host": "127.0.0.1", "port": 3000, "path": "/",
                    "accessToken": "<保留原值>", "messageFormat": "array" }],
  "wsServers":   [{ "name": "ws-default", "host": "127.0.0.1", "port": 3001, "path": "/",
                    "role": "Universal", "accessToken": "<保留原值>", "messageFormat": "array" }],
  "httpClients": [{ "name": "dsh-qq-bot-push", "url": "http://127.0.0.1:3101/qq-bot/push",
                    "enabled": true, "messageFormat": "array", "reportSelfMessage": false, "timeoutMs": 5000 }]
}
```

用户不允许重启（第 2 节第 4 项）→ 改完配置就停下，请用户自己重启 SnowLuma，好了再告诉你。

用户允许时重启（SnowLuma 的配置不会热加载，必须重启）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.ExecutablePath -like '*SnowLuma*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process -FilePath "C:\SnowLuma\launcher.bat" -WorkingDirectory "C:\SnowLuma"
```

等 10~20 秒，验证 QQ 在线：

```powershell
$t = (Get-Content $cfg -Raw | ConvertFrom-Json).networks.httpServers[0].accessToken
Invoke-RestMethod "http://127.0.0.1:3000/get_login_info" -Method Post `
  -Headers @{ authorization = "Bearer $t"; 'content-type' = 'application/json' } -Body '{}'
```

`status` 是 `ok` 才算通过；不是就停下，告诉用户「QQ 需要在 SnowLuma 里重新扫码登录」。

---

## 10. 重载插件并体检

插件不会自动读新写的配置，要重载一次：

```
plugin_manager action=set_plugin target=<dsh-qq-bot 的 entryId> enabled=false
plugin_manager action=set_plugin target=<dsh-qq-bot 的 entryId> enabled=true
```

（也可以请用户在面板右上角点「🔄 刷新」。）然后体检：

```powershell
node "$dir\scripts\doctor.mjs"
```

- 全部 ✅ → 下一步
- 有 ❌ → 按输出里的修复建议逐项处理，再跑一次
- 连续 3 次修不好 → 停下，把 doctor 的完整输出发给用户

---

## 11. 打开总开关并验收

- 用户同意了装完直接打开（第 2 节第 9 项）：把 `%USERPROFILE%\.dsh\qq-bot\config.json` 里的 `"enabled"` 改成 `true`，再按第 10 步重载插件。
- 否则：告诉用户在 DSH 左侧栏点「QQ 机器人」（小鲸鱼图标）打开面板，在右上角打开「总开关」。

然后请用户在白名单群里发一句「在吗」，确认机器人回复了。

---

## 12. 汇报

装完告诉用户：

- 装的版本（commit 和日期）、代码目录
- 改了哪些文件，备份放在哪（SnowLuma 配置的备份）
- 语义检索装了没有
- doctor 的结果
- 面板怎么打开（DSH 左侧栏「QQ 机器人」），总开关现在是开还是关
- 以后怎么升级、怎么卸载（下一节；也可以直接跟 AI 说「更新 QQ 机器人」「卸载 QQ 机器人」）

---

## 升级 / 卸载

- **升级**：第 5 步（`git pull`）→ 第 6 步 → 第 10 步（重载插件 + doctor）。不用重写配置，不用动 SnowLuma。
- **卸载**：`plugin_manager action=list_bundles` 找到它，再 `action=remove_bundle`；把 SnowLuma 配置换回备份并重启 SnowLuma；代码目录可以删除。`%USERPROFILE%\.dsh\qq-bot\`（配置和记忆）**只有用户明确要求时**才删。

---

## 禁止事项

- ❌ 用户没同意风险就继续安装
- ❌ 自己往 `allowGroups` 里加群"测试一下"（会把机器人放进陌生群）
- ❌ 用户没同意就打开总开关
- ❌ 提交、上传或打印 `config.json`、SnowLuma 配置里的 token
- ❌ 自行安装 DSH / SnowLuma / Node.js / QQ 客户端，或升级用户现有的 QQ 客户端（可能破坏 SnowLuma）
- ❌ 手改 DSH profile 的 `package.json` / `cordis.patch.yml`，或在 profile 目录里跑 pnpm（用 `plugin_manager`）
- ❌ 把代码放进 `%USERPROFILE%\.dsh` 里
- ❌ `git reset --hard`，或删除用户已有的目录、数据

---

## 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| 插件的工具全部消失 | 插件加载失败 | `plugin_manager action=list_plugins` 看状态；把报错贴给用户，修好后重新启用 |
| doctor 说 3000 端口连不上 | SnowLuma 没启动，或端口不对 | 启动 SnowLuma，核对第 9 步的配置 |
| doctor 说 QQ 未登录 | 登录过期 | 请用户在 SnowLuma 里重新扫码 |
| 日志里有「已连接」但群里不回 | `allowGroups` 没填，或总开关关着 | 改配置后重载插件 |
| 改了 SnowLuma 配置没反应 | 没重启 SnowLuma | 重启 SnowLuma |
| 识图报 `max-tokens` | 当前模型不支持图片 | 在面板「识图」里配 `visionProvider` / `visionModel` |
| 语义检索一直「没装」 | 第 6 步没成功 | 在代码目录重新 `npm install --omit=dev`，再重载插件 |
