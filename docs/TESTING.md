# QQ 机器人：测试与排查手册

> 最后更新：2026-10-28
> 适用版本：`@dsh-external/dsh-qq-bot` v0.1.0

这套东西的目标只有一个：**改完任何代码，能在 30 秒内知道有没有改坏**，而不是等插件掉线、群里不回。

---

## 一、三层检查体系

```
第 1 层  静态扫描    tools/static-scan.cjs      语法能过、但运行时才炸的问题
第 2 层  冒烟测试    scripts/smoke.mjs          改完还能不能跑（12 项，含依赖注入审计）
第 3 层  端到端      手动 / 工具调用             关键链路真的能用
```

三层都过才算"改完"。只跑第 1 层不够——本轮 3 个 bug 里，有 2 个是第 3 层才发现的。

---

## 二、第 1 层：静态扫描

```bash
cd D:\dpswork\packages\dsh-qq-bot
node tools/static-scan.cjs
```

扫 9 类问题：

| 检查 | 为什么重要 |
|---|---|
| `config.xxx` 键不存在 | 配置键打错 → 永远读 undefined，功能静默失效（本轮抓到 `visionMaxImages`） |
| 重复的顶层函数声明 | 后一个覆盖前一个，前一个逻辑永远不执行 |
| `sendReply` 未 await | 消息丢失或乱序 |
| `JSON.parse` 没包 try | 模型输出不规范时整条链路崩 |
| 重复 DOM id | `$('#x')` 只绑到第一个，第二个按钮点不动 |
| 面板 action 与后端 case 不匹配 | 点了按钮没反应 |
| 分组没有导航页 | 参数存在但界面看不到（之前"视频页空白"就是这个） |
| onclick 指向不存在的函数 | 点了报错 |
| 模块用了但没 import | 运行时 `ReferenceError`（本轮拆 features 时踩过 `drawLot`） |

**注意误报**：`config.json` 会被误认成 `config` 的键；`.join(` 会被误认成未导入的 `join`；`const saveMemory = async () =>` 会被误认成未定义函数。看结果时先判断这三类。

---

## 三、第 2 层：冒烟测试

```bash
node scripts/smoke.mjs          # 全量（约 5 秒）
node scripts/smoke.mjs --quick  # 跳过单测（约 2 秒）
```

12 项检查：

| # | 检查 | 失败意味着 |
|---|---|---|
| 1 | 源码语法（全部 .mjs / .js） | 有文件写坏了 |
| 2 | 面板脚本语法 | `panel/index.html` 内联 JS 有错 |
| 3 | 面板产物不是旧的 | 改了 panel 忘记 `node build-client.mjs` |
| 4 | 单测（全部单元 + 集成，63 套） | 任一模块逻辑回归 |
| 5 | 配置文件可读 | config.json 坏了或白名单空 |
| 6 | 元数据 / 房间键一致 | 配置项、面板元数据、分组对不上 |
| 7 | 配置类型一致 | 面板字段类型与后端校验不一致 |
| 8 | 模块依赖注入完整 | 模块用了 index 的名字但没注入（运行时才炸） |
| 9 | 模块导出齐全 | `features.mjs` / `extras.mjs` 被改坏 |
| 10 | 插件启动过且无致命错误 | 启动后出现 `ReferenceError` 之类 |
| 11 | SnowLuma 网关可达 | OneBot 端断了 |
| 12 | 推送端口在监听 | 插件的 HTTP 推送服务没起来 |

失败会返回非 0，可以挂到任何自动化里。

---

## 四、第 3 层：端到端验证

静态和冒烟都过不了运行时语义，关键链路要真跑一遍。

### 4.1 合并转发

```bash
# 1) 先在群里真发一条转发（3 个节点），拿到 forward_id
# 2) 用 forward_id 模拟一条消息
qqbot_simulate { room: 123456789, text: '这几条在聊啥', forwardId: '<forward_id>' }
# 3) 看日志
#    期望：读合并转发：3 条
#    期望：回复里能说出转发内容
```

### 4.2 文档读取

```js
qqbot_simulate({
  room: '123456789',
  text: '这文件讲了什么',
  fileUrl: 'https://www.gutenberg.org/files/11/11-0.txt',
  fileName: 'alice.txt',
})
// 期望日志：读文件：alice.txt｜3000 字
// 期望回复：能概括文件内容
```

### 4.3 视频

```js
qqbot_video({ source: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' })
// 期望：给出「时长 + 画面描述」
// 第二次同链接应走缓存（~1ms）
```

### 4.4 小游戏 / 投票 / 提醒 / 撤回

```js
qqbot_simulate({ room: '123456789', text: '掷骰子' })
qqbot_simulate({ room: '123456789', text: '发起投票：晚饭吃啥 / 面 / 饭' })
qqbot_simulate({ room: '123456789', text: '投 2' })
qqbot_simulate({ room: '123456789', text: '投票结果' })
qqbot_simulate({ room: '123456789', text: '1分钟后提醒我喝水' })
qqbot_simulate({ room: '123456789', text: '撤回' })          // 管理员才会真撤
qqbot_simulate({ room: '123456789', text: '撤回', sender: '10002' }) // 非管理员，不应撤
```

### 4.5 面板接口

```js
qqbot_panel()        // 字段齐全 / 分组数 / 表情数 / usage
qqbot_selftest_ops() // 17 项底层功能（敷衍判定、归一、优先级、防重复、自检、用量、记忆、检索、搜索意图、隐私、视觉路由、拍一拍、群成员、图库、日志、配置导入导出）
```

---

## 五、排查流程（从现象到根因）

1. **先确认存活**：`qqbot_status()`。工具不存在 = 插件没挂载，直接跳到"复活流程"。
2. **看日志尾部**：`C:\Users\22371\.dsh\qq-bot\bot.log`（UTC 时间，本地 +8）。
3. **定位层级**：是"没收到"（轮询/推送）、"没回复"（决策/概率）、"回了但不对"（提示词/记忆/分句）、还是"发不出去"（OneBot/白名单）。
4. **复现**：用 `qqbot_simulate` 注入同样的文本，不要等真人再发一次。
5. **隔离**：把嫌疑代码单独 import 跑（`node -e "import('./lib/xxx.mjs')…"`），比整插件重启快。
6. **修完必须有证据**：日志行、群里的消息、`smoke` 输出，三选一以上。

### 复活流程（插件掉线，`qqbot_*` 工具全没了）

`qqbot_reload` 会跟插件一起消失，唯一通道是 `plugin_manager`：

```
plugin_manager list_plugins            → 找 entryId "include:dsh-qq-bot"
plugin_manager set_plugin enabled=true → 重新挂载
```

若挂载再次失败，先 `git checkout -- lib/` 回滚到上一个提交，再启用。

---

## 六、本轮抓到的真 bug（案例库）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| 1 | 说「投票结果」它回"投票至少要有两个选项" | 开投票正则 `^(?:发起投票\|投票)[:：]?\s*(.+)$` 把"结果"当选项列表 | 开投票必须带分隔符；结果/结束分支优先判断 |
| 2 | 投票公告被切成两条（"投票：" + 剩下的） | 分句把全角冒号 `：` 当句末 | 公告改用「投票｜」，不用冒号 |
| 3 | 面板能改"最多看几张图"，但保存无效 | 只加了元数据，没加 `DEFAULT_CONFIG` 默认值 → `applyConfigPatch` 拒绝该键 | 补默认值 `visionMaxImages: 2` + NUMERIC |
| 4 | 恢复备份后配置没生效 | `reloadSelf` 在文件未变时是 no-op（`reconcileProfile([])`） | 改成软重载：重读配置/覆盖/记忆/提醒/投票 |

---

## 七、已知盲区（这些还没自动覆盖）

1. **浏览器 UI 交互**：按钮点击、表单校验、切页丢草稿，只能人工点。
2. **移动端布局**：没测过窄屏。
3. **真实 QQ 语音条**：ASR 没做。
4. **长视频（>5 分钟）**：只测过 90 秒和 8 秒。
5. **多人同时说话**：并发 flush 的竞态只在逻辑上推演过。
6. **备份恢复的完整回滚**：只验证了配置和记忆，没验证表情库/视频缓存。

---

## 八、加新检查的原则

1. 每修一个 bug，**先想"怎么用一条命令复现"**，能复现就把它加进 `smoke` 或 `static-scan`。
2. 检查要**快**（全量 < 10 秒），慢了就不会跑。
3. 允许 `soft` 检查：SnowLuma/端口这类外部依赖，失败只警告不阻塞。
4. 输出必须**能一眼看出哪个坏了**（✅/❌ + 文件名:行号）。

---

## 附：常用命令速查

```bash
cd D:\dpswork\packages\dsh-qq-bot

node tools/static-scan.cjs        # 静态扫描
node scripts/smoke.mjs            # 冒烟（全量）
node scripts/smoke.mjs --quick    # 冒烟（快）
node build-client.mjs             # 改完 panel 必须重跑
node lib/test-policy.mjs          # 单测
git log --oneline -5              # 最近改动
```
