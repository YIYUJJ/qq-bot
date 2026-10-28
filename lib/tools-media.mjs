/**
 * 视频工具：qqbot_video（调试/手动触发）。
 *
 * 平台链接走 yt-dlp 拿标题/字幕；本地/直链走抽帧拼图 + 视觉描述。
 * 依赖注入：assertGroupAllowed / cfgFor / config / pickVideoLinks /
 *           buildVideoLinkNote / rememberVideo / roomState / describeVideo / rmSync / textOut。
 */
export function videoTools(deps) {
  const { assertGroupAllowed, cfgFor, config, pickVideoLinks, buildVideoLinkNote, rememberVideo, roomState, describeVideo, rmSync, textOut } = deps

  return [
    {
      name: 'qqbot_video',
      description:
        '看视频（调试/手动）：给一个本地视频路径或 http 链接，抽关键帧拼图后让视觉模型描述，返回「时长 + 描述」。用来验证视频链路。',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: '本地视频路径（如 C:\\tmp\\a.mp4）或 http(s) 链接' },
          frames: { type: 'number', description: '抽几帧，默认用配置里的 videoFrames' },
          room: { type: 'string', description: '可选：把这次看视频写进这个群的记忆（群号）' },
        },
        required: ['source'],
      },
      output: textOut,
      async execute(args) {
        const src = String(args?.source || '').trim()
        if (!src) return '给个视频路径或链接'
        const roomId = String(args?.room || '').trim().replace(/^group:/, '')
        if (roomId) assertGroupAllowed(roomId)
        const c = { ...cfgFor(roomId), videoFrames: Number(args?.frames) || config.videoFrames, videoOnMessage: true, linkVideo: true }
        const t0 = Date.now()
        // 视频平台链接：走 yt-dlp（拿标题/字幕），不下载整段视频
        if (pickVideoLinks(src, 1).length) {
          const got = await buildVideoLinkNote(src, c)
          if (got?.info && roomId) {
            try {
              rememberVideo(roomState(roomId), { desc: got.info.description || '', duration: got.info.duration }, got.info)
            } catch {
              /* ignore */
            }
          }
          return (got?.note || '没解析出内容').trim() + `\n（${Date.now() - t0}ms）`
        }
        const v = await describeVideo(src, c)
        if (roomId && v?.desc) {
          try {
            rememberVideo(roomState(roomId), v, null)
          } catch {
            /* ignore */
          }
        }
        if (v?.files?.length) {
          for (const f of v.files) {
            try {
              rmSync(f, { force: true })
            } catch {
              /* ignore */
            }
          }
        }
        return v?.desc
          ? `时长 ${Math.round(v.duration || 0)} 秒｜${Date.now() - t0}ms\n${v.desc}`
          : `没看成（${Date.now() - t0}ms）。看插件日志里的「看视频失败」。`
      },
    },
  ]
}
