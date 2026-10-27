# AGENTS.md — 给 AI 的安装说明书

> 项目名：**qq-bot**（插件包名：`@dsh-external/dsh-qq-bot`，两者不要混淆）

> 你是一个能操作本机终端的 AI。用户把这个仓库交给了你，目标是**把 QQ 机器人装好并连上**。
> 严格按下面的步骤做，每一步都要验证，不要跳步，不要"假设已经装好"。

---

## 0. 完成标准（全部满足才算装完）

```
1. node scripts/doctor.mjs 输出「全部通过」
2. 用户在指定群里发一条消息，机器人回复了一句（由用户确认）
```

任何一项不满足，都不能宣布安装完成。

---

## 1. 先停下，问用户这 5 件事

**不要自己猜，也不要填示例值。**

| 问题 | 用途 |
|---|---|
| 1. DSH 是否已安装？profile 目录在哪（默认 `C:\Users\<你>\.dsh\profiles\desktop`） | 插件要 link 进去 |
| 2. SnowLuma 装在哪？（默认 `C:\SnowLuma`）QQ 号是多少？ | 读它的 OneBot 配置 |
| 3. 允许机器人说话的**群号**（一个或多个） | `allowGroups`，默认空 = 谁都不回 |
| 4. **管理员 QQ 号**（可以私聊遥控、让它撤回） | `adminQQ` |
| 5. 是否同意重启 SnowLuma？重启期间 QQ 会短暂掉线 | 必须有人确认 |

另外确认两件**只能用户做**的事：

- QQ 已经在 SnowLuma 里**扫码登录成功**
- 用户接受：消息会发给模型厂商；QQ 机器人可能违反腾讯条款，风险自负

---

## 2. 检查环境

```powershell
node -v                 # 需要 >= 18
pnpm -v                 # 没有就 npm i -g pnpm
Test-Path "$env:USERPROFILE\.dsh\profiles\desktop"     # DSH profile
Test-Path "C:\SnowLuma\config"                          # SnowLuma
```

任何一项失败 → 停下来告诉用户缺什么，不要自行安装 DSH 或 SnowLuma。

---

## 3. 把插件装进 DSH profile

```powershell
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add link:<本仓库绝对路径>
```

验证：

```powershell
Test-Path ".\node_modules\@dsh-external\dsh-qq-bot\lib\index.js"
```

必须为 `True`。如果 pnpm 报错，把完整报错发给用户，不要反复重试。

---

## 4. 生成插件配置

推荐用脚本（会交互提问，写好后可再手改）：

```powershell
node scripts/setup.mjs
```

或手工写 `%USERPROFILE%\.dsh\qq-bot\config.json`，**最少包含**：

```jsonc
{
  "enabled": false,                 // 先别开！等 doctor 全过再开
  "snowlumaHome": "C:/SnowLuma",
  "allowGroups": ["<群号>"],
  "adminQQ": ["<管理员QQ>"],
  "memoryRooms": ["<群号>", "<管理员QQ>"],
  "pushPort": 3101
}
```

> 不要写 `"enabled": true`，最后一步再让用户开。

---

## 5. 配置 SnowLuma

找到 `C:\SnowLuma\config\onebot_<QQ号>.json`，保证三处与插件一致：

```jsonc
"httpServers": [{ "host": "127.0.0.1", "port": 3000, "accessToken": "<原样保留>" }],
"wsServers":   [{ "host": "127.0.0.1", "port": 3001 }],
"httpClients": [{ "url": "http://127.0.0.1:3101/qq-bot/push", "enabled": true,
                  "message": true, "notice": true }]
```

改完**必须重启 SnowLuma**（配置不会热加载）：

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.ExecutablePath -like '*SnowLuma*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process -FilePath "C:\SnowLuma\launcher.bat" -WorkingDirectory "C:\SnowLuma"
```

重启后验证 QQ 在线：

```powershell
$cfg = Get-Content "C:\SnowLuma\config\onebot_<QQ号>.json" -Raw | ConvertFrom-Json
$t = $cfg.networks.httpServers[0].accessToken
Invoke-RestMethod "http://127.0.0.1:3000/get_login_info" -Method Post `
  -Headers @{ authorization = "Bearer $t"; 'content-type' = 'application/json' } -Body '{}'
```

`status` 必须是 `ok`。不是就停下，告诉用户"QQ 需要重新扫码登录"。

---

## 6. 启用插件

用 DSH 的插件管理工具（不是改文件）：

```
plugin_manager action=list_plugins            → 找 entryId 含 dsh-qq-bot
plugin_manager action=set_plugin target=<entryId> enabled=true
```

如果工具不可用，才改 profile 配置并让用户重启 DSH。

---

## 7. 体检并迭代

```powershell
node scripts/doctor.mjs
```

- 全 ✅ → 进入第 8 步
- 有 ❌ → 按输出的"修复建议"逐项处理，再跑一次
- 连续 3 次修不好 → 停下，把 doctor 的完整输出发给用户

---

## 8. 让用户开开关并验收

1. 让用户打开面板（`http://127.0.0.1:3101/qq-bot`）把 `enabled` 打开
2. 让用户在群里发一句「在吗」
3. 确认机器人回复了

回复成功 → 把 `node scripts/doctor.mjs` 的输出贴给用户，宣布完成。

---

## 禁止事项

- ❌ 不要修改用户的 `allowGroups` 去"测试一下"（会把机器人放进陌生群）
- ❌ 不要提交、上传或打印 `config.json` 里的 token
- ❌ 不要自行安装 DSH / SnowLuma / 其他 QQ 客户端
- ❌ 不要为了"让它说话"而打开 `enabled` 却跳过白名单校验
- ❌ 不要重装、升级用户现有的 QQ 客户端（可能破坏 SnowLuma 的 hook）

---

## 常见故障

| 现象 | 原因 | 处理 |
|---|---|---|
| 插件工具全消失 | 插件加载失败 | `plugin_manager` 里看 fiberPhase，回滚代码后重新启用 |
| doctor 说 3000 连不上 | SnowLuma 没启动 / 端口不对 | 启动 SnowLuma，核对 onebot 配置 |
| 日志有 `已连接` 但群里不回 | `allowGroups` 没填 / `enabled` 关着 | 改配置后重载插件 |
| 改 SnowLuma 配置无效 | 没重启 | 重启 SnowLuma |
| 识图报 max-tokens | 模型不支持图片 | 配置 `visionProvider` / `visionModel` |
