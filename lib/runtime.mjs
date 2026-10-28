/**
 * 运行时状态容器（RuntimeContext 的第一步）。
 *
 * 以前这些状态散落在 apply() 的闭包里，测试只能整插件启动才能造一个"群"。
 * 现在集中成一个对象，装配时注入；后续抽模块只要往 deps 里加字段。
 */

export function createRuntime() {
  return {
    /** roomId -> 房间运行时状态（消息、冷却、计时器…） */
    rooms: new Map(),
    /** 计数器（面板/诊断/指标用） */
    stats: {
      msgsIn: 0,
      replies: 0,
      skipped: 0,
      llmCalls: 0,
      llmErrors: 0,
      sends: 0,
      blocked: 0,
      canned: 0,
      stickersSent: 0,
      searches: 0,
      queued: 0,
      retried: 0,
      dropped: 0,
      lastLatencyMs: 0,
      lastFirstTokenMs: 0,
      lastAt: 0,
      lastError: '',
    },
    /** 所有 setInterval/setTimeout 句柄，dispose 时统一清理 */
    timers: new Set(),
    /** groupId -> 群名（只读缓存） */
    groupNames: new Map(),
    /** 已 dispose（异步任务回来时据此放弃） */
    disposed: false,
  }
}
