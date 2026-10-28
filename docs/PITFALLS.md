# 踩坑记录（Pitfalls）

记录已经踩过、并且**已经在代码里加了检查**的问题，避免重复排查。

---

## 1. 配置留空 → 模型路由不可用 → 所有回复都是空的

**现象**

- 发消息没有任何回复
- 日志里只有一条奇怪的记录：`回复 2237116031｜ambient｜首字 0ms 总 1ms｜`（冒号后面是空的）
- 面板「状态」看起来一切正常：WS 已连接、HTTP 通、QQ 在线、白名单也有

**原因**

`config.provider` / `config.model` 留空时，插件用「DSH 当前默认模型」。如果默认 provider 当时**没有可用模型**（未登录、被下线、模型列表为空），每次调用都会**瞬间失败**：

```
finish.kind = 'error'，text = ''
```

插件拿到空文本，什么都不发——看起来就像"没连上"，但链路其实是通的。

**怎么发现的**

日志里那条 `首字 0ms 总 1ms` 的空回复是唯一线索；正常情况下首字至少要几百毫秒。

**修复**

显式配置模型路由（不要留空）：

```json
{
  "provider": "deepseek-account",
  "model": "deepseek-flash"
}
```

**现在已经加的检查**

| 位置 | 检查 |
|---|---|
| 面板「诊断」页 / `qqbot_selfcheck` | 「模型路由」项：验证配置的 provider **真的有模型**，且 model 在列表里；留空会给出 warn |
| 生成失败时 | 日志明确写 `生成失败：error - <原因>（provider/model）`，不再只留一条空回复 |
| `scripts/doctor.mjs` | 「模型路由」检查 + 扫最近 300 行日志有没有「生成失败」 |

**同类问题的通用处理**

1. 任何"明明连上了却不回"的情况，先看日志结尾有没有 `生成失败`
2. 用 `qqbot_llm_models` 看 provider 下面到底有没有模型
3. 用 `qqbot_selfcheck` 看「模型路由」是不是 ✅

---

## 2. 改完 SnowLuma 配置不重启 → 改了个寂寞

**现象**：改了 `onebot_<uin>.json` 的端口/推送地址，插件还是连不上旧地址。

**原因**：SnowLuma 只在启动时读配置。

**修复**：改完必须重启 SnowLuma（`launcher.bat`）。

**已加检查**：`doctor.mjs` 会把 SnowLuma 配置里的端口/推送地址和插件配置对比，不一致直接报错。

---

## 3. 插件代码写错 → 整个插件被卸载，`qqbot_*` 工具全消失

**现象**：所有 `qqbot_*` 工具报 unknown tool。

**原因**：`apply()` 抛异常（常见是 TDZ：`const` 在声明前被引用），Cordis 把插件标成 failed。

**修复**：

```
plugin_manager list_plugins → 找 entryId include:qq-bot / dsh-qq-bot
plugin_manager set_plugin target=<entryId> enabled=true
```

**预防**：改完先跑 `npm test` + `node scripts/smoke.mjs --quick`，再重载。

---

## 4. 开机后机器人不在线

**现象**：重启电脑后群里不回，`qqbot_health` 报 `fetch failed`。

**原因**：SnowLuma 不会开机自启，插件连不上 3000 端口。

**修复**：面板「运维日志」→「🚀 开机自启」打开（会在 Windows 启动文件夹放一个脚本）。也可以用 `qqbot_autostart` 工具。

**已加检查**：`doctor.mjs` 会检查 3000 端口 / QQ 是否在线，掉线时直接给修复建议。
