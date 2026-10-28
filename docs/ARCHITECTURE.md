# qq-bot 架构说明

> 插件包：`@dsh-external/dsh-qq-bot`｜显示名：qq-bot
> 本文描述拆分后的模块边界、依赖方向和测试策略。`lib/index.js` 只负责**装配**。

---

## 1. 分层

```
lib/index.js                 装配：读配置 → 创建各模块 → 挂 ctx.effect / 注册工具 / 启动
   │
   ├─ 领域模块（不依赖 index）
   │   config-store   配置读写/校验/热重载
   │   room-config    每群覆盖 + cfgFor 缓存
   │   room-state     会话运行时状态
   │   access         白名单闸（群/私聊/必回）
   │   state-init     持久化容器（facts/stickers/usage/replied/outbox）
   │   memory-store   长期记忆存储（事实/相似度/选取）
   │   memory-ai      记忆模型侧（提炼/画像/摘要/关系/导出）
   │   memory-auto    自动记忆维护（阈值触发）
   │   prompt         人设/情绪/转录/系统提示词
   │   decision       回复决策（优先级/静音/概率/冷却）
   │   model          模型调用（generate/analyze/关键词）
   │   model-route    模型路由（对话 + 视觉，含回退缓存）
   │   notes          链接/搜索/视频链接笔记
   │   vision         视觉链路（下载→压缩→识图→写回）
   │   video-chain    视频抽帧描述 + 结果缓存
   │   video-files    临时目录清理 + ffmpeg 路径
   │   media-cache    识图缓存 + 媒体 key 归一
   │   sticker-store  图库持久化（脏标记合并写）
   │   sticker-net    图库网络（本地化/收藏/发送/维护）
   │   outbox         发送失败重试队列
   │   polling        轮询兜底（基线 + 拉取）
   │   scheduler      主动说话 + 轮询定时器
   │   startup        启动序列（连接/迁移/基线/推送/轮询）
   │   backup         备份/软重载/重启 DSH
   │   ops            运维（恢复/历史检索/日志尾/原子写/连接信息）
   │   panel-mount    面板挂载（webServer 注册 + 重试）
   │   panel-state    面板数据拼装
   │   http-api       面板 API（45 个 op）
   │   register-tools 工具注册（16 个工厂）
   │
   └─ 基础设施
       schema       配置唯一真相（默认值/类型/键集合）
       meta         面板元数据（129 项）
       safe         错误隔离（safe/safeAsync/wrapTool/进程兜底）
       store        原子写/写队列/单实例锁/SQLite KV
       metrics      计数/延迟/JSONL 事件/最近事件
       state-store  replied/usage 持久化（脏标记 + SQLite）
       state-db     SQLite 状态库（JSON 回落）
       memory       记忆文件助手
       roomcfg      每群覆盖合并与过滤
       admin-commands  管理员指令解析
       admin-flow      管理员遥控流程
       ingest       消息归一化
       notices      撤回/拍一拍
       push-server  HTTP 推送接收端
       timers       后台定时任务
       vision-cache 识图缓存实现
       runtime      rooms/stats/timers/groupNames
       onebot       SnowLuma 接入
```

## 2. 依赖规则

1. **领域模块不 import `index.js`**，只 import 基础设施模块（`store`/`schema`/`memory` 等）。
2. 需要运行时状态（config/rooms/ob/stats…）时**由 index 注入**，模块导出 `*_DEPS` 清单 + 启动校验。
3. 初始化顺序敏感的依赖用**惰性 getter**（`getOb()`、`getCfgFor()`、`getSoftReload()`），避免 TDZ。
4. 检查手段：`node tools/check-module-deps.mjs`（已挂进 `smoke`），能发现"用了但没注入"的名字。

## 3. 测试策略

| 层次 | 文件 | 覆盖 |
|---|---|---|
| 单元 | `lib/test-*.mjs`（63 套） | 每个模块的依赖校验 + 关键分支 |
| 集成 | `lib/test-integration.mjs`（19 项） | 真实收消息→决策→生成→发送、表情入库、提醒、拍一拍、识图、撤回、投票、小游戏 |
| 冒烟 | `scripts/smoke.mjs` | 语法、面板产物、配置一致性、模块导出、依赖审计、网关/端口 |
| 体检 | `scripts/doctor.mjs` | 配置/连接/白名单/模型路由/日志可写 |

运行：`node scripts/run-tests.mjs`（全部单元+集成）。

## 4. 持久化

```
config.json / rooms.json        配置与每群覆盖（原子写）
state.db (SQLite)               replied / usage（空库时自动从 JSON 导入，失败回落 JSON）
stickers.json + stickers/       图库索引与本地文件
memory/group-*/                 每会话记忆（facts/profile/summary/relations/archive）
outbox.json                     发送失败重试队列
replied.json / usage.json       兼容用 JSON 备份
```

## 5. 可观测性

- **计数**：msgsIn / replies / skipped / llmCalls / sends / retries…
- **延迟**：firstTokenMs / totalMs / decideMs / sendMs 的 P50/P95
- **事件**：`events.jsonl`（reply / skip / trace），每条消息带 `traceId`
- **面板**：`/api/metrics` 返回计数、延迟、最近事件、用量汇总；面板「运行指标」卡片展示阶段耗时
- **失败隔离**：`safe` 系列 + 进程级兜底，异常只记录不崩宿主

## 6. 已知限制

- `lib/index.js` 仍有约 950 行，其中约 130 行是**装配段**（有意保留：模块接线放一起更易读）。
- 面板指标卡片缺人工目视确认（API 层有测试）。
- GitHub Release 尚未创建（需要仓库认证）。
